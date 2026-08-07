#!/usr/bin/env python3
"""Render a local video with Wav2Lip256 without the LiveTalking web runtime."""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from tqdm import tqdm


ROOT = Path(__file__).resolve().parents[1]
LIVETALKING = ROOT / "experiments" / "livetalking"
sys.path.insert(0, str(LIVETALKING))

from avatars.wav2lip import audio, face_detection  # noqa: E402
from avatars.wav2lip.models import Wav2Lip  # noqa: E402


MEL_STEP_SIZE = 16
MODEL_SIZE = 256


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=LIVETALKING / "models" / "wav2lip.pth",
    )
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--face-batch-size", type=int, default=4)
    parser.add_argument("--detect-stride", type=int, default=5)
    parser.add_argument("--output-fps", type=float, default=0)
    parser.add_argument("--pad-top", type=int, default=0)
    parser.add_argument("--pad-bottom", type=int, default=14)
    parser.add_argument("--pad-left", type=int, default=0)
    parser.add_argument("--pad-right", type=int, default=0)
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--boxes-cache", type=Path)
    return parser.parse_args()


def load_model(checkpoint_path: Path, device: torch.device) -> Wav2Lip:
    checkpoint = torch.load(
        checkpoint_path,
        map_location="cpu",
        weights_only=True,
    )
    state = {
        key.replace("module.", ""): value
        for key, value in checkpoint["state_dict"].items()
    }
    model = Wav2Lip()
    model.load_state_dict(state)
    return model.to(device).eval()


def read_video(path: Path) -> tuple[list[np.ndarray], float]:
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    frames: list[np.ndarray] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(frame)
    capture.release()
    if not frames:
        raise RuntimeError(f"视频没有有效帧: {path}")
    return frames, fps


def make_mel_chunks(path: Path, fps: float) -> list[np.ndarray]:
    wav = audio.load_wav(str(path), 16000)
    mel = audio.melspectrogram(wav)
    if np.isnan(mel).any():
        raise RuntimeError("音频 Mel 特征包含 NaN，请检查音频")

    chunks: list[np.ndarray] = []
    multiplier = 80.0 / fps
    index = 0
    while True:
        start = int(index * multiplier)
        if start + MEL_STEP_SIZE > mel.shape[1]:
            if mel.shape[1] < MEL_STEP_SIZE:
                padded = np.pad(
                    mel,
                    ((0, 0), (0, MEL_STEP_SIZE - mel.shape[1])),
                    mode="edge",
                )
                chunks.append(padded)
            else:
                chunks.append(mel[:, -MEL_STEP_SIZE:])
            break
        chunks.append(mel[:, start : start + MEL_STEP_SIZE])
        index += 1
    return chunks


def mirror_index(length: int, index: int) -> int:
    if length <= 1:
        return 0
    period = length * 2 - 2
    offset = index % period
    return offset if offset < length else period - offset


def smooth_boxes(boxes: np.ndarray, window: int = 5) -> np.ndarray:
    smoothed = boxes.copy().astype(np.float32)
    half = window // 2
    for index in range(len(boxes)):
        start = max(0, index - half)
        end = min(len(boxes), index + half + 1)
        smoothed[index] = np.median(boxes[start:end], axis=0)
    return smoothed.astype(np.int32)


