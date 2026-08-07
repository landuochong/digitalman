#!/usr/bin/env bash
set -euo pipefail

integration_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$integration_dir/../.." && pwd)"
duix_dir="${1:-$project_dir/.duix-mobile}"
duix_commit="690fe81dd0bab842d6f7b033ebcefcf30e1b5111"
patch_file="$integration_dir/companion-bridge.patch"

if [[ ! -d "$duix_dir/.git" ]]; then
  git clone https://github.com/duixcom/Duix-Mobile.git "$duix_dir"
fi

git -C "$duix_dir" fetch --depth 1 origin "$duix_commit"
git -C "$duix_dir" checkout --detach "$duix_commit"

if git -C "$duix_dir" apply --check "$patch_file"; then
  git -C "$duix_dir" apply "$patch_file"
elif git -C "$duix_dir" apply --reverse --check "$patch_file"; then
  echo "Duix companion bridge is already applied."
else
  echo "Cannot apply companion bridge; inspect local Duix changes first." >&2
  exit 1
fi

echo "Prepared Duix Android source at: $duix_dir/duix-android/dh_aigc_android"
