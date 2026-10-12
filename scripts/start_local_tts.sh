#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
engine_dir="${QWEN_TTS_HOME:-$(dirname "$project_dir")/VoiceCloneTTS}"
python_bin="$engine_dir/.venv-mlx/bin/python"
cd "$project_dir"
exec "$python_bin" -m uvicorn tools.local_tts.app:app --host 127.0.0.1 --port "${LOCAL_TTS_PORT:-8020}"
