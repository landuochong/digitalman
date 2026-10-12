# 露米 · 语音数字人好友

一个本地优先、语音优先的数字人好友实验项目。用户说完一句话后，浏览器把本地录音交给 Sherpa-ONNX 识别；服务端流式生成中文回复并合成女性语音，真人或 VRM 动漫人物同步完成口型、表情和低幅动作。真人与动漫共用同一套聊天、人物设定、记忆和打断机制，可以在主页面直接切换。

当前实现和模块边界见 [当前架构](docs/CURRENT_ARCHITECTURE.md)，完整调研与实验过程见 [实验日志](docs/EXPERIMENT_LOG.md)。

页面模式、微动作和收尾规则见 [AI 相框播放规则](docs/ALBUM_PLAYBACK.md)；嘴唇覆盖、颜色匹配的原因与修复方法见 [真人口型配置与校准](docs/REAL_AVATAR_MOUTH_CALIBRATION.md)。

## 当前能力

- 语音优先交互，默认使用仓库内独立的 Sherpa-ONNX/SenseVoice 服务；服务不可用时可回退浏览器识别，也保留文字输入。
- 支持 MiniMax、OpenAI 和无 Key 演示模式；API Key 只存在于 Node 服务端。
- MiniMax 文案按句流式返回，TTS、动作准备和界面状态并行执行，支持用户中途打断。
- 主页面直接切换真人 DINet 神经口型与 VRM 动漫人物，不重建聊天上下文。
- VRM 支持 5 套造型、360° 观察、3 种待机姿势和 11 种对话动作。
- 人物设置支持名字、关系、说话风格和背景；每轮请求都会作为系统消息的第一部分发送给模型。
- 本地保存少量结构化长期记忆与衰减后的交流状态；“清空对话”会同时清除浏览器历史、服务端记忆和情绪连续状态。
- 本机内存保留最近 20 次聊天诊断，可核对前端输入、模型请求、原始输出、流式分句与最终正文；服务重启后自动消失。

## 快速启动

要求 Node.js 18 或更高版本。首次运行需要安装依赖：

```bash
npm install
cp .env.example .env
# 编辑 .env；不配置 Key 时自动进入演示模式
npm start
```

首次安装本项目自带的本地 ASR，然后分别启动 ASR 和主服务：

```bash
npm run setup:asr
npm run start:asr
npm start
```

本地 ASR 直接使用 `sherpa-onnx` 和 SenseVoice，不依赖 WALL-E、AgentVoiceGateway
或 xiaozhi-server。约 228 MB 的模型权重下载到忽略提交的
`resources/models/sensevoice/`。页面录制 16 kHz 单声道 PCM WAV，经当前 Node
服务的 `/api/asr/transcribe` 同源代理送到本机 ASR；浏览器不会直接访问 8010 端口。

开发模式可使用 `npm run dev`。源码变更触发重启时，服务会先释放 HTTP 端口并关闭 TTS 预连接和 DINet 常驻 worker，再启动新实例；无需手动查杀残留 Node/Python 进程。

如果 3000 端口已被占用：

```bash
PORT=3417 npm start
```

## 页面与实验入口

| 地址 | 用途 | 状态 |
| --- | --- | --- |
| `/` | 真人 DINet / VRM 动漫统一聊天页 | 当前主入口 |
| `/?profile=anime` | 直接以动漫模式打开统一页 | 可用 |
| `/?profile=dinet` | 固定 DINet 真人神经口型 | 当前真人主路线 |
| `/?profile=wav2lip` | Wav2Lip256 对照实验 | 可用，等待整段渲染 |
| `/?profile=clean` | Canvas 嘴形图集洁净室实验 | 保留的失败对照 |
| `/?profile=lakeside` | MiniMax 湖畔素材 + DH_live | 旧路线对照 |
| `/vrm.html` | 独立 VRM 调试页与动作测试 | 调试入口 |
| `/dh-action-studio.html` | 本机真人动作视频检查和预处理 | 调试入口 |

