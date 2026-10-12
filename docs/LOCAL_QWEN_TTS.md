# 本地 Qwen3-TTS 联调

露米的聊天模型由 `AI_PROVIDER` 选择，语音由 `TTS_PROVIDER` 独立选择。
当前 `.env` 已启用 `TTS_PROVIDER=qwen_local`，地址 `http://127.0.0.1:8020`。

## 启动

```bash
npm run start:tts
# 另一个终端启动露米（或使用现有露米启动器）
npm start
```

本地语音识别服务使用 `npm run start:asr`，端口 8010；不要同时在此端口启动 VoiceCloneTTS 旧试听界面。

TTS 使用同级 `VoiceCloneTTS/.venv-mlx` 环境和 `engines/Qwen3-TTS-12Hz-1.7B-Base-bf16` 模型。Python 服务加载模型一次，串行处理推理，复用 M5 GPU 模型；音频不上传云端。模型和依赖初次部署仍需下载。

参考音和校正文字位于 `output/audio/voice_reference_24k.wav`、`output/audio/voice_reference_transcript.txt`，需保留这些本地文件。

可在启动 TTS 服务时设置：

- `QWEN_TTS_SPEED=1.0 npm run start:tts`：原速，当前默认 1.0。
- `QWEN_TTS_HOME`：VoiceCloneTTS 目录。
- `QWEN_TTS_MODEL`、`QWEN_TTS_REFERENCE`、`QWEN_TTS_TRANSCRIPT`：模型、参考音和文本路径。
- `LOCAL_TTS_PORT`：默认 8020；修改时同步 `.env` 的 `LOCAL_TTS_BASE_URL`。

上述 QWEN 参数由 Python 进程读取 shell 环境，修改后重启 TTS 服务。
当前使用原始克隆版（1.0 倍速）。如需放慢，可设 QWEN_TTS_SPEED=0.85，通过 FFmpeg atempo 保持音高；不是模型情绪控制。

## 接入范围和边界

`/api/speech` 返回 WAV；`/api/dinet/speech-stream` 将 16 kHz 单声道 PCM 送入原有真人口型管线。当前本地 TTS 为整段合成后返回，后续人物画面仍按原管线分段，不能将其视作模型首包流式推理。
本地模式不生成额外接话语、不发起 MiniMax TTS 预热，避免占用模型队列。

`/api/health` 的 `ttsProvider` 应为 `qwen_local`，`mode` 仍表示聊天模型。
`http://127.0.0.1:8020/health` 可检查语音服务。

切回 MiniMax：将 `.env` 的 `TTS_PROVIDER=qwen_local` 改成 `TTS_PROVIDER=minimax`，重启露米服务即可。现有云端密钥和配置保留。

## 验证

新增 HTTP 适配器测试覆盖本地请求、错误音频和取消信号。
全量测试 290 项通过，1 项由于工作区原有 `public/dh-live/actions/self_idle/01.mp4` 缺失失败。
真实 `/api/speech` 已验证返回克隆 WAV，短句一次实测约 5.4 秒。性能随文本长度和机器负载变化。
真人口型接口也已实测完成：`慢慢来。` 产生 2 个画面分段，音频约 1.48 秒，TTS 完成约 1.53 秒，首个画面约 1.83 秒，总管线约 2.06 秒。这是短句单次测量，不代表长回答延迟。