def detect_faces(
    frames: list[np.ndarray],
    device: torch.device,
    batch_size: int,
    pads: tuple[int, int, int, int],
    stride: int,
) -> np.ndarray:
    # The bundled S3FD implementation only accepts CPU/CUDA device names.
    # Wav2Lip itself may use MPS, but face detection must not inherit it.
    detector_device = "cuda" if device.type == "cuda" else "cpu"
    detector = face_detection.FaceAlignment(
        face_detection.LandmarksType._2D,
        flip_input=False,
        device=detector_device,
    )
    stride = max(1, stride)
    sample_indices = list(range(0, len(frames), stride))
    if sample_indices[-1] != len(frames) - 1:
        sample_indices.append(len(frames) - 1)
    sample_frames = [frames[index] for index in sample_indices]

    predictions = []
    for start in tqdm(range(0, len(sample_frames), batch_size), desc="检测人脸"):
        batch = np.asarray(sample_frames[start : start + batch_size])
        predictions.extend(detector.get_detections_for_batch(batch))
    del detector

    pad_top, pad_bottom, pad_left, pad_right = pads
    boxes = []
    last_valid = None
    for frame_index, rect in zip(sample_indices, predictions):
        frame = frames[frame_index]
        if rect is None:
            if last_valid is None:
                raise RuntimeError("首帧未检测到人脸")
            boxes.append(last_valid.copy())
            continue
        height, width = frame.shape[:2]
        x1 = max(0, int(rect[0]) - pad_left)
        y1 = max(0, int(rect[1]) - pad_top)
        x2 = min(width, int(rect[2]) + pad_right)
        y2 = min(height, int(rect[3]) + pad_bottom)
        last_valid = np.array([x1, y1, x2, y2], dtype=np.int32)
        boxes.append(last_valid.copy())
    sampled_boxes = np.asarray(boxes)
    all_indices = np.arange(len(frames))
    interpolated = np.stack(
        [
            np.interp(all_indices, sample_indices, sampled_boxes[:, axis])
            for axis in range(4)
        ],
        axis=1,
    )
    return smooth_boxes(interpolated.astype(np.int32))


def default_boxes_cache(
    video_path: Path, pads: tuple[int, int, int, int], stride: int
) -> Path:
    digest = hashlib.sha256(video_path.read_bytes()).hexdigest()[:12]
    pad_key = "-".join(str(value) for value in pads)
    return ROOT / "artifacts" / "wav2lip" / "cache" / f"{digest}-{pad_key}-s{stride}.npz"


def load_or_detect_faces(
    frames: list[np.ndarray],
    video_path: Path,
    device: torch.device,
    batch_size: int,
    pads: tuple[int, int, int, int],
    stride: int,
    cache_path: Path | None,
) -> np.ndarray:
    target = cache_path or default_boxes_cache(video_path, pads, stride)
    if target.is_file():
        cached = np.load(target)["boxes"]
        if len(cached) >= len(frames):
            print(f"复用人脸框缓存: {target}")
            return cached[: len(frames)].astype(np.int32)

    boxes = detect_faces(frames, device, batch_size, pads, stride)
    target.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(target, boxes=boxes)
    print(f"人脸框缓存: {target}")
    return boxes


def make_blend_mask(height: int, width: int) -> np.ndarray:
    """Preserve eyes/hair and feather only the generated lower face into source."""
    y = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    x = np.linspace(0.0, 1.0, width, dtype=np.float32)[None, :]

    vertical = np.clip((y - 0.38) / 0.18, 0.0, 1.0)
    vertical *= np.clip((1.02 - y) / 0.10, 0.0, 1.0)
    horizontal = np.clip(x / 0.10, 0.0, 1.0)
    horizontal *= np.clip((1.0 - x) / 0.10, 0.0, 1.0)
    mask = vertical * horizontal
    sigma = max(1.0, min(height, width) * 0.018)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=sigma, sigmaY=sigma)
    return np.clip(mask[..., None], 0.0, 1.0)