默认真人模式依赖本地 DINet 环境和模型。如果只验证聊天、人物设置或动漫动作，可以切换到动漫模式；DINet 所需文件可通过 `/api/dinet/status` 检查。

## 服务配置

本地语音识别：

```dotenv
ASR_PROVIDER=local_sherpa
LOCAL_ASR_BASE_URL=http://127.0.0.1:8010
LOCAL_ASR_PATH=/api/asr/transcribe
LOCAL_ASR_BROWSER_FALLBACK=1
```

`LOCAL_ASR_BROWSER_FALLBACK=1` 表示本地 ASR 未启动或一次识别失败时恢复原有 Web Speech 入口。`GET /api/asr/status` 同时检查配置和本地 ASR 健康状态。独立 ASR 服务只返回文字，不包含小车控制、即时通信或 TTS 功能。

MiniMax 示例：

```dotenv
AI_PROVIDER=minimax
MINIMAX_API_KEY=你的聊天与语音Key
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_TTS_BASE_URL=https://api-bj.minimaxi.com/v1
MINIMAX_TEXT_MODEL=MiniMax-M3
MINIMAX_CHAT_WARMUP=0
MINIMAX_HEDGE_DELAY_MS=0
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_VOICE=female-tianmei
```

`MINIMAX_CHAT_WARMUP` 默认是 `0`：启动服务不会为“预热”自动生成一次文案请求。现有冷启动 A/B 未证明它能稳定消除 M3 长尾，频繁重启反而会重复计费并可能与首轮用户请求竞争。只有长期稳定部署自行验证有收益后才设为 `1`；`/api/health` 的 `chatWarmupEnabled` 可确认实际状态。

`MINIMAX_HEDGE_DELAY_MS` 默认是 `0`，不会增加请求。若更在意极端长尾且可以接受慢请求可能产生一次额外调用，可设为 `2500`：主请求 2.5 秒仍未取得响应头时启动第二条相同请求，先建立流的一条继续，另一条立即取消。服务端本机诊断记录会写出 `providerConnection.hedged` 和 `winner`，方便确认是否实际触发。

人物设置中的“声音类型”会从服务端 `/api/voices` 加载。MiniMax 模式内置甜美、柔和、温暖、成熟、淡雅、嗲气 6 种陪伴女声，以及经典御姐、妩媚御姐、傲娇御姐、强势小姐 4 种御姐音色，用户选择保存在浏览器；`MINIMAX_TTS_VOICE` 决定第一次打开时的默认项。音色只影响 TTS，不会写入人物提示词或聊天历史。

如需加入当前账号的克隆音色或文生音色，可在 `.env` 配置服务端白名单：

```dotenv
MINIMAX_TTS_VOICES_JSON={"lili":{"label":"丽丽专属","description":"我的克隆音色","voiceId":"你的voice_id"}}
```

浏览器只提交 `lili` 这样的公开 key，真正的 `voice_id` 只由服务端解析。当前账号可用的完整音色可通过 MiniMax `POST /v1/get_voice` 查询。

