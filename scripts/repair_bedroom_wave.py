#!/usr/bin/env python3
"""Rebuild the bedroom wave action from its clean, low-amplitude hand frames."""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
import subprocess


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ACTION_ROOT = PROJECT_ROOT / "public" / "dh-live" / "actions" / "bedroom_wave"
VIDEO_PATH = ACTION_ROOT / "01.mp4"
DATA_PATH = ACTION_ROOT / "combined_data.json.gz"
THUMBNAIL_PATH = ACTION_ROOT / "thumbnail.jpg"
CLEAN_SOURCE_FRAMES = (23, 24, 25, 26, 27)
LANDMARK_FRAME_COUNT = 111


def read_clean_frames(path: Path) -> tuple[int, int, dict[int, bytes]]:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_frames", "-of", "json", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    width, height, count = int(stream["width"]), int(stream["height"]), int(stream["nb_frames"])
    if count <= max(CLEAN_SOURCE_FRAMES):
        raise RuntimeError(f"wave video only has {count} frames")
    selected = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-vf", "select='between(n,23,27)'", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True,
        capture_output=True,
    ).stdout
    frame_bytes = width * height * 3
    if len(selected) != frame_bytes * len(CLEAN_SOURCE_FRAMES):
        raise RuntimeError("ffmpeg did not return the four clean wave frames")
    frames = {index:selected[offset * frame_bytes:(offset + 1) * frame_bytes] for offset,index in enumerate(CLEAN_SOURCE_FRAMES)}
    return width, height, frames


def clean_frame_map() -> list[int]:
    # Hold each authored frame for four output frames. The narrow forward/back
    # motion remains readable as a wave without revisiting corrupted fingers.
    cycle = [23] * 3 + [24] * 3 + [25] * 3 + [26] * 3 + [27] * 3 + [26] * 3 + [25] * 3 + [24] * 3
    return (cycle * ((LANDMARK_FRAME_COUNT + len(cycle) - 1) // len(cycle)))[:LANDMARK_FRAME_COUNT]


def encode_video(width: int, height: int, frames: dict[int, bytes], mapping: list[int], output: Path) -> None:
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
        "-r", "25", "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium",
        "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for index in mapping:
            process.stdin.write(frames[index])
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("ffmpeg failed to encode repaired wave video")


def main() -> None:
    with gzip.open(DATA_PATH, "rt", encoding="utf-8") as source:
        combined = json.load(source)
    if combined.get("wave_repair", {}).get("version") == 2:
        print("bedroom wave action is already repaired")
        return
    width, height, frames = read_clean_frames(VIDEO_PATH)
    first_half = clean_frame_map()
    full_mapping = first_half + list(reversed(first_half))
    original_json = combined["json_data"]
    if len(original_json) <= max(first_half):
        raise RuntimeError("wave landmark data does not cover selected frames")
    combined["json_data"] = [original_json[index] for index in first_half]
    combined["frame_num"] = LANDMARK_FRAME_COUNT
    combined["wave_repair"] = {"version":2, "source_frames":list(CLEAN_SOURCE_FRAMES)}

    temp_video = VIDEO_PATH.with_name("01.repaired.mp4")
    temp_data = DATA_PATH.with_name("combined_data.repaired.json.gz")
    encode_video(width, height, frames, full_mapping, temp_video)
    with gzip.open(temp_data, "wt", encoding="utf-8", compresslevel=9) as target:
        json.dump(combined, target, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp_video, VIDEO_PATH)
    os.replace(temp_data, DATA_PATH)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(VIDEO_PATH), "-frames:v", "1", str(THUMBNAIL_PATH)],
        check=True,
    )


if __name__ == "__main__":
    main()
