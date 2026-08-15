#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="$project_dir/experiments/liveportrait"
python_bin="$project_dir/.venv-liveportrait/bin/python"

usage() {
  echo "用法: $0 <源图片或视频> <驱动视频或pkl> [输出目录] [eyes|exp|pose|lip|all] [强度]" >&2
  echo "示例: $0 idle.mp4 blink.mp4 experiments/liveportrait-output eyes 0.35" >&2
}

if [[ $# -lt 2 || $# -gt 5 ]]; then
  usage
  exit 2
fi

source_media="$1"
driving_media="$2"
output_dir="${3:-$project_dir/experiments/liveportrait-output}"
region="${4:-eyes}"
multiplier="${5:-0.35}"

if [[ ! -f "$source_media" ]]; then
  echo "源素材不存在：$source_media" >&2
  exit 2
fi
if [[ ! -f "$driving_media" ]]; then
  echo "驱动素材不存在：$driving_media" >&2
  exit 2
fi
if [[ ! -f "$source_dir/inference.py" || ! -x "$python_bin" ]]; then
  echo "LivePortrait 环境未就绪，请先运行 scripts/setup_liveportrait_macos.sh" >&2
  exit 2
fi
case "$region" in
  eyes|exp|pose|lip|all) ;;
  *)
    echo "不支持的驱动区域：$region" >&2
    exit 2
    ;;
esac
if [[ ! "$multiplier" =~ ^(0([.][0-9]+)?|1([.]0+)?)$ ]]; then
  echo "强度必须是 0 到 1 之间的小数：$multiplier" >&2
  exit 2
fi

mkdir -p "$output_dir"
export NO_ALBUMENTATIONS_UPDATE=1
export PYTORCH_ENABLE_MPS_FALLBACK=1

exec "$python_bin" "$source_dir/inference.py" \
  --source "$source_media" \
  --driving "$driving_media" \
  --output-dir "$output_dir" \
  --animation-region "$region" \
  --driving-multiplier "$multiplier" \
  --no-flag-normalize-lip \
  --flag-stitching \
  --flag-pasteback