OpenAI 示例：

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=你的Key
OPENAI_TEXT_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=nova
```

MiniMax 视频生成使用独立的 `MINIMAX_VIDEO_API_KEY`，避免测试视频额度与聊天、TTS Key 混用。不要把任何 Key 写进浏览器代码、日志、提交记录或文档。

## 人物设定和聊天上下文

人物设置保存在浏览器的 `lumi-vrm-persona`，字段包括：

- `name`：人物名字；
- `relationship`：与用户的关系；
- `style`：语言风格；
- `background`：稳定的兴趣、性格和生活背景。

每次请求的顺序固定为：

```text
人物系统设定
→ 相关长期记忆与低幅连续状态
→ 最近最多 10 条有效历史消息
→ 当前用户消息
```

系统设定要求人物保持真实、连续的第一人称体验。散步、出门、下楼等普通生活场景按共同经历自然接话，不以手机、屏幕、程序或技术身份为理由拒绝。旧历史中此类身份跳出回复会在发送前过滤；过滤造成的相邻同角色消息会自动合并，避免破坏 MiniMax 的消息顺序。

## 本地记忆与清理

长期记忆默认写入 `data/companion-memory.json`，文件权限为 `0600`，`data/` 已被 Git 忽略。可通过 `MEMORY_FILE` 指定其他路径。

当前只提取少量明确内容：用户称呼、喜欢或不喜欢的事物、明确的“请记住”命令，以及带时间的待跟进事项。手机号、邮箱、证件、银行卡、密码、验证码、详细住址和疑似提示词注入不会保存。“你还记得我刚才说什么吗”这类问题不会被误判为记忆命令。

页面右上角的清空按钮会调用 `/api/chat/memory/clear`，同时删除当前浏览器聊天历史、该用户的结构化记忆和交流状态。

当由 Codex Digitalman Launcher 启动时，服务会从进程环境接收 Session Bridge 的本机地址和短期令牌。浏览器只通过同源 `/api/codex-session/*` 代理提交最终用户文本和实际播放完成的助手文本；令牌不会发送到页面，音频、视频、语音中间结果和人物记忆也不会进入 Bridge。结束语音通话或清空当前对话会显式结束该临时会话。直接使用 `npm start` 时未配置 Bridge，聊天功能保持原样并自动降级为不记录 Codex 临时会话。

## 真人口型

当前主路线为 Audio2BlendShape + DINet：

- 常驻 Python worker 一次加载 LSTM、DINet、人物帧、参考特征和网格；
- MiniMax 返回 16 kHz、单声道 PCM WAV；解析器按 RIFF chunk 查找真正的 `data` 块，不假设固定 44 字节头；
- LSTM 生成连续 6 维嘴形系数，DINet 在 184×184 局部区域重绘嘴部；
- 湖畔人物使用嘴宽、形变幅度与珊瑚粉唇色校准；
- 浏览器使用常驻待机层和有声口型层双视频叠加，回答结束淡出上层，不换空画面，因此不会闪白。

真人共用同一套 Audio2BlendShape/DINet 口型逻辑，每个人物的尺寸、位置和唇色参数配置在
[`config/real-avatar-mouth-profiles.json`](config/real-avatar-mouth-profiles.json)。修改配置后需要重启服务；配置内容会进入生成视频缓存键，不会误用旧参数生成的口型。

| 参数 | 作用 | 允许范围 |
| --- | --- | --- |
| `mouthMotionScale` | 六维 BlendShape 的整体动作幅度 | 0.65–1.15 |
| `mouthWidthScale` | 合成嘴部区域的横向比例 | 0.65–1.10 |
| `mouthHeightScale` | 合成嘴部区域的纵向比例 | 0.75–1.15 |
| `compositeCenterX/Y` | 嘴部合成区域在人脸局部图中的中心 | X 0.42–0.58；Y 0.32–0.52 |
| `lipColorCenterX/Y` | 唇色采样与恢复区域的中心 | X 0.42–0.58；Y 0.40–0.58 |
| `lipColorStrength` | 原人物唇色恢复强度；0 为关闭 | 0–1 |
| `lipBrightnessOffset` | 唇部区域最终亮度补偿 | -12–20 |
| `teethStrength` | 小开口时上牙恢复层的混合强度；0 为关闭 | 0–1 |

新增真人角色时，应同时在人物动作目录和该配置文件的 `characters` 中增加同名条目。`defaults` 只用于未知人物的安全回退。

具体调参顺序、当前人物基线、症状对照、缓存规则和验收命令见 [真人口型配置与校准](docs/REAL_AVATAR_MOUTH_CALIBRATION.md)。

已验证的整句渲染 RTF 约为 0.33–0.35，推理快于实时。当前默认链路不再等待完整 TTS：WebSocket TTS 返回 PCM 后，240 ms 首音频窗口立即进入 DINet 并追加到连续 fMP4。已有真实样本表明主要长尾多发生在 M3 正文输出前；之后按匿名自然对话汇总分别判断 M3、TTS、DINet 和浏览器交接，不再凭单次感觉重复调参。详细原理见 [DH_live 原理分析](docs/DH_LIVE_PRINCIPLE_ANALYSIS.md) 和 [当前架构](docs/CURRENT_ARCHITECTURE.md)。

## VRM 动漫人物

动漫模式使用 `three.js`、`@pixiv/three-vrm` 和 `@pixiv/three-vrm-animation`。待机只保留低幅呼吸、自然眨眼和小范围注视；一轮回答最多触发一个明显动作，动作从首段音频实际播放时开始，持续到该段语音结束。

支持的对话动作：挥手、鼓掌、欢呼、鞠躬、害羞、思考、关心、惊讶、耸肩、交叉手势、抱胸。待机姿势：自然下垂、指尖轻触、双臂抱胸。人物区支持拖动旋转、滚轮缩放、右键平移和双击复位。

项目分发 3 套造型。Nike-chan v1/v2 仅允许符合其条款的个人非商用使用，模型二进制不进入仓库；详见 [VRM 第三方说明](public/vrm/THIRD_PARTY.md) 和 [动作资源说明](public/vrm/motions/THIRD_PARTY.md)。

## 诊断与验证

```bash
npm test
curl http://localhost:3000/api/health
curl http://localhost:3000/api/dinet/status
# 配置真实 Key 后执行，会产生少量 API 用量
npm run test:live
```

聊天链路诊断仅允许本机访问：

```bash
curl http://localhost:3000/api/chat/debug/recent
curl http://localhost:3000/api/chat/debug/summary
```

返回内容最多 20 条，只保存在当前 Node 进程内存中，包含人物设定、实际历史顺序、发给模型的消息、MiniMax 原始正文、已发送的流式短句和最终结果，不包含 API Key。

正常语音聊天还会把浏览器的 VAD 停顿、TTS、DINet、视频首帧和真实开口耗时按 `traceId` 自动合并到对应记录的 `clientTimings`。这份上报只含白名单数值与事件类型，不增加模型请求，也不会阻塞人物播放。

`/api/chat/debug/summary` 只返回这些计时的聚合结果，不包含聊天内容。`speechPipelineFirstSegment` 表示含 TTS 的人物首片段总流水线，`avatarRender` 才是 DINet 首片段自身耗时；`backchannelToFormal` 表示最后一段接话播放完成到正式回答开口的真实沉默空档。瓶颈判断使用纯渲染时间，避免重复归因。至少积累 3 个有效样本后才判断当前主慢阶段；样本不足时返回 `dominantStage: "insufficient-data"`。原始诊断仍只在内存中；人物正式正文真实开口时，最近 100 条匿名计时样本会持久化到 `data/chat-latency-samples.json`，无需等待整轮播放结束，跨重启保留且不包含时间戳、`traceId`、用户标识、人物设定或聊天正文。

## 相关文档

- [当前架构](docs/CURRENT_ARCHITECTURE.md)
- [完整实验日志](docs/EXPERIMENT_LOG.md)
- [真人洁净口型边界](docs/CLEAN_AVATAR_ARCHITECTURE.md)
- [DH_live / DINet 原理分析](docs/DH_LIVE_PRINCIPLE_ANALYSIS.md)
- [真人口型配置与校准](docs/REAL_AVATAR_MOUTH_CALIBRATION.md)
- [LiveTalking 参考结论](docs/LIVETALKING_REFERENCE.md)
- [DH_live 动作制作](integrations/dh-live/README.md)
- [Duix Android 验证](integrations/duix-android/README.md)

## 隐私与发布边界

服务端不落盘保存完整聊天；浏览器仅保留有限历史。本地文件只保存经过过滤的结构化记忆和有界匿名延迟样本；含聊天正文的原始诊断仍是短期内存数据，服务重启即消失。生产部署仍需增加账户隔离、权限认证、内容安全、限流、用户可见的记忆管理和危机干预流程，并重新核对所有人物模型、动作、推理权重和生成素材的许可证。
