#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="$project_dir/experiments/liveportrait"
venv_dir="$project_dir/.venv-liveportrait"
cache_dir="$project_dir/.cache/uv-liveportrait"
mirror="${LIVEPORTRAIT_HF_ENDPOINT:-https://hf-mirror.com}"
repo="KlingTeam/LivePortrait"

mkdir -p "$project_dir/experiments" "$cache_dir"
if [[ ! -d "$source_dir/.git" ]]; then
  git clone --depth 1 https://github.com/KlingAIResearch/LivePortrait.git "$source_dir"
fi

if [[ ! -x "$venv_dir/bin/python" ]]; then
  UV_CACHE_DIR="$cache_dir" uv venv --python /opt/homebrew/bin/python3.10 "$venv_dir"
fi

UV_CACHE_DIR="$cache_dir" uv pip install --python "$venv_dir/bin/python" -r "$source_dir/requirements_macOS.txt"
# The official file still pins PyTorch 2.3. On Apple Silicon that version sends
# 3D grid sampling back to the CPU. PyTorch 2.13 executes the operator on MPS;
# torchaudio is not used by LivePortrait and its old exact torch pin conflicts.
UV_CACHE_DIR="$cache_dir" uv pip install --python "$venv_dir/bin/python" \
  "torch==2.13.0" "torchvision==0.28.0"
UV_CACHE_DIR="$cache_dir" uv pip uninstall --python "$venv_dir/bin/python" torchaudio || true
# albumentations 1.4.10 declares only a lower bound. Newer albucore releases
# removed preserve_channel_dim, so the official import currently needs this
# compatible version until the upstream requirements file adds an upper bound.
UV_CACHE_DIR="$cache_dir" uv pip install --python "$venv_dir/bin/python" "albucore==0.0.12"

weights=(
  "insightface/models/buffalo_l/2d106det.onnx|5030888|f001b856447c413801ef5c42091ed0cd516fcd21f2d6b79635b1e733a7109dbf"
  "insightface/models/buffalo_l/det_10g.onnx|16923827|5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91"
  "liveportrait/base_models/appearance_feature_extractor.pth|3387959|5279bb8654293dbdf327030b397f107237dd9212fb11dd75b83dfb635211ceb5"
  "liveportrait/base_models/motion_extractor.pth|112545506|251e6a94ad667a1d0c69526d292677165110ef7f0cf0f6d199f0e414e8aa0ca5"
  "liveportrait/base_models/spade_generator.pth|221813590|4780afc7909a9f84e24c01d73b31a555ef651521a1fe3b2429bd04534d992aee"
  "liveportrait/base_models/warping_module.pth|182180086|2f61a6f265fe344f14132364859a78bdbbc2068577170693da57fb96d636e282"
  "liveportrait/landmark.onnx|114666491|31d22a5041326c31f19b78886939a634a5aedcaa5ab8b9b951a1167595d147db"
  "liveportrait/retargeting_models/stitching_retargeting_module.pth|2393098|3652d5a3f95099141a56986aaddec92fadf0a73c87a20fac9a2c07c32b28b611"
)

for entry in "${weights[@]}"; do
  IFS='|' read -r relative expected_size expected_sha <<<"$entry"
  target="$source_dir/pretrained_weights/$relative"
  mkdir -p "$(dirname "$target")"
  current_size="$(stat -f '%z' "$target" 2>/dev/null || echo 0)"
  current_sha="$(shasum -a 256 "$target" 2>/dev/null | awk '{print $1}' || true)"
  if [[ "$current_size" == "$expected_size" && "$current_sha" == "$expected_sha" ]]; then
    echo "已校验 $relative"
    continue
  fi
  partial="$target.part"
  curl -fL --retry 3 --connect-timeout 15 \
    "$mirror/$repo/resolve/main/$relative?download=true" -o "$partial"
  actual_size="$(stat -f '%z' "$partial")"
  actual_sha="$(shasum -a 256 "$partial" | awk '{print $1}')"
  if [[ "$actual_size" != "$expected_size" || "$actual_sha" != "$expected_sha" ]]; then
    echo "权重校验失败：$relative" >&2
    exit 1
  fi
  mv "$partial" "$target"
  echo "已下载并校验 $relative"
done

NO_ALBUMENTATIONS_UPDATE=1 "$venv_dir/bin/python" - <<'PY'
import albumentations
import albucore
import cv2
import onnxruntime
import torch

print(f"LivePortrait 环境就绪：torch={torch.__version__}, albumentations={albumentations.__version__}, albucore={albucore.__version__}")
print(f"MPS 可用={torch.backends.mps.is_available()}")
print(f"ONNX providers={onnxruntime.get_available_providers()}, OpenCV={cv2.__version__}")
PY

UV_CACHE_DIR="$cache_dir" uv pip check --python "$venv_dir/bin/python"
