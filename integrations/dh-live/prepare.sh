#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
dh_live_dir="${1:-$project_dir/experiments/dh-live}"
dh_live_commit="6a1ee7d3aeb310e244bc6d6ce7703e7e8cdfbef9"
patch_files=(
  "$project_dir/integrations/dh-live/macos-preprocess.patch"
  "$project_dir/integrations/dh-live/macos-render.patch"
)
checkpoint_source="$project_dir/resources/models/DINet_mini/epoch_40_new.pth"
checkpoint_target="$dh_live_dir/checkpoint/DINet_mini/epoch_40_new.pth"

if [[ ! -d "$dh_live_dir/.git" ]]; then
  git clone https://github.com/kleinlee/DH_live.git "$dh_live_dir"
fi

git -C "$dh_live_dir" fetch --depth 1 origin "$dh_live_commit"
git -C "$dh_live_dir" checkout --detach "$dh_live_commit"

for patch_file in "${patch_files[@]}"; do
  if git -C "$dh_live_dir" apply --check "$patch_file"; then
    git -C "$dh_live_dir" apply "$patch_file"
  elif ! git -C "$dh_live_dir" apply --reverse --check "$patch_file"; then
    echo "DH_live macOS patch cannot be applied cleanly: $patch_file" >&2
    exit 1
  fi
done

if [[ ! -f "$checkpoint_source" ]]; then
  echo "Missing checkpoint: $checkpoint_source" >&2
  exit 1
fi

mkdir -p "$(dirname "$checkpoint_target")"
if [[ ! -f "$checkpoint_target" ]]; then
  cp "$checkpoint_source" "$checkpoint_target"
fi

echo "Prepared DH_live source at: $dh_live_dir"
