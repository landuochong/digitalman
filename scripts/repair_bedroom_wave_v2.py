#!/usr/bin/env python3
"""Remove the leaked lakeside bench fragment from bedroom_wave_v2.

The person segmentation briefly keeps a small part of the source bench behind
the character's right shoulder.  Only frames 20..27 (and their reversed copies)
contain it.  Replace that background-only rectangle with the exact bedroom
background while leaving the shoulder, hair and waving hand untouched.
"""

from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "public/dh-live/actions/bedroom_wave_v2"
VIDEO = ASSET / "01.mp4"
DATA = ASSET / "combined_data.json.gz"
BACKGROUND = ROOT / "public/assets/lumi-bedroom-background-v1.png"
PATCH_X, PATCH_Y, PATCH_WIDTH, PATCH_HEIGHT = 565, 495, 105, 105
DIRTY_FRAME_RANGES = ((20, 27), (194, 201))
EXPECTED_FRAMES = 222


def run(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, check=True, stdout=subprocess.PIPE)


def video_info(path: Path) -> tuple[int, int, int]:
    result = run(
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", str(path),
    )
    stream = json.loads(result.stdout)["streams"][0]
    return int(stream["width"]), int(stream["height"]), int(stream["nb_read_frames"])


def main() -> None:
    with gzip.open(DATA, "rt", encoding="utf-8") as handle:
        combined = json.load(handle)
    if combined.get("wave_v2_background_cleanup", {}).get("version") == 1:
        print("bedroom_wave_v2 background is already clean")
        return

    width, height, frame_count = video_info(VIDEO)
    if (width, height, frame_count) != (768, 1152, EXPECTED_FRAMES):
        raise RuntimeError(f"unexpected wave video: {width}x{height}, {frame_count} frames")

    enable = "+".join(f"between(n,{start},{end})" for start, end in DIRTY_FRAME_RANGES)
    filter_graph = (
        f"[1:v]scale={width}:{height},"
        f"crop={PATCH_WIDTH}:{PATCH_HEIGHT}:{PATCH_X}:{PATCH_Y}[clean];"
        f"[0:v][clean]overlay={PATCH_X}:{PATCH_Y}:enable='{enable}'[out]"
    )
    temporary_video = VIDEO.with_suffix(".cleanup.mp4")
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(VIDEO), "-loop", "1", "-i", str(BACKGROUND),
        "-filter_complex", filter_graph, "-map", "[out]", "-frames:v", str(EXPECTED_FRAMES),
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14",
        "-pix_fmt", "yuv420p", "-color_range", "tv",
        "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
        "-movflags", "+faststart", str(temporary_video),
    )
    if video_info(temporary_video) != (width, height, frame_count):
        temporary_video.unlink(missing_ok=True)
        raise RuntimeError("cleaned wave video failed frame-count validation")
    temporary_video.replace(VIDEO)

    combined["wave_v2_background_cleanup"] = {
        "version": 1,
        "frames": [list(frame_range) for frame_range in DIRTY_FRAME_RANGES],
        "region": [PATCH_X, PATCH_Y, PATCH_WIDTH, PATCH_HEIGHT],
        "reason": "remove leaked source-bench fragment outside right shoulder",
    }
    temporary_data = DATA.with_suffix(".cleanup.json.gz")
    with gzip.open(temporary_data, "wt", encoding="utf-8") as handle:
        json.dump(combined, handle, ensure_ascii=False, separators=(",", ":"))
    temporary_data.replace(DATA)


if __name__ == "__main__":
    main()
