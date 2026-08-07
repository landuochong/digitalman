#!/usr/bin/env python3
"""Extract a small natural mouth atlas from a project-owned reference video."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def read_frames(video_path: Path) -> list[np.ndarray]:
    capture = cv2.VideoCapture(str(video_path))
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(frame)
    capture.release()
    return frames


def select_indices(track: dict, levels: int) -> list[int]:
    ratios = np.array([frame["gap"] / max(frame["width"], 1e-6) for frame in track["frames"]])
    targets = np.quantile(ratios, np.linspace(0.05, 0.98, levels))
    selected = []
    used = set()
    for target in targets:
        candidates = np.argsort(np.abs(ratios - target))
        index = next((int(item) for item in candidates if int(item) not in used), int(candidates[0]))
        selected.append(index)
        used.add(index)
    return selected


def extract_patch(frame: np.ndarray, geometry: dict, output_size=(192, 112)) -> np.ndarray:
    height, width = frame.shape[:2]
    crop_width = max(24, geometry["width"] * width * 1.62)
    crop_height = crop_width * output_size[1] / output_size[0]
    center = (geometry["cx"] * width, geometry["cy"] * height)
    patch = cv2.getRectSubPix(frame, (int(round(crop_width)), int(round(crop_height))), center)
    patch = cv2.resize(patch, output_size, interpolation=cv2.INTER_LANCZOS4)

    alpha = np.zeros((output_size[1], output_size[0]), dtype=np.uint8)
    cv2.ellipse(alpha, (output_size[0] // 2, output_size[1] // 2),
                (output_size[0] // 2 - 7, output_size[1] // 2 - 5), 0, 0, 360, 255, -1)
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=9, sigmaY=7)
    return np.dstack([patch, alpha])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--track", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--levels", type=int, default=5)
    args = parser.parse_args()

    track = json.loads(args.track.read_text(encoding="utf-8"))
    frames = read_frames(args.video)
    if len(frames) != track["frameCount"]:
        raise RuntimeError(f"视频 {len(frames)} 帧与轨迹 {track['frameCount']} 帧不一致")

    args.output.mkdir(parents=True, exist_ok=True)
    entries = []
    for level, frame_index in enumerate(select_indices(track, args.levels)):
        geometry = track["frames"][frame_index]
        filename = f"mouth-{level}.png"
        cv2.imwrite(str(args.output / filename), extract_patch(frames[frame_index], geometry))
        entries.append({
            "level": level,
            "image": filename,
            "sourceFrame": frame_index,
            "openRatio": geometry["gap"] / max(geometry["width"], 1e-6),
        })

    payload = {
        "format": "digitalman-mouth-atlas",
        "version": 1,
        "source": args.video.name,
        "patchWidthScale": 1.62,
        "aspectRatio": 192 / 112,
        "levels": entries,
    }
    (args.output / "atlas.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("口型图集：" + ", ".join(f"L{item['level']}={item['openRatio']:.4f}" for item in entries))


if __name__ == "__main__":
    main()
