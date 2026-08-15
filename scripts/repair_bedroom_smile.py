#!/usr/bin/env python3
"""Rebuild the real-avatar smile from the clean, restrained part of its source.

The later source frames contain a very wide painted smile.  DINet replaces the
moving center of the mouth but intentionally keeps some source texture around
it, so those late frames leave two dark mouth-corner strokes beside the spoken
mouth.  Frames 0..20 retain the eye/cheek smile without those strokes.
"""

from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "public/dh-live/actions/bedroom_smile_test"
VIDEO = ASSET / "01.mp4"
DATA = ASSET / "combined_data.json.gz"
THUMBNAIL = ASSET / "thumbnail.jpg"
SOURCE_FRAMES = tuple(range(21))
HALF_FRAMES = 111


def run(*args: str, input_bytes: bytes | None = None) -> bytes:
    return subprocess.run(args, input=input_bytes, check=True, stdout=subprocess.PIPE).stdout


def video_info(path: Path) -> tuple[int, int, int]:
    payload = json.loads(
        run(
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-count_frames", "-show_entries", "stream=width,height,nb_read_frames",
            "-of", "json", str(path),
        )
    )
    stream = payload["streams"][0]
    return int(stream["width"]), int(stream["height"]), int(stream["nb_read_frames"])


def gentle_smile_mapping() -> list[int]:
    mapping: list[int] = []
    for index in range(HALF_FRAMES):
        phase = index / (HALF_FRAMES - 1) * 2.0
        amount = phase if phase <= 1.0 else 2.0 - phase
        mapping.append(int(round(amount * SOURCE_FRAMES[-1])))
    return mapping


def main() -> None:
    with gzip.open(DATA, "rt", encoding="utf-8") as handle:
        combined = json.load(handle)
    if combined.get("smile_repair", {}).get("version") == 1:
        return

    width, height, count = video_info(VIDEO)
    if count <= SOURCE_FRAMES[-1] or len(combined.get("json_data", [])) <= SOURCE_FRAMES[-1]:
        raise RuntimeError("微笑素材帧数不足，无法抽取自然浅笑区间")

    raw = run(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(VIDEO),
        "-vf", "select='between(n,0,20)'", "-vsync", "0",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    )
    frame_bytes = width * height * 3
    if len(raw) != frame_bytes * len(SOURCE_FRAMES):
        raise RuntimeError("未能完整读取微笑素材的 0..20 帧")
    frames = {
        frame: raw[offset * frame_bytes : (offset + 1) * frame_bytes]
        for offset, frame in enumerate(SOURCE_FRAMES)
    }

    first_half = gentle_smile_mapping()
    output_mapping = first_half + list(reversed(first_half))
    encoded = b"".join(frames[index] for index in output_mapping)
    temp_video = VIDEO.with_suffix(".repair.mp4")
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
        "-r", "25", "-i", "-", "-an", "-c:v", "libx264", "-crf", "18",
        "-pix_fmt", "yuv420p", "-color_range", "tv",
        "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
        "-movflags", "+faststart", str(temp_video),
        input_bytes=encoded,
    )
    temp_video.replace(VIDEO)

    source_data = combined["json_data"]
    combined["json_data"] = [source_data[index] for index in first_half]
    combined["frame_num"] = HALF_FRAMES
    combined["smile_repair"] = {
        "version": 1,
        "source_frames": [SOURCE_FRAMES[0], SOURCE_FRAMES[-1]],
        "reason": "remove dark deep-smile mouth corners",
    }
    temp_data = DATA.with_suffix(".repair.json.gz")
    with gzip.open(temp_data, "wt", encoding="utf-8") as handle:
        json.dump(combined, handle, ensure_ascii=False, separators=(",", ":"))
    temp_data.replace(DATA)

    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(VIDEO),
        "-vf", "select='eq(n,55)'", "-frames:v", "1", "-q:v", "2", str(THUMBNAIL),
    )


if __name__ == "__main__":
    main()
