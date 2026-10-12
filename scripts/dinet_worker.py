#!/usr/bin/env python3
"""Persistent Audio2BlendShape + DINet worker for the local DH_live assets."""

from __future__ import annotations

import argparse
import contextlib
import gzip
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import kaldi_native_fbank as knf
import numpy as np
import torch
from scipy.io import wavfile
from scipy.signal import resample


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DH_LIVE_ROOT = PROJECT_ROOT / "experiments" / "dh-live"
MOUTH_MASK_FILENAME = "mouth_masks-v1.npz"
# Original MediaPipe outer lip indices, mapped to the packed asset vertices.
OUTER_LIP_MEDIAPIPE = (61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
                       291, 409, 270, 269, 267, 0, 37, 39, 40, 185)
sys.path.insert(0, str(DH_LIVE_ROOT))

from mini_live.render import create_render_model  # noqa: E402
from mini_live.obj.wrap_utils import index_wrap  # noqa: E402
from talkingface.data.few_shot_dataset import get_image  # noqa: E402
from talkingface.model_utils import Audio2bs, LoadAudioModel, device  # noqa: E402
from talkingface.models.DINet_mini import model_size as network_model_size  # noqa: E402
from talkingface.render_model_mini import RenderModel_Mini  # noqa: E402


class StreamingAudio2BlendShape:
    """Keep OnlineFbank and LSTM state across consecutive PCM windows."""

    def __init__(self, model):
        self.model = model
        opts = knf.FbankOptions()
        opts.frame_opts.dither = 0
        opts.frame_opts.samp_freq = 8000
        opts.frame_opts.frame_length_ms = 50
        opts.frame_opts.frame_shift_ms = 20
        opts.frame_opts.snip_edges = False
        opts.mel_opts.num_bins = 80
        opts.mel_opts.debug_mel = False
        self.fbank = knf.OnlineFbank(opts)
        self.processed_features = 0
        self.h = torch.zeros(2, 1, 192).to(device)
        self.c = torch.zeros(2, 1, 192).to(device)
        # Match the former 400 ms overlapping context once per session. It
        # stabilizes the first visible mouth frame without recomputing it for
        # every following segment.
        self._accept_8k(np.zeros(3200, dtype=np.float32), output=False)

    def _accept_8k(self, samples: np.ndarray, output: bool = True) -> np.ndarray:
        self.fbank.accept_waveform(8000, samples.astype(np.float32).tolist())
        ready = self.fbank.num_frames_ready - self.processed_features
        usable = ready - (ready % 2)
        if usable < 2:
            return np.empty((0, 6), dtype=np.float32)
        features = np.zeros((usable, 80), dtype=np.float32)
        for index in range(usable):
            features[index] = self.fbank.get_frame(self.processed_features + index)
        self.processed_features += usable
        tensor = torch.from_numpy(features).unsqueeze(0).float().to(device)
        with torch.inference_mode():
            values, self.h, self.c = self.model(tensor, self.h, self.c)
        self.h = self.h.detach()
        self.c = self.c.detach()
        coefficients = values[0].detach().cpu().float().numpy() * 0.5
        return coefficients if output else np.empty((0, 6), dtype=np.float32)

    def process_wav(self, audio_path: Path, expected_frames: int) -> np.ndarray:
        rate, pcm = wavfile.read(audio_path, mmap=False)
        if rate != 16000:
            raise ValueError(f"流式口型需要 16 kHz PCM，收到 {rate} Hz")
        if pcm.ndim != 1:
            pcm = pcm[:, 0]
        downsampled = resample(pcm, len(pcm) // 2).astype(np.float32) / 32768.0
        coefficients = self._accept_8k(downsampled)
        if expected_frames > 0:
            if len(coefficients) < expected_frames:
                raise ValueError(
                    f"流式声学帧不足：期望 {expected_frames}，得到 {len(coefficients)}"
                )
            coefficients = coefficients[-expected_frames:]
        return coefficients


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
        self.audio_streams = {}
        self.visual_turn_frames = {}
        self.visual_turn_assets = {}
        self.visual_turn_frame_offsets = {}
        self.render_model = RenderModel_Mini()
        self.render_model.loadModel(str(render_checkpoint))

        texture = cv2.imread(str(DH_LIVE_ROOT / "mini_live" / "bs_texture_halfFace.png"))
        texture = cv2.cvtColor(texture, cv2.COLOR_BGR2RGB)
        self.blendshape = texture[:6, :209].astype(np.float32) / 255.0 * 2.0 - 1.0
        self.set_asset(asset)

    def set_asset(self, asset: Path) -> bool:
        """Switch video motion while retaining the loaded neural/audio models."""
        resolved = asset.resolve()
        signature = tuple(
            (item.stat().st_size, item.stat().st_mtime_ns)
            for item in (
                resolved / "01.mp4",
                resolved / "combined_data.json.gz",
                resolved / MOUTH_MASK_FILENAME,
            )
        )
        if resolved == self.asset and signature == self.asset_signature:
            return False
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
        mask_data = np.load(self.asset / MOUTH_MASK_FILENAME)
        self.mouth_masks = [mask for mask in mask_data["masks"][: len(self.frames)]]
        if len(self.mouth_masks) != len(self.frames):
            raise ValueError(f"逐帧嘴部遮罩数量与素材不一致：{self.asset}")
        # Colour masks miss the dark corners and pale upper lip. Use the
        # asset's tracked outer contour as an independent coverage guarantee.
        lip_indices = [index_wrap.index(index) for index in OUTER_LIP_MEDIAPIPE]
        self.mouth_masks = [
            self._complete_lip_mask(mask, vertices[lip_indices])
            for mask, vertices in zip(self.mouth_masks, self.standard_vertices)
        ]
        self.matrices = [
            np.asarray(item["points"][:16], dtype=np.float32).reshape(4, 4) * 2
            for item in self.json_data
        ][: len(self.frames)]
        self._make_ping_pong_loop()
        self.opengl.GenVBO(self._parse_face_vertices(combined["face3D_obj"]))
        return True

    @staticmethod
    def _complete_lip_mask(mask: np.ndarray, outer_lips: np.ndarray) -> np.ndarray:
        """Cover the tracked lip contour regardless of its colour or shadow."""
        contour = np.rint(outer_lips).astype(np.int32)
        geometry = np.zeros_like(mask)
        cv2.fillConvexPoly(geometry, cv2.convexHull(contour), 255)
        geometry = cv2.dilate(geometry, np.ones((5, 5), np.uint8))
        return np.maximum(mask, geometry)

    def _restore_source_lip_color(
        self, face: np.ndarray, source: np.ndarray, profile: dict,
        authored_mask: np.ndarray,
    ) -> np.ndarray:
        """Apply a soft, bounded chroma shift without flattening lip shading."""
        strength = profile["lipColorStrength"]
        upper_strength = profile["upperLipColorStrength"]
        if max(strength, upper_strength) <= 0:
            return face
        lip_support = authored_mask > 18
        source_rgb = source[:, :, :3]
        face_rgb = face[:, :, :3]
        source_lab = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
        face_lab = cv2.cvtColor(face_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
        source_hsv = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2HSV)
        face_hsv = cv2.cvtColor(face_rgb, cv2.COLOR_RGB2HSV)
        source_lips = lip_support & (source_lab[:, :, 1] > 140) & (source_hsv[:, :, 1] > 60)
        generated_lips = (lip_support & (face_lab[:, :, 1] > 140)
                          & (face_hsv[:, :, 1] > 50) & (face_lab[:, :, 0] > 75))
        if np.count_nonzero(source_lips) < 20 or np.count_nonzero(generated_lips) < 20:
            return face
        # Match upper/lower lips independently: the source's pale upper lip
        # and warm lower lip must not collapse into one grey-pink colour.
        identity = profile.get("lipIdentityStrength", 0.0)
        yy = np.arange(face.shape[0])[:, None]
        split = face.shape[0] * profile["lipColorCenterY"]
        global_delta = np.clip(
            np.median(source_lab[source_lips, 1:], axis=0)
            - np.median(face_lab[generated_lips, 1:], axis=0), -12, 12,
        )
        delta = np.broadcast_to(global_delta, (*face.shape[:2], 2)).copy()
        lightness = np.zeros(face.shape[:2], dtype=np.float32)
        if identity > 0:
            regional = []
            for half in [yy <= split, yy > split]:
                reference = source_lips & half & (source_lab[:, :, 0] > 80)
                generated = generated_lips & half
                if np.count_nonzero(reference) < 8 or np.count_nonzero(generated) < 8:
                    regional.append((global_delta, 0.0))
                    continue
                ref_median = np.median(source_lab[reference], axis=0)
                gen_median = np.median(face_lab[generated], axis=0)
                regional.append((np.clip(ref_median[1:] - gen_median[1:], -24, 24),
                                 float(np.clip(ref_median[0] - gen_median[0], -8, 8))))
            # Soft spatial transition avoids a line between the two lip colours.
            lower = np.clip((yy - split + 2) / 4, 0, 1)[..., None]
            regional_delta = regional[0][0] * (1 - lower) + regional[1][0] * lower
            delta = delta * (1 - identity) + regional_delta * identity
            lightness = ((1 - lower[..., 0]) * regional[0][1]
                         + lower[..., 0] * regional[1][1]) * identity
        if identity > 0:
            # A single median misses the orange centre / softer edges of the
            # reference lips. Transfer only low-frequency colour along each
            # lip's thickness; retain generated fine shading and the open cavity.
            source_base = cv2.GaussianBlur(source_lab, (0, 0), 1.0)
            face_base = cv2.GaussianBlur(face_lab, (0, 0), 1.0)
            local_delta = delta.copy()
            local_light = np.broadcast_to(lightness, face.shape[:2]).copy()
            for half in [yy <= split, yy > split]:
                ref_region = source_lips & half
                gen_region = generated_lips & half
                for x in np.flatnonzero((np.any(ref_region, axis=0) & np.any(gen_region, axis=0))):
                    ref_rows = np.flatnonzero(ref_region[:, x])
                    gen_rows = np.flatnonzero(gen_region[:, x])
                    if len(ref_rows) < 3 or len(gen_rows) < 2:
                        continue
                    # Map lip tissue to lip tissue, without copying a closed
                    # mouth line over generated teeth or stretching source RGB.
                    sample_y = np.interp(np.linspace(0, 1, len(gen_rows)),
                                         np.linspace(0, 1, len(ref_rows)), ref_rows)
                    target = np.stack([np.interp(sample_y, np.arange(face.shape[0]),
                                                source_base[:, x, channel])
                                       for channel in range(3)], axis=1)
                    difference = target - face_base[gen_rows, x]
                    local_delta[gen_rows, x] = np.clip(difference[:, 1:], -32, 32)
                    local_light[gen_rows, x] = np.clip(difference[:, 0], -20, 20)
            local_delta = cv2.GaussianBlur(local_delta, (5, 5), .8)
            local_light = cv2.GaussianBlur(local_light, (5, 5), .8)
            delta = delta * (1 - identity) + local_delta * identity
            lightness = lightness * (1 - identity) + local_light * identity
        confidence = np.clip((face_lab[:, :, 1] - 132) / 16, 0, 1)
        confidence *= np.clip((face_hsv[:, :, 1].astype(np.float32) - 25) / 50, 0, 1)
        confidence *= np.clip((face_lab[:, :, 0] - 60) / 45, 0, 1)
        soft_support = cv2.GaussianBlur(lip_support.astype(np.float32), (5, 5), .8)
        yy = np.arange(face.shape[0])[:, None]
        strengths = np.where(yy <= face.shape[0] * profile["lipColorCenterY"],
                             max(strength, upper_strength), strength)
        alpha = (confidence * soft_support * strengths)[..., None]
        corrected = face_lab.copy()
        corrected[:, :, 1:] += delta
        corrected[:, :, 0] += profile["lipBrightnessOffset"] + lightness
        rgb = cv2.cvtColor(np.clip(corrected, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
        return np.clip(face_rgb * (1 - alpha) + rgb * alpha, 0, 255).astype(np.uint8)

    def _composite_narrow_mouth(
        self, face: np.ndarray, source: np.ndarray, profile: dict,
        authored_mask: np.ndarray,
    ) -> np.ndarray:
        """Keep original lips fully covered even when the new mouth is narrower."""
        height, width = face.shape[:2]
        support = (authored_mask > 18).astype(np.uint8)
        points = cv2.findNonZero(support)
        if points is None:
            return source[:, :, :3].copy()
        # Include the cavity between the lips; a colour-derived lip mask can
        # otherwise leave the original closed mouth visible through new teeth.
        core = np.zeros_like(support)
        cv2.fillConvexPoly(core, cv2.convexHull(points), 1)
        core = cv2.dilate(core, np.ones((3, 3), np.uint8))
        scale_x, scale_y = profile["mouthWidthScale"], profile["mouthHeightScale"]
        center_x = width * profile["compositeCenterX"]
        center_y = height * profile["compositeCenterY"]
        transform = np.array([
            [scale_x, 0, center_x * (1 - scale_x)],
            [0, scale_y, center_y * (1 - scale_y)],
        ], dtype=np.float32)
        # Warp the full generated image so the old lip perimeter is replaced
        # with generated skin, instead of falling outside a resized patch.
        warped = cv2.warpAffine(
            face[:, :, :3], transform, (width, height),
            flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101,
        )
        moved_core = cv2.warpAffine(
            core, transform, (width, height), flags=cv2.INTER_NEAREST,
        )
        core = np.maximum(core, moved_core).astype(np.float32)
        # Feather outward only: original lips and the cavity stay opaque.
        outer = cv2.dilate(core, np.ones((3, 3), np.uint8))
        alpha = np.maximum(core, cv2.GaussianBlur(outer, (7, 7), 1.0))[..., None]
        blended = warped.astype(np.float32) * alpha + source[:, :, :3] * (1 - alpha)
        return np.clip(blended, 0, 255).astype(np.uint8)

    def _restore_upper_teeth(self, face: np.ndarray, profile: dict) -> np.ndarray:
        """Restore a thin upper-teeth edge inside a generated dark mouth cavity."""
        strength = profile["teethStrength"]
        if strength <= 0:
            return face

        height, width = face.shape[:2]
        hsv = cv2.cvtColor(face[:, :, :3], cv2.COLOR_RGB2HSV)
        yy, xx = np.ogrid[:height, :width]
        center_x = width * profile["lipColorCenterX"]
        center_y = height * profile["lipColorCenterY"]
        mouth_region = (
            ((xx - center_x) / (width * 0.24)) ** 2
            + ((yy - center_y) / (height * 0.12)) ** 2
        ) <= 1.0
        dark_cavity = (mouth_region & (hsv[:, :, 2] <= 108)).astype(np.uint8)
        count, labels, stats, centers = cv2.connectedComponentsWithStats(dark_cavity)

        candidates = []
        for index in range(1, count):
            x, y, cavity_width, cavity_height, area = stats[index]
            if cavity_width < width * 0.08 or cavity_height < 2:
                continue
            if cavity_height > height * 0.09 or cavity_width / cavity_height < 2.4:
                continue
            component_x, component_y = centers[index]
            if abs(component_x - center_x) > width * 0.14:
                continue
            if abs(component_y - center_y) > height * 0.16:
                continue
            candidates.append((area, index, x, y, cavity_width, cavity_height))
        if not candidates:
            return face

        _, index, x, y, cavity_width, cavity_height = max(candidates)
        component = labels == index
        tooth_mask = np.zeros((height, width), dtype=np.uint8)
        inset = max(1, int(round(cavity_width * 0.14)))
        x_start, x_end = x + inset, x + cavity_width - inset
        max_depth = max(1, int(round(cavity_height * 0.28)))
        for column in range(x_start, x_end):
            rows = np.flatnonzero(component[:, column])
            if rows.size == 0:
                continue
            top = int(rows[0])
            available_depth = int(np.count_nonzero(component[top : top + max_depth, column]))
            depth = min(max_depth, available_depth)
            if depth > 0:
                tooth_mask[top : top + depth, column] = 255

        # A slight horizontal close keeps compression artefacts from looking like
        # random white dots, while retaining the actual upper cavity contour.
        tooth_mask = cv2.morphologyEx(
            tooth_mask, cv2.MORPH_CLOSE, np.ones((1, 3), dtype=np.uint8)
        )
        alpha = cv2.GaussianBlur(tooth_mask.astype(np.float32) / 255.0, (0, 0), 0.38)
        alpha = np.clip(alpha * strength, 0.0, 1.0)[..., None]
        tooth_color = np.array([226.0, 220.0, 210.0], dtype=np.float32)
        return np.clip(
            face[:, :, :3].astype(np.float32) * (1.0 - alpha) + tooth_color * alpha,
            0, 255,
        ).astype(np.uint8)

    @staticmethod
    def _resize_face_for_output(
        face: np.ndarray, size: tuple[int, int], profile: dict, authored_mask: np.ndarray,
    ) -> np.ndarray:
        """Preserve existing tooth edges during resizing; never paint teeth."""
        rgb = face[:, :, :3]
        baseline = cv2.resize(rgb, size, interpolation=cv2.INTER_LINEAR)
        strength = profile.get("teethDetailStrength", 0.0)
        if strength <= 0:
            return baseline
        support = (authored_mask > 18).astype(np.uint8)
        points = cv2.findNonZero(support)
        if points is None:
            return baseline
        x, y, width, height = cv2.boundingRect(points)
        # The central inner mouth excludes skin and the established lip outline.
        inner = np.zeros_like(support)
        cv2.ellipse(inner, (x + width // 2, y + height // 2),
                    (max(1, int(width * .34)), max(1, int(height * .28))),
                    0, 0, 360, 1, -1)
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
        confidence = np.clip((150 - lab[:, :, 1]) / 18, 0, 1)
        confidence *= np.clip((125 - hsv[:, :, 1]) / 65, 0, 1)
        confidence *= np.clip((lab[:, :, 0] - 65) / 40, 0, 1)
        confidence *= support * inner
        # Feather inside the selected pixels, never into lips or the dark cavity.
        confidence *= cv2.GaussianBlur(confidence, (3, 3), .65)
        luminance = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        detail = luminance - cv2.GaussianBlur(luminance, (0, 0), .65)
        detail = np.sign(detail) * np.maximum(np.abs(detail) - .75, 0)
        detail = np.clip(detail * .7, -6, 6)
        sharp = np.clip(rgb.astype(np.float32) + detail[..., None], 0, 255)
        high_quality = cv2.resize(sharp, size, interpolation=cv2.INTER_CUBIC)
        alpha = cv2.resize(confidence, size, interpolation=cv2.INTER_LINEAR)[..., None]
        # Bound the final change as well as the filter to avoid ringing/white bars.
        change = np.clip(high_quality - baseline.astype(np.float32), -8, 8)
        result = baseline.astype(np.float32) + change * alpha * strength
        return np.clip(np.rint(result), 0, 255).astype(np.uint8)

    def _mouth_profile(self, values: dict | None) -> dict:
        values = values or {}
        return {
            "mouthMotionScale": float(np.clip(values.get("mouthMotionScale", self.mouth_motion_scale), 0.65, 1.15)),
            "mouthWidthScale": float(np.clip(values.get("mouthWidthScale", self.mouth_width_scale), 0.65, 1.10)),
            "mouthHeightScale": float(np.clip(values.get("mouthHeightScale", 1.0), 0.75, 1.15)),
            "compositeCenterX": float(np.clip(values.get("compositeCenterX", 0.50), 0.42, 0.58)),
            "compositeCenterY": float(np.clip(values.get("compositeCenterY", 0.39), 0.32, 0.52)),
            "lipColorCenterX": float(np.clip(values.get("lipColorCenterX", 0.50), 0.42, 0.58)),
            "lipColorCenterY": float(np.clip(values.get("lipColorCenterY", 0.49), 0.40, 0.58)),
            "lipColorStrength": float(np.clip(values.get("lipColorStrength", self.lip_color_strength), 0.0, 1.0)),
            "lipIdentityStrength": float(np.clip(values.get("lipIdentityStrength", 0.0), 0.0, 1.0)),
            "upperLipColorStrength": float(np.clip(values.get("upperLipColorStrength", 0.0), 0.0, 1.0)),
            "lipBrightnessOffset": float(np.clip(values.get("lipBrightnessOffset", 0.0), -12.0, 20.0)),
            "teethStrength": float(np.clip(values.get("teethStrength", 0.0), 0.0, 1.0)),
            "teethDetailStrength": float(np.clip(values.get("teethDetailStrength", 0.0), 0.0, 1.0)),
        }

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
        plan = json.loads((PROJECT_ROOT / "public/album-motion-plan.json").read_text())
        indices = next((item["sourceFrames"] for item in plan["characters"].values()
                        if item["asset"] == self.asset.name), None)
        for values in (self.frames, self.crop_rects, self.standard_images,
                       self.standard_vertices, self.matrices, self.mouth_masks):
            if indices is None:
                values.extend(values[::-1])
            else:
                # One shared timeline keeps rendering and browser settlement aligned.
                original = values[:]
                values[:] = [original[index] for index in indices]

    @staticmethod
    def _parse_face_vertices(lines):
        values = []
        for line in lines:
            if line.startswith("v "):
                values.extend(float(value) for value in line[2:].split())
        return np.asarray(values, dtype=np.float32).reshape(-1, 5)

    def render(
        self, audio_path: Path, output_path: Path, frame_offset: int = 0,
        audio_offset_ms: int = 0, output_frames: int = 0,
        stream_id: str | None = None, stream_final: bool = False,
        video_only: bool = False, fragmented_video: bool = False,
        visual_turn_id: str | None = None, visual_sentence_index: int = 0,
        mouth_profile: dict | None = None,
    ) -> dict:
        started = time.perf_counter()
        profile = self._mouth_profile(mouth_profile)
        if stream_id:
            stream = self.audio_streams.get(stream_id)
            if stream is None:
                stream = StreamingAudio2BlendShape(self.audio_model)
                self.audio_streams[stream_id] = stream
            coefficients = stream.process_wav(audio_path, output_frames)
        else:
            coefficients = Audio2bs(str(audio_path), self.audio_model)[5:] * 0.5
        audio_ready = time.perf_counter()
        if not len(coefficients):
            raise ValueError("音频过短，无法生成口型")
        if output_frames > 0:
            coefficients = coefficients[-output_frames:]

        output_path.parent.mkdir(parents=True, exist_ok=True)
        height, width = self.frames[0].shape[:2]
        # Feed raw frames straight into the final H.264 encoder.  The old path
        # encoded every frame to a temporary mp4v file and then decoded and
        # encoded the whole video again during muxing.  Keeping ffmpeg alive
        # while DINet renders lets encoding overlap inference and removes that
        # complete second video pass.
        command = [
                "ffmpeg", "-loglevel", "error", "-y",
                "-f", "rawvideo", "-pix_fmt", "bgr24",
                "-video_size", f"{width}x{height}", "-framerate", "25",
                "-i", "pipe:0",
        ]
        if video_only:
            command.extend([
                "-c:v", "libx264", "-preset", "veryfast",
                "-pix_fmt", "yuv420p", "-crf", "18", "-an",
            ])
            if fragmented_video:
                command.extend([
                    "-g", "20", "-keyint_min", "20", "-sc_threshold", "0",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                ])
            else:
                command.extend(["-movflags", "+faststart"])
            command.append(str(output_path))
        else:
            if audio_offset_ms > 0:
                command.extend(["-ss", f"{audio_offset_ms / 1000:.3f}"])
            command.extend([
                    "-i", str(audio_path),
                    "-c:v", "libx264", "-preset", "veryfast",
                    "-pix_fmt", "yuv420p", "-crf", "18",
                    "-c:a", "aac", "-shortest", "-movflags", "+faststart",
                    str(output_path),
            ])
        encoder = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if encoder.stdin is None:
            encoder.kill()
            raise RuntimeError("无法启动视频编码器")

        last_valid = np.zeros(12, dtype=np.float32)
        previous_visual_asset = self.visual_turn_assets.get(visual_turn_id) if visual_turn_id else None
        # A following sentence can be prepared before the previous TTS duration
        # is known, so its browser-estimated frame offset may drift. Once the
        # serialized worker reaches it, continue the same action from the exact
        # source frame rendered by the preceding segment instead.
        if (
            visual_turn_id
            and visual_sentence_index > 0
            and previous_visual_asset == str(self.asset)
            and visual_turn_id in self.visual_turn_frame_offsets
        ):
            frame_offset = self.visual_turn_frame_offsets[visual_turn_id]
        source_frame_offset = frame_offset
        # Every authored action is already returned to the shared neutral pose.
        # Blending two complete frames here double-exposes hair and moving limbs,
        # which appears as a halo or small black fragments. The browser waits for
        # the next decoded frame before atomically revealing it, so switch the
        # foreground in one frame instead of mixing two different silhouettes.
        transition_frames = 0
        last_output_frame = None
        try:
            with torch.inference_mode():
                for audio_index, values in enumerate(coefficients):
                    frame_index = (frame_offset + audio_index) % len(self.frames)
                    blendshape = np.zeros(12, dtype=np.float32)
                    blendshape[:6] = values[:6] * profile["mouthMotionScale"]
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
                    authored_mouth_mask = cv2.resize(
                        self.mouth_masks[frame_index],
                        (self.model_size, self.model_size),
                        interpolation=cv2.INTER_AREA,
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
                    face = self._restore_source_lip_color(
                        face, source, profile, authored_mouth_mask
                    )
                    face = self._restore_upper_teeth(face, profile)
                    face = self._composite_narrow_mouth(
                        face, source, profile, authored_mouth_mask
                    )
                    x0, y0, x1, y1 = self.crop_rects[frame_index]
                    frame = self.frames[frame_index][:, :, :3].copy()
                    frame[y0:y1, x0:x1] = self._resize_face_for_output(
                        face, (x1 - x0, y1 - y0), profile, authored_mouth_mask
                    )
                    last_output_frame = frame.copy()
                    encoder.stdin.write(np.ascontiguousarray(frame[:, :, ::-1]).tobytes())
        except Exception:
            encoder.stdin.close()
            encoder.kill()
            encoder.wait()
            output_path.unlink(missing_ok=True)
            raise
        finally:
            if not encoder.stdin.closed:
                encoder.stdin.close()
        frames_ready = time.perf_counter()

        stderr = encoder.stderr.read().decode("utf-8", errors="replace") if encoder.stderr else ""
        return_code = encoder.wait()
        if return_code:
            output_path.unlink(missing_ok=True)
            raise RuntimeError(f"ffmpeg 视频编码失败：{stderr[-800:]}")
        finished = time.perf_counter()
        if stream_id and stream_final:
            self.audio_streams.pop(stream_id, None)
        if visual_turn_id and last_output_frame is not None:
            self.visual_turn_frames[visual_turn_id] = last_output_frame
            self.visual_turn_assets[visual_turn_id] = str(self.asset)
            self.visual_turn_frame_offsets[visual_turn_id] = (
                source_frame_offset + len(coefficients)
            ) % len(self.frames)
        return {
            "frames": len(coefficients),
            "audioMode": "stateful" if stream_id else "whole-wav",
            "videoOnly": video_only,
            "fragmentedVideo": fragmented_video,
            "transitionFrames": transition_frames,
            "sourceFrameOffset": source_frame_offset,
            "nextSourceFrameOffset": (
                source_frame_offset + len(coefficients)
            ) % len(self.frames),
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
            if request.get("op") == "prepare_asset":
                started = time.perf_counter()
                with contextlib.redirect_stdout(sys.stderr):
                    changed = renderer.set_asset(Path(request["asset"]))
                send({
                    "type": "done", "id": request_id, "prepared": True,
                    "changed": changed,
                    "loadMs": round((time.perf_counter() - started) * 1000),
                })
                continue
            if request.get("op") == "cancel_stream":
                removed = renderer.audio_streams.pop(str(request.get("streamId") or ""), None)
                send({"type": "done", "id": request_id, "cancelled": removed is not None})
                continue
            if request.get("op") == "close_visual_turn":
                removed = renderer.visual_turn_frames.pop(
                    str(request.get("visualTurnId") or ""), None
                )
                renderer.visual_turn_assets.pop(
                    str(request.get("visualTurnId") or ""), None
                )
                renderer.visual_turn_frame_offsets.pop(
                    str(request.get("visualTurnId") or ""), None
                )
                send({"type": "done", "id": request_id, "closed": removed is not None})
                continue
            with contextlib.redirect_stdout(sys.stderr):
                if request.get("asset"):
                    renderer.set_asset(Path(request["asset"]))
                metrics = renderer.render(
                    Path(request["audio"]),
                    Path(request["output"]),
                    max(0, int(request.get("frameOffset", 0))),
                    max(0, int(request.get("audioOffsetMs", 0))),
                    max(0, int(request.get("outputFrames", 0))),
                    str(request.get("streamId") or "") or None,
                    bool(request.get("streamFinal", False)),
                    bool(request.get("videoOnly", False)),
                    bool(request.get("fragmentedVideo", False)),
                    str(request.get("visualTurnId") or "") or None,
                    max(0, int(request.get("visualSentenceIndex", 0))),
                    request.get("mouthProfile"),
                )
            send({"type": "done", "id": request_id, **metrics})
        except Exception as error:
            send({"type": "error", "id": request_id, "error": str(error)})


if __name__ == "__main__":
    main()
