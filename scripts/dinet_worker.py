#!/usr/bin/env python3
"""Persistent Audio2BlendShape + DINet worker for the local DH_live assets."""

from __future__ import annotations

import argparse
import contextlib
import gzip
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
import torch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DH_LIVE_ROOT = PROJECT_ROOT / "experiments" / "dh-live"
sys.path.insert(0, str(DH_LIVE_ROOT))

from mini_live.render import create_render_model  # noqa: E402
from talkingface.data.few_shot_dataset import get_image  # noqa: E402
from talkingface.model_utils import Audio2bs, LoadAudioModel, device  # noqa: E402
from talkingface.models.DINet_mini import model_size as network_model_size  # noqa: E402
from talkingface.render_model_mini import RenderModel_Mini  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True, type=Path)
    parser.add_argument(
        "--audio-checkpoint",
        type=Path,
        default=DH_LIVE_ROOT / "checkpoint" / "lstm" / "lstm_model_epoch_325.pkl",
    )
    parser.add_argument(
        "--render-checkpoint",
        type=Path,
        default=DH_LIVE_ROOT / "checkpoint" / "DINet_mini" / "epoch_40_new.pth",
    )
    parser.add_argument(
        "--mouth-motion-scale",
        type=float,
        default=0.82,
        help="收紧音频驱动的嘴部形变，1.0 为 DINet 原始幅度",
    )
    parser.add_argument(
        "--lip-color-strength",
        type=float,
        default=0.78,
        help="让合成嘴唇继承原视频色相和饱和度，范围 0-1",
    )
    parser.add_argument(
        "--mouth-width-scale",
        type=float,
        default=0.88,
        help="局部合成时的嘴部横向比例，1.0 保持模型输出宽度",
    )
    return parser.parse_args()


