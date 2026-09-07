#!/usr/bin/env python3
"""Build stable per-frame lip masks for the project-owned DINet avatars."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

import cv2
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DH_LIVE_ROOT = PROJECT_ROOT / "experiments" / "dh-live"
sys.path.insert(0, str(DH_LIVE_ROOT))

from talkingface.data.few_shot_dataset import get_image  # noqa: E402


MASK_FILENAME = "mouth_masks-v1.npz"
CHARACTER_PREFIXES = ("bedroom_", "xiaotao_")


def profile_for(asset: Path) -> dict[str, float]:
    config = json.loads((PROJECT_ROOT / "config" / "real-avatar-mouth-profiles.json").read_text())
    character = "xiaotao" if asset.name.startswith("xiaotao_") else "lumi"
    return {**config["defaults"], **config["characters"][character]}


def lip_mask(source: np.ndarray, profile: dict[str, float]) -> tuple[np.ndarray, bool]:
    height, width = source.shape[:2]
    yy, xx = np.ogrid[:height, :width]
    center_x = width * profile["lipColorCenterX"]
    center_y = height * profile["lipColorCenterY"]
    roi = (((xx-center_x)/(width*.255))**2+((yy-center_y)/(height*.082))**2)<=1
    hsv = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2LAB)
    hue = hsv[:, :, 0].astype(np.float32)
    signed_hue = np.where(hue > 90, hue - 180, hue)
    candidate = (roi & (np.abs(signed_hue)<=20) & (hsv[:,:,1]>=58)
                 & (hsv[:,:,2]<=248) & (lab[:,:,1]>=137)).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(candidate, 8)
    selected = np.zeros_like(candidate)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        component_width = int(stats[label, cv2.CC_STAT_WIDTH])
        component_x, component_y = centroids[label]
        if area < 2 or component_width < 2:
            continue
        if abs(component_x-center_x)>width*.19 or abs(component_y-center_y)>height*.065:
            continue
        selected[labels == label] = 1
    if np.count_nonzero(selected) < 12:
        return np.zeros_like(candidate, dtype=np.uint8), False
    selected = cv2.morphologyEx(selected, cv2.MORPH_CLOSE, np.ones((3,5),np.uint8))
    selected = cv2.dilate(selected, np.ones((3,3),np.uint8), iterations=1)
    soft = cv2.GaussianBlur(selected.astype(np.float32),(0,0),sigmaX=.8)
    mask = np.clip(soft*255,0,255).astype(np.uint8)
    support = mask > 18
    support_y, support_x = np.where(support)
    box_area = ((support_x.max()-support_x.min()+1)*(support_y.max()-support_y.min()+1))
    solidity = np.count_nonzero(support)/max(box_area,1)
    if solidity < .68:
        return np.zeros_like(mask), False
    return mask, True


def build_asset(asset: Path) -> dict:
    with gzip.open(asset/"combined_data.json.gz","rt",encoding="utf-8") as file:
        combined=json.load(file)
    json_data=combined["json_data"]
    standard_size=int(combined.get("size",128))*2
    profile=profile_for(asset)
    cap=cv2.VideoCapture(str(asset/"01.mp4"))
    masks=[]; valid=[]
    count=min(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),len(json_data))
    for index in range(count):
        ok,bgr=cap.read()
        if not ok: break
        frame=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGBA)
        source=get_image(frame,json_data[index]["rect"],input_type="image",resize=standard_size)
        mask,is_valid=lip_mask(source,profile)
        masks.append(mask);valid.append(is_valid)
    cap.release()
    if not masks: raise ValueError(f"没有可用帧：{asset}")
    if not any(valid): raise ValueError(f"所有嘴部遮罩均无效：{asset}")
    output=asset/MASK_FILENAME
    stacked=np.stack(masks)
    np.savez_compressed(output,masks=stacked,valid=np.asarray(valid,np.uint8),version=np.asarray([1],np.uint8))
    coverage=np.count_nonzero(stacked,axis=(1,2))
    return {"asset":asset.name,"frames":len(masks),"detected":int(sum(valid)),
            "coverageMin":int(coverage.min()),"coverageMax":int(coverage.max()),"bytes":output.stat().st_size}


def main() -> None:
    parser=argparse.ArgumentParser();parser.add_argument("assets",nargs="*",type=Path);args=parser.parse_args()
    root=PROJECT_ROOT/"public"/"dh-live"/"actions"
    assets=args.assets or sorted(
        item for item in root.iterdir()
        if item.is_dir()
        and item.name.startswith(CHARACTER_PREFIXES)
        and (item/"combined_data.json.gz").is_file()
    )
    for asset in assets: print(json.dumps(build_asset(asset.resolve()),ensure_ascii=False))


if __name__ == "__main__": main()
