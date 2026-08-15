#!/usr/bin/env python3
"""Validate semantic motion in Xiaotao's nod and clap assets.

This complements the full-frame contact sheets: it fails when the nod becomes
too similar to a smile, or when a clap no longer contains three separated palm
contacts. It intentionally reads the normalized forward clips so the automatic
DH_live return segment cannot inflate the measurements.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ACTIONS_ROOT = PROJECT_ROOT / "public" / "dh-live" / "actions"
NORMALIZED_ROOT = PROJECT_ROOT / "resources" / "xiaotao-green-normalized"


def face_center_y(asset: str) -> list[float]:
    package = ACTIONS_ROOT / asset / "combined_data.json.gz"
    with gzip.open(package, "rt", encoding="utf-8") as source:
        data = json.load(source)
    return [(frame["rect"][1] + frame["rect"][3]) / 2 for frame in data["json_data"]]


def face_vertical_range(asset: str) -> float:
    centers = face_center_y(asset)
    return max(centers) - min(centers)


def hand_state(landmarks) -> str:
    if len(landmarks) == 2:
        wrists = [hand.landmark[0] for hand in landmarks]
        separation = abs(wrists[0].x - wrists[1].x)
        mean_y = (wrists[0].y + wrists[1].y) / 2
        if separation < 0.14 and 0.28 < mean_y < 0.48:
            return "contact"
        if separation > 0.24 and 0.25 < mean_y < 0.50:
            return "open"
    elif len(landmarks) == 1:
        # At exact palm contact MediaPipe often merges both hands into one.
        wrist = landmarks[0].landmark[0]
        if 0.40 < wrist.x < 0.60 and 0.28 < wrist.y < 0.48:
            return "contact"
    return "other"


def clap_sequence(video: Path) -> tuple[list[str], int]:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open {video}")
    states: list[str] = []
    hands = mp.solutions.hands.Hands(
        static_image_mode=True,
        max_num_hands=2,
        min_detection_confidence=0.3,
    )
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            result = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            states.append(hand_state(result.multi_hand_landmarks or []))
    finally:
        hands.close()
        capture.release()

    contacts = 0
    previous_contact = False
    opened_since_contact = True
    for state in states:
        if state == "open":
            opened_since_contact = True
            previous_contact = False
        elif state == "contact":
            if opened_since_contact and not previous_contact:
                contacts += 1
                opened_since_contact = False
            previous_contact = True
        else:
            previous_contact = False
    return states, contacts


def compact_runs(states: list[str]) -> list[dict[str, int | str]]:
    runs: list[dict[str, int | str]] = []
    for index, state in enumerate(states):
        if runs and runs[-1]["state"] == state:
            runs[-1]["end"] = index
        else:
            runs.append({"state": state, "start": index, "end": index})
    return [run for run in runs if run["state"] != "other"]


def clap_naturalness(states: list[str]) -> tuple[int, int]:
    contact_frames = sum(state == "contact" for state in states)
    contact_indices = [index for index, state in enumerate(states) if state == "contact"]
    if not contact_indices:
        return contact_frames, 0
    first, last = contact_indices[0], contact_indices[-1]
    wide_reopenings = 0
    in_open_run = False
    open_run_length = 0
    for state in states[first:last + 1]:
        if state == "open":
            in_open_run = True
            open_run_length += 1
        elif in_open_run:
            if open_run_length >= 2:
                wide_reopenings += 1
            in_open_run = False
            open_run_length = 0
    if in_open_run and open_run_length >= 2:
        wide_reopenings += 1
    return contact_frames, wide_reopenings


def video_endpoints(video: Path) -> tuple[np.ndarray, np.ndarray]:
    capture = cv2.VideoCapture(str(video))
    ok, first = capture.read()
    if not ok:
        capture.release()
        raise RuntimeError(f"cannot read {video}")
    last = first
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        last = frame
    capture.release()
    return first, last


def person_mae(left: np.ndarray, right: np.ndarray) -> float:
    # Ignore most of the static room and measure the complete person silhouette.
    roi = (slice(60, 1080), slice(120, 650))
    return float(np.mean(np.abs(left[roi].astype(np.int16) - right[roi].astype(np.int16))))


def transition_report() -> dict[str, dict[str, float]]:
    idle_first, _ = video_endpoints(NORMALIZED_ROOT / "xiaotao_idle.mp4")
    report = {}
    for video in sorted(NORMALIZED_ROOT.glob("xiaotao_*.mp4")):
        first, last = video_endpoints(video)
        report[video.stem] = {
            "firstToIdleMae": round(person_mae(first, idle_first), 3),
            "lastToIdleMae": round(person_mae(last, idle_first), 3),
            "firstToLastMae": round(person_mae(first, last), 3),
        }
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--clap-video",
        type=Path,
        default=NORMALIZED_ROOT / "xiaotao_clap.mp4",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    smile_range = face_vertical_range("xiaotao_smile")
    nod_range = face_vertical_range("xiaotao_nod")
    states, contacts = clap_sequence(args.clap_video)
    contact_frames, wide_reopenings = clap_naturalness(states)
    transitions = transition_report()
    report = {
        "nod": {
            "verticalRangePx": nod_range,
            "smileVerticalRangePx": smile_range,
            "minimumRangePx": 20,
            "minimumDifferencePx": 8,
        },
        "clap": {
            "contactEntries": contacts,
            "contactFrames": contact_frames,
            "minimumContactFrames": 15,
            "wideReopenings": wide_reopenings,
            "maximumWideReopenings": 1,
            "runs": compact_runs(states),
        },
        "transitions": {
            "maximumFirstToIdleMae": 2.5,
            "maximumLastToIdleMae": 6.0,
            "actions": transitions,
        },
    }
    failures = []
    if nod_range < 20:
        failures.append(f"nod vertical range is only {nod_range:.1f}px")
    if nod_range - smile_range < 8:
        failures.append("nod is not sufficiently distinct from smile")
    if contact_frames < 15:
        failures.append(f"clap contact is too brief ({contact_frames} frames)")
    if wide_reopenings > 1:
        failures.append(f"clap has {wide_reopenings} mechanical wide reopenings")
    for action, metrics in transitions.items():
        if metrics["firstToIdleMae"] > 2.5:
            failures.append(f"{action} starts too far from idle")
        if metrics["lastToIdleMae"] > 6.0:
            failures.append(f"{action} ends too far from idle")

    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else (
        f"nod={nod_range:.1f}px, smile={smile_range:.1f}px; clap contacts={contacts}"
    ))
    if failures:
        raise SystemExit("; ".join(failures))


if __name__ == "__main__":
    main()
