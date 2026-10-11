#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
python_bin="$project_dir/.venv-asr/bin/python"

if [[ ! -x "$python_bin" ]]; then
  echo "本地 ASR 尚未安装，请先运行 ./scripts/setup_local_asr.sh" >&2
  exit 1
fi

cd "$project_dir"
exec "$python_bin" -m uvicorn tools.local_asr.app:app \
  --host "${LOCAL_ASR_HOST:-127.0.0.1}" \
  --port "${LOCAL_ASR_PORT:-8010}"
