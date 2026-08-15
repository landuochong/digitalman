#!/usr/bin/env python3
"""Remove only the low-opacity halo around the crown in bedroom_wave_v2.

The generated lakeside source contains a soft blue/gray rim around the crown.
The room-background composite makes that rim conspicuous.  Rebuilding the
entire foreground matte also changes flowers, fingers and clothes, so this
repair uses RVM only as a guide and modifies a fixed crown ROI in the already
composited bedroom video.  Core hair and every pixel outside the ROI remain
unchanged before video encoding.
"""

from __future__ import annotations

import argparse
import gzip
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
import torch


ROOT = Path(__file__).resolve().parents[1]
SOURCE_VIDEO = ROOT / "public/dh-live/actions/lakeside_wave_v2/01.mp4"
TARGET_ASSET = ROOT / "public/dh-live/actions/bedroom_wave_v2"
TARGET_VIDEO = TARGET_ASSET / "01.mp4"
TARGET_DATA = TARGET_ASSET / "combined_data.json.gz"
TARGET_THUMBNAIL = TARGET_ASSET / "thumbnail.jpg"
BACKGROUND = ROOT / "public/assets/lumi-bedroom-background-v1.png"
DEFAULT_MODEL = ROOT / "resources/models/rvm_mobilenetv3.pth"
MODEL_SHA256 = "3c7c1d92033f7c38d6577c481d13a195d7d80a159b960f4f3119ac7b534cf4f8"
EXPECTED_SIZE = (768, 1152)
EXPECTED_FRAMES = 222
CROWN_ROI = (345, 100, 565, 280)  # x1, y1, x2, y2; excludes most flower petals.
ALPHA_LOW = 0.50
ALPHA_HIGH = 0.85


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def run(*args: str) -> bytes:
    return subprocess.run(args, check=True, stdout=subprocess.PIPE).stdout


def video_info(path: Path) -> tuple[int, int, int]:
    payload = json.loads(
        run(
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", str(path),
        )
    )
    stream = payload["streams"][0]
    return int(stream["width"]), int(stream["height"]), int(stream["nb_read_frames"])


def aspect_fill(image: np.ndarray, width: int, height: int) -> np.ndarray:
    scale = max(width / image.shape[1], height / image.shape[0])
    resized = cv2.resize(
        image,
        (round(image.shape[1] * scale), round(image.shape[0] * scale)),
        interpolation=cv2.INTER_LANCZOS4,
    )
    x = (resized.shape[1] - width) // 2
    y = (resized.shape[0] - height) // 2
    return resized[y : y + height, x : x + width]


def smoothstep(values: np.ndarray, low: float, high: float) -> np.ndarray:
    scaled = np.clip((values - low) / (high - low), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def crown_weight(width: int, height: int) -> np.ndarray:
    x1, y1, x2, y2 = CROWN_ROI
    weight = np.zeros((height, width), dtype=np.float32)
    weight[y1:y2, x1:x2] = 1.0
    return cv2.GaussianBlur(weight, (0, 0), 3.0)


def load_rvm(model_path: Path):
    sys.path.insert(0, str(ROOT / "experiments/dh-live"))
    from RobustVideoMatting.model import MattingNetwork

    model = MattingNetwork("mobilenetv3").eval()
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    return model


def repair_frames(model_path: Path, output_directory: Path) -> None:
    source = cv2.VideoCapture(str(SOURCE_VIDEO))
    target = cv2.VideoCapture(str(TARGET_VIDEO))
    width = int(target.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(target.get(cv2.CAP_PROP_FRAME_HEIGHT))
    room = aspect_fill(cv2.imread(str(BACKGROUND)), width, height).astype(np.float32) / 255.0
    roi = crown_weight(width, height)
    model = load_rvm(model_path)
    recurrent = [None] * 4
    frame_index = 0

    with torch.inference_mode():
        while True:
            source_ok, source_frame = source.read()
            target_ok, target_frame = target.read()
            if source_ok != target_ok:
                raise RuntimeError("source and target frame counts differ")
            if not source_ok:
                break

            source_rgb = cv2.cvtColor(source_frame, cv2.COLOR_BGR2RGB)
            tensor = torch.from_numpy(source_rgb).permute(2, 0, 1).unsqueeze(0).float() / 255.0
            _, alpha, *recurrent = model(tensor, *recurrent, downsample_ratio=0.25)
            alpha_np = alpha[0, 0].cpu().numpy()
            keep = smoothstep(alpha_np, ALPHA_LOW, ALPHA_HIGH)
            remove = roi * (1.0 - keep)

            target_float = target_frame.astype(np.float32) / 255.0
            repaired = target_float * (1.0 - remove[..., None]) + room * remove[..., None]
            output = np.clip(np.rint(repaired * 255.0), 0, 255).astype(np.uint8)
            cv2.imwrite(str(output_directory / f"{frame_index + 1:06d}.png"), output)
            frame_index += 1

    source.release()
    target.release()
    if frame_index != EXPECTED_FRAMES:
        raise RuntimeError(f"unexpected processed frame count: {frame_index}")


def main() -> None:
    options = parse_args()
    if not options.model.is_file():
        raise RuntimeError(
            f"RVM model not found: {options.model}\n"
            f"expected official rvm_mobilenetv3.pth SHA-256: {MODEL_SHA256}"
        )

    with gzip.open(TARGET_DATA, "rt", encoding="utf-8") as handle:
        combined = json.load(handle)
    marker = combined.get("crown_halo_cleanup", {})
    if marker.get("version") == 1 and not options.force:
        print("bedroom_wave_v2 crown halo is already clean")
        return

    source_info = video_info(SOURCE_VIDEO)
    target_info = video_info(TARGET_VIDEO)
    if source_info != (*EXPECTED_SIZE, EXPECTED_FRAMES) or target_info != source_info:
        raise RuntimeError(f"unexpected videos: source={source_info}, target={target_info}")

    with tempfile.TemporaryDirectory(prefix="digitalman-crown-rim-") as directory:
        frames = Path(directory) / "frames"
        frames.mkdir()
        repair_frames(options.model, frames)
        temporary_video = Path(directory) / "01.mp4"
        run(
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", "25", "-i", str(frames / "%06d.png"), "-an",
            "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
            "-color_range", "tv", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
            "-colorspace", "bt709",
            "-bsf:v", "h264_metadata=video_full_range_flag=0:colour_primaries=1:"
            "transfer_characteristics=13:matrix_coefficients=1",
            "-movflags", "+faststart", str(temporary_video),
        )
        if video_info(temporary_video) != target_info:
            raise RuntimeError("repaired video failed validation")
        temporary_video.replace(TARGET_VIDEO)

    combined["crown_halo_cleanup"] = {
        "version": 1,
        "region": list(CROWN_ROI),
        "alpha": [ALPHA_LOW, ALPHA_HIGH],
        "reason": "remove only the low-opacity crown rim while preserving the subject core",
    }
    temporary_data = TARGET_DATA.with_suffix(".crown.json.gz")
    with gzip.open(temporary_data, "wt", encoding="utf-8") as handle:
        json.dump(combined, handle, ensure_ascii=False, separators=(",", ":"))
    temporary_data.replace(TARGET_DATA)
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(TARGET_VIDEO),
        "-vf", "select='eq(n,22)'", "-frames:v", "1", "-q:v", "2", str(TARGET_THUMBNAIL),
    )


if __name__ == "__main__":
    main()
