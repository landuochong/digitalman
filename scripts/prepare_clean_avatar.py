#!/usr/bin/env python3
"""Create a small, project-owned mouth tracking file from an avatar video.

This intentionally does not import or consume DH_live/MatesX code or data.
The output contains only normalized mouth geometry detected with MediaPipe.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import mediapipe as mp


MOUTH_LEFT = 61
MOUTH_RIGHT = 291
MOUTH_UPPER = 13
MOUTH_LOWER = 14


def point(landmarks, index: int) -> tuple[float, float]:
    item = landmarks[index]
    return float(item.x), float(item.y)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def smooth(previous: dict[str, float] | None, current: dict[str, float], weight: float = 0.42) -> dict[str, float]:
    if previous is None:
        return current
    return {key: previous[key] + (current[key] - previous[key]) * weight for key in current}


def detect(video_path: Path) -> dict:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 25.0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames: list[dict] = []
    previous_geometry = None
    missed = 0

    with mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.55,
        min_tracking_confidence=0.55,
    ) as face_mesh:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            result = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if not result.multi_face_landmarks:
                missed += 1
                if previous_geometry is None:
                    raise RuntimeError("首帧未检测到人脸")
                frames.append({**previous_geometry, "detected": False})
                continue

            landmarks = result.multi_face_landmarks[0].landmark
            left = point(landmarks, MOUTH_LEFT)
            right = point(landmarks, MOUTH_RIGHT)
            upper = point(landmarks, MOUTH_UPPER)
            lower = point(landmarks, MOUTH_LOWER)
            mouth_width = max(distance(left, right), 1e-5)
            geometry = {
                "cx": (left[0] + right[0] + upper[0] + lower[0]) / 4,
                "cy": (upper[1] + lower[1]) / 2,
                "width": mouth_width,
                "gap": distance(upper, lower),
                "angle": math.atan2(right[1] - left[1], right[0] - left[0]),
            }
            geometry = smooth(previous_geometry, geometry)
            previous_geometry = geometry
            frames.append({**geometry, "detected": True})

    capture.release()
    if not frames:
        raise RuntimeError("视频没有可处理帧")
    return {
        "format": "digitalman-mouth-track",
        "version": 1,
        "source": video_path.name,
        "width": width,
        "height": height,
        "fps": fps,
        "frameCount": len(frames),
        "duration": len(frames) / fps,
        "missedFrames": missed,
        "frames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    payload = detect(args.video.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{payload['frameCount']} 帧 · {payload['width']}×{payload['height']} · 漏检 {payload['missedFrames']} 帧")


if __name__ == "__main__":
    main()
