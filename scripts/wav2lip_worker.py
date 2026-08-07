#!/usr/bin/env python3
"""Persistent local Wav2Lip worker using one preloaded model and avatar."""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path

import torch

from render_wav2lip_offline import (
    LIVETALKING,
    load_model,
    load_or_detect_faces,
    make_mel_chunks,
    read_video,
    render,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument(
        "--checkpoint", type=Path, default=LIVETALKING / "models" / "wav2lip.pth"
    )
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--face-batch-size", type=int, default=4)
    parser.add_argument("--detect-stride", type=int, default=5)
    parser.add_argument("--output-fps", type=float, default=15)
    parser.add_argument("--pad-top", type=int, default=0)
    parser.add_argument("--pad-bottom", type=int, default=14)
    parser.add_argument("--pad-left", type=int, default=0)
    parser.add_argument("--pad-right", type=int, default=0)
    return parser.parse_args()


def send(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> None:
    args = parse_args()
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    with contextlib.redirect_stdout(sys.stderr):
        frames, source_fps = read_video(args.video)
        pads = (args.pad_top, args.pad_bottom, args.pad_left, args.pad_right)
        boxes = load_or_detect_faces(
            frames,
            args.video,
            device,
            args.face_batch_size,
            pads,
            args.detect_stride,
            None,
        )
        model = load_model(args.checkpoint, device)
    send({"type": "ready", "device": str(device)})

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            audio_path = Path(request["audio"])
            output_path = Path(request["output"])
            with contextlib.redirect_stdout(sys.stderr):
                mel_chunks = make_mel_chunks(audio_path, args.output_fps)
                render(
                    frames,
                    boxes,
                    mel_chunks,
                    model,
                    device,
                    source_fps,
                    args.output_fps,
                    output_path,
                    audio_path,
                    args.batch_size,
                )
            send({"type": "done", "id": request_id})
        except Exception as error:
            send({"type": "error", "id": request_id, "error": str(error)})


if __name__ == "__main__":
    main()