def send(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


class PersistentDINetRenderer:
    def __init__(
        self,
        asset: Path,
        audio_checkpoint: Path,
        render_checkpoint: Path,
        mouth_motion_scale: float = 0.82,
        lip_color_strength: float = 0.78,
        mouth_width_scale: float = 0.88,
    ):
        self.asset = None
        self.asset_signature = None
        self.mouth_motion_scale = max(0.0, float(mouth_motion_scale))
        self.lip_color_strength = float(np.clip(lip_color_strength, 0.0, 1.0))
        self.mouth_width_scale = float(np.clip(mouth_width_scale, 0.65, 1.0))
        self.audio_model = LoadAudioModel(str(audio_checkpoint))
        self.render_model = RenderModel_Mini()
        self.render_model.loadModel(str(render_checkpoint))

        texture = cv2.imread(str(DH_LIVE_ROOT / "mini_live" / "bs_texture_halfFace.png"))
        texture = cv2.cvtColor(texture, cv2.COLOR_BGR2RGB)
        self.blendshape = texture[:6, :209].astype(np.float32) / 255.0 * 2.0 - 1.0
        self.set_asset(asset)

    def set_asset(self, asset: Path) -> None:
        """Switch video motion while retaining the loaded neural/audio models."""
        resolved = asset.resolve()
        signature = tuple(
            (item.stat().st_size, item.stat().st_mtime_ns)
            for item in (resolved / "01.mp4", resolved / "combined_data.json.gz")
        )
        if resolved == self.asset and signature == self.asset_signature:
            return
        self.asset = resolved
        self.asset_signature = signature

        with gzip.open(self.asset / "combined_data.json.gz", "rt", encoding="utf-8") as file:
            combined = json.load(file)
        self.json_data = combined["json_data"]
        self.model_size = int(combined.get("size", network_model_size))
        if self.model_size != network_model_size:
            raise ValueError(
                f"素材模型尺寸 {self.model_size} 与 DINet {network_model_size} 不一致"
            )

        ref_feature = np.asarray(combined["ref_data"], dtype=np.float32).reshape(1, -1)[:, :64]
        self.render_model.net.infer_model.ref_in_feature = torch.from_numpy(ref_feature).float().to(device)

        self.standard_size = self.model_size * 2
        self.opengl = create_render_model((self.standard_size, self.standard_size), floor=20)
        self.frames, self.crop_rects, self.standard_images, self.standard_vertices = self._read_video()
        self.matrices = [
            np.asarray(item["points"][:16], dtype=np.float32).reshape(4, 4) * 2
            for item in self.json_data
        ][: len(self.frames)]
        self._make_ping_pong_loop()
        self.opengl.GenVBO(self._parse_face_vertices(combined["face3D_obj"]))

    def _restore_source_lip_color(self, face: np.ndarray, source: np.ndarray) -> np.ndarray:
        """Keep DINet geometry but move lip chroma back toward the source video.

        DINet tends to turn warm coral lips grey-purple.  Restrict the correction
        to red/magenta pixels in a feathered mouth ellipse so teeth, mouth cavity,
        skin and the rest of the face retain the neural renderer's luminance.
        """
        strength = self.lip_color_strength
        if strength <= 0:
            return face

        height, width = face.shape[:2]
        yy, xx = np.ogrid[:height, :width]
        ellipse = (
            ((xx - width * 0.50) / (width * 0.31)) ** 2
            + ((yy - height * 0.49) / (height * 0.105)) ** 2
        ) <= 1.0

        source_hsv = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2HSV)
        source_lab = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2LAB)
        face_hsv = cv2.cvtColor(face[:, :, :3], cv2.COLOR_RGB2HSV)
        face_lab = cv2.cvtColor(face[:, :, :3], cv2.COLOR_RGB2LAB)

        source_hue = source_hsv[:, :, 0].astype(np.float32)
        source_signed_hue = np.where(source_hue > 90, source_hue - 180, source_hue)
        source_lips = (
            ellipse
            & (np.abs(source_signed_hue) <= 18)
            & (source_hsv[:, :, 1] >= 70)
            & (source_hsv[:, :, 2] <= 245)
            & (source_lab[:, :, 1] >= 140)
        )
        if np.count_nonzero(source_lips) < 20:
            return face

        target_hue = float(np.median(source_signed_hue[source_lips]))
        target_saturation = float(np.percentile(source_hsv[:, :, 1][source_lips], 65))

        face_hue = face_hsv[:, :, 0].astype(np.float32)
        face_signed_hue = np.where(face_hue > 90, face_hue - 180, face_hue)
        generated_lips = (
            ellipse
            & (np.abs(face_signed_hue) <= 25)
            & (face_hsv[:, :, 1] >= 50)
            & (face_hsv[:, :, 2] <= 238)
            & (face_lab[:, :, 0] >= 105)
            & (face_lab[:, :, 1] >= 142)
        )
        if not np.any(generated_lips):
            return face

        corrected_hue = face_signed_hue[generated_lips]
        corrected_hue += (target_hue - corrected_hue) * strength
        face_hsv[:, :, 0][generated_lips] = np.mod(corrected_hue, 180).astype(np.uint8)

        saturation = face_hsv[:, :, 1].astype(np.float32)
        current = saturation[generated_lips]
        # Preserve naturally stronger pixels and only restore saturation lost by DINet.
        restored = current + np.maximum(target_saturation - current, 0) * strength
        face_hsv[:, :, 1][generated_lips] = np.clip(restored, 0, 255).astype(np.uint8)

        # DINet also darkens the visible lip surface. Match only the lost lightness;
        # the lower threshold above keeps the mouth cavity out, while low saturation
        # keeps teeth out.
        source_value = float(np.median(source_hsv[:, :, 2][source_lips]))
        generated_value = float(np.median(face_hsv[:, :, 2][generated_lips]))
        value_delta = np.clip(source_value - generated_value, 0.0, 20.0)
        value = face_hsv[:, :, 2].astype(np.float32)
        value[generated_lips] += value_delta * strength * 0.55
        face_hsv[:, :, 2] = np.clip(value, 0, 255).astype(np.uint8)
        return cv2.cvtColor(face_hsv, cv2.COLOR_HSV2RGB)

    def _composite_narrow_mouth(self, face: np.ndarray, source: np.ndarray) -> np.ndarray:
        """Compress only the synthesized mouth and feather it into the source face."""
        height, width = face.shape[:2]
        center_x, center_y = width * 0.50, height * 0.39
        radius_x, radius_y = width * 0.34, height * 0.19
        x0 = max(0, int(round(center_x - radius_x)))
        x1 = min(width, int(round(center_x + radius_x)))
        y0 = max(0, int(round(center_y - radius_y)))
        y1 = min(height, int(round(center_y + radius_y)))
        patch = face[y0:y1, x0:x1]
        if patch.size == 0:
            return face

        compressed_width = max(2, int(round(patch.shape[1] * self.mouth_width_scale)))
        compressed = cv2.resize(
            patch, (compressed_width, patch.shape[0]), interpolation=cv2.INTER_LINEAR
        )
        paste_x0 = int(round(center_x - compressed_width / 2))
        paste_x1 = paste_x0 + compressed_width

        local_y, local_x = np.ogrid[:patch.shape[0], :compressed_width]
        normalized_x = (local_x - (compressed_width - 1) / 2) / max(compressed_width * 0.5, 1)
        normalized_y = (local_y - (patch.shape[0] - 1) / 2) / max(patch.shape[0] * 0.5, 1)
        distance = normalized_x**2 + normalized_y**2
        alpha = np.clip((1.0 - distance) / 0.34, 0.0, 1.0)
        alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), sigmaX=1.4)
        alpha = np.clip(alpha, 0.0, 1.0)[..., None]

        output = source[:, :, :3].copy()
        target = output[y0:y1, paste_x0:paste_x1].astype(np.float32)
        blended = compressed.astype(np.float32) * alpha + target * (1.0 - alpha)
        output[y0:y1, paste_x0:paste_x1] = np.clip(blended, 0, 255).astype(np.uint8)
        return output

    def _read_video(self):
        cap = cv2.VideoCapture(str(self.asset / "01.mp4"))
        if not cap.isOpened():
            raise ValueError(f"无法打开素材视频：{self.asset / '01.mp4'}")
        frames, crop_rects, standard_images, standard_vertices = [], [], [], []
        count = min(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), len(self.json_data))
        for index in range(count):
            ok, bgr = cap.read()
            if not ok:
                break
            frame = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
            rect = self.json_data[index]["rect"]
            vertices = np.asarray(self.json_data[index]["points"][16:], dtype=np.float32).reshape(-1, 2) * 2
            frames.append(frame)
            crop_rects.append(rect)
            standard_images.append(
                get_image(frame, rect, input_type="image", resize=self.standard_size)
            )
            standard_vertices.append(vertices)
        cap.release()
        if not frames:
            raise ValueError("素材视频没有有效帧")
        return frames, crop_rects, standard_images, standard_vertices

    def _make_ping_pong_loop(self) -> None:
        for values in (
            self.frames,
            self.crop_rects,
            self.standard_images,
            self.standard_vertices,
            self.matrices,
        ):
            values.extend(values[::-1])

    @staticmethod
    def _parse_face_vertices(lines):
        values = []
        for line in lines:
            if line.startswith("v "):
                values.extend(float(value) for value in line[2:].split())
        return np.asarray(values, dtype=np.float32).reshape(-1, 5)

    def render(self, audio_path: Path, output_path: Path) -> dict:
        started = time.perf_counter()
        coefficients = Audio2bs(str(audio_path), self.audio_model)[5:] * 0.5
        audio_ready = time.perf_counter()
        if not len(coefficients):
            raise ValueError("音频过短，无法生成口型")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        height, width = self.frames[0].shape[:2]
        with tempfile.NamedTemporaryFile(
            suffix=".mp4", prefix="dinet-", dir=output_path.parent, delete=False
        ) as temporary:
            silent_path = Path(temporary.name)
        writer = cv2.VideoWriter(
            str(silent_path), cv2.VideoWriter_fourcc(*"mp4v"), 25, (width, height)
        )
        if not writer.isOpened():
            silent_path.unlink(missing_ok=True)
            raise RuntimeError("无法创建临时视频")

        last_valid = np.zeros(12, dtype=np.float32)
        try:
            with torch.inference_mode():
                for audio_index, values in enumerate(coefficients):
                    frame_index = audio_index % len(self.frames)
                    blendshape = np.zeros(12, dtype=np.float32)
                    blendshape[:6] = values[:6] * self.mouth_motion_scale
                    deformation = (
                        self.blendshape * blendshape[:6].reshape(6, 1, 1)
                    ).sum(axis=0)
                    y_bias = deformation[4, 1] - deformation[5, 1]
                    if y_bias > 0 or y_bias < -45:
                        blendshape = blendshape * 0.5 + last_valid * 0.5
                    else:
                        last_valid = blendshape.copy()

                    vertex_buffer = (
                        self.standard_vertices[frame_index].copy() / self.model_size - 1
                    )
                    rgba = self.opengl.render2cv(
                        vertex_buffer,
                        out_size=(self.standard_size, self.standard_size),
                        mat_world=self.matrices[frame_index],
                        bs_array=blendshape,
                    )[::2, ::2, :]
                    gl_tensor = (
                        torch.from_numpy(rgba / 255.0)
                        .float()
                        .permute(2, 0, 1)
                        .unsqueeze(0)
                        .to(device)
                    )
                    source = cv2.resize(
                        self.standard_images[frame_index], (self.model_size, self.model_size)
                    )
                    source_tensor = (
                        torch.from_numpy(source / 255.0)
                        .float()
                        .permute(2, 0, 1)
                        .unsqueeze(0)
                        .to(device)
                    )
                    result = self.render_model.interface(source_tensor, gl_tensor)
                    face = result.squeeze(0).cpu().permute(1, 2, 0).numpy()
                    face = np.clip(face * 255.0, 0, 255).astype(np.uint8)
                    face = self._restore_source_lip_color(face, source)
                    face = self._composite_narrow_mouth(face, source)
                    x0, y0, x1, y1 = self.crop_rects[frame_index]
                    frame = self.frames[frame_index][:, :, :3].copy()
                    frame[y0:y1, x0:x1] = cv2.resize(face, (x1 - x0, y1 - y0))[:, :, :3]
                    writer.write(frame[:, :, ::-1])
        finally:
            writer.release()
        frames_ready = time.perf_counter()

        try:
            subprocess.run(
                [
                    "ffmpeg", "-loglevel", "error", "-y",
                    "-i", str(silent_path), "-i", str(audio_path),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                    "-c:a", "aac", "-shortest", str(output_path),
                ],
                check=True,
            )
        finally:
            silent_path.unlink(missing_ok=True)
        finished = time.perf_counter()
        return {
            "frames": len(coefficients),
            "audioMs": round((audio_ready - started) * 1000),
            "framesMs": round((frames_ready - audio_ready) * 1000),
            "muxMs": round((finished - frames_ready) * 1000),
            "totalMs": round((finished - started) * 1000),
        }


def main() -> None:
    args = parse_args()
    with contextlib.redirect_stdout(sys.stderr):
        renderer = PersistentDINetRenderer(
            args.asset,
            args.audio_checkpoint,
            args.render_checkpoint,
            args.mouth_motion_scale,
            args.lip_color_strength,
            args.mouth_width_scale,
        )
    send({"type": "ready", "device": device})

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            with contextlib.redirect_stdout(sys.stderr):
                if request.get("asset"):
                    renderer.set_asset(Path(request["asset"]))
                metrics = renderer.render(Path(request["audio"]), Path(request["output"]))
            send({"type": "done", "id": request_id, **metrics})
        except Exception as error:
            send({"type": "error", "id": request_id, "error": str(error)})


if __name__ == "__main__":
    main()