def render(
    frames: list[np.ndarray],
    boxes: np.ndarray,
    mel_chunks: list[np.ndarray],
    model: Wav2Lip,
    device: torch.device,
    source_fps: float,
    output_fps: float,
    output_path: Path,
    audio_path: Path,
    batch_size: int,
) -> None:
    height, width = frames[0].shape[:2]
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="wav2lip-", dir=output_path.parent) as tmp:
        silent_path = Path(tmp) / "silent.mp4"
        writer = cv2.VideoWriter(
            str(silent_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            output_fps,
            (width, height),
        )
        if not writer.isOpened():
            raise RuntimeError("无法创建临时视频")

        started = time.perf_counter()
        for start in tqdm(range(0, len(mel_chunks), batch_size), desc="生成口型"):
            current_mels = mel_chunks[start : start + batch_size]
            source_frames = []
            source_crops = []
            source_boxes = []

            for offset in range(len(current_mels)):
                output_index = start + offset
                source_index = mirror_index(
                    len(frames), round(output_index * source_fps / output_fps)
                )
                frame = frames[source_index].copy()
                x1, y1, x2, y2 = boxes[source_index]
                crop = frame[y1:y2, x1:x2]
                if crop.size == 0:
                    raise RuntimeError(f"无效人脸裁剪框: {(x1, y1, x2, y2)}")
                source_frames.append(frame)
                source_crops.append(crop)
                source_boxes.append((x1, y1, x2, y2))

            resized = np.asarray(
                [cv2.resize(crop, (MODEL_SIZE, MODEL_SIZE)) for crop in source_crops]
            )
            masked = resized.copy()
            masked[:, MODEL_SIZE // 2 :] = 0
            face_input = np.concatenate((masked, resized), axis=3) / 255.0
            mel_input = np.asarray(current_mels)[:, None, :, :]

            face_tensor = torch.from_numpy(face_input.transpose(0, 3, 1, 2)).float().to(device)
            mel_tensor = torch.from_numpy(mel_input).float().to(device)
            with torch.inference_mode():
                prediction = model(mel_tensor, face_tensor)
            prediction = (
                prediction.clamp(0, 1).cpu().numpy().transpose(0, 2, 3, 1) * 255.0
            ).astype(np.uint8)

            for generated, original_crop, frame, box in zip(
                prediction, source_crops, source_frames, source_boxes
            ):
                x1, y1, x2, y2 = box
                generated = cv2.resize(generated, (x2 - x1, y2 - y1))
                mask = make_blend_mask(y2 - y1, x2 - x1)
                blended = generated.astype(np.float32) * mask
                blended += original_crop.astype(np.float32) * (1.0 - mask)
                frame[y1:y2, x1:x2] = np.clip(blended, 0, 255).astype(np.uint8)
                writer.write(frame)

        writer.release()
        elapsed = time.perf_counter() - started
        print(f"口型生成完成: {len(mel_chunks)} 帧, {elapsed:.2f}s, {len(mel_chunks) / elapsed:.2f} fps")

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(silent_path),
                "-i",
                str(audio_path),
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-shortest",
                str(output_path),
            ],
            check=True,
        )


def main() -> None:
    args = parse_args()
    for path in (args.video, args.audio, args.checkpoint):
        if not path.is_file():
            raise FileNotFoundError(path)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"推理设备: {device}")
    frames, source_fps = read_video(args.video)
    output_fps = args.output_fps if args.output_fps > 0 else source_fps
    mel_chunks = make_mel_chunks(args.audio, output_fps)
    if args.max_frames > 0:
        mel_chunks = mel_chunks[: args.max_frames]

    print(
        f"视频: {len(frames)} 帧 @ {source_fps:.2f} fps; "
        f"输出: {len(mel_chunks)} 帧 @ {output_fps:.2f} fps"
    )

    pads = (args.pad_top, args.pad_bottom, args.pad_left, args.pad_right)
    boxes = load_or_detect_faces(
        frames,
        args.video,
        device,
        args.face_batch_size,
        pads,
        args.detect_stride,
        args.boxes_cache,
    )
    model = load_model(args.checkpoint, device)
    render(
        frames,
        boxes,
        mel_chunks,
        model,
        device,
        source_fps,
        output_fps,
        args.output,
        args.audio,
        args.batch_size,
    )
    print(f"输出: {args.output.resolve()}")


if __name__ == "__main__":
    main()
