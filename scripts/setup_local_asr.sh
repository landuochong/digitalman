#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
venv_dir="$project_dir/.venv-asr"
model_dir="$project_dir/resources/models/sensevoice"
if [[ -n "${PYTHON_BIN:-}" ]]; then
  python_bin="$PYTHON_BIN"
elif command -v python3.10 >/dev/null 2>&1; then
  python_bin="$(command -v python3.10)"
else
  python_bin="python3"
fi
model_base_url="${SENSEVOICE_MODEL_BASE_URL:-https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master}"
model_sha256="c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51"
tokens_sha256="f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc"

if [[ ! -x "$venv_dir/bin/python" ]]; then
  "$python_bin" -m venv "$venv_dir"
fi
"$venv_dir/bin/python" -m pip install --upgrade pip
"$venv_dir/bin/python" -m pip install -r "$project_dir/tools/local_asr/requirements.txt"

if [[ ! -f "$model_dir/model.int8.onnx" || ! -f "$model_dir/tokens.txt" ]]; then
  mkdir -p "$model_dir"
  curl -fL --retry 3 "$model_base_url/model.int8.onnx" -o "$model_dir/model.int8.onnx.part"
  curl -fL --retry 3 "$model_base_url/tokens.txt" -o "$model_dir/tokens.txt.part"
  echo "$model_sha256  $model_dir/model.int8.onnx.part" | shasum -a 256 -c -
  echo "$tokens_sha256  $model_dir/tokens.txt.part" | shasum -a 256 -c -
  mv "$model_dir/model.int8.onnx.part" "$model_dir/model.int8.onnx"
  mv "$model_dir/tokens.txt.part" "$model_dir/tokens.txt"
fi

echo "本地 ASR 已准备完成：$model_dir"
