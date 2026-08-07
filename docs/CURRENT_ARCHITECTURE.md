# 当前系统架构

更新时间：2026-08-07

本文只描述当前可运行实现；调研过程、失败方案和参数演进统一记录在 `EXPERIMENT_LOG.md`。

## 1. 主链路

```text
浏览器语音识别 / 文字降级输入
  → POST /api/chat/stream
  → 人物设定标准化
  → 召回相关长期记忆和连续状态
  → MiniMax 流式文案（或 OpenAI / demo）
  → 服务端正文清理、身份连续性保护、按句 SSE
  → POST /api/speech
  → 真人：Audio2BlendShape + DINet → 有声 MP4
     动漫：Web Audio 音量 → VRM 口型、表情和动作
  → 播放结束后恢复常驻待机
```

浏览器再次开始录音时会同时取消当前模型流、待处理 TTS、音频/视频播放和动作，保证旧回答不会覆盖新一轮。

## 2. 前端模块

| 文件 | 职责 |
| --- | --- |
| `public/index.html` | 统一聊天页面和控制区 |
| `public/app.js` | 语音识别、聊天历史、SSE、TTS 队列、真人/动漫切换 |
| `public/wav2lip-avatar/avatar.js` | 真人常驻待机层与口型视频层播放 |
| `public/vrm-embed.js` | 统一页内嵌 VRM 桥接 |
| `public/vrm-avatar.js` | VRM 加载、表情、口型、动作和相机控制 |

`/` 是唯一产品主入口。`/vrm.html`、固定 `profile` 和动作制作页只用于单独调试或方案对照。

## 3. 服务端模块

| 文件 | 职责 |
| --- | --- |
| `server.mjs` | HTTP/SSE、聊天和语音供应商、诊断环形缓冲区、本地渲染接口 |
| `src/companion.mjs` | 人物提示词、上下文清理、回复正文清理、情绪和动作推断 |
| `src/memory.mjs` | 本地结构化记忆、召回、去重、衰减和清理 |
| `src/voices.mjs` | TTS 音色白名单、默认项和自定义音色配置解析 |
| `src/dinet-render.mjs` | DINet worker 生命周期、串行任务、缓存和临时文件 |
| `scripts/dinet_worker.py` | Audio2BlendShape、OpenGL 提示图、DINet 重绘和封装 |

所有本地模型、动作上传和诊断接口只允许回环地址访问。外部供应商 Key 从 `.env` 读取，不返回浏览器。

## 4. 聊天请求结构

浏览器每轮发送：

```json
{
  "message": "当前消息",
  "history": [{ "role": "user|assistant", "content": "..." }],
  "userId": "浏览器本地匿名 ID",
  "persona": {
    "name": "人物名字",
    "relationship": "与用户的关系",
    "style": "表达风格",
    "background": "人物背景"
  },
  "fastSpeech": true
}
```

服务端只取最近 10 条有效历史，过滤旧的身份分类、设备限制和位置跳出回答，并合并过滤后相邻的同角色消息。MiniMax 的最终消息顺序是：`system → 历史 user/assistant → 当前 user`。

MiniMax 只生成可朗读正文。`emotion` 和 `action` 在本地推断，不要求模型输出 JSON，因此不会把控制词送进 TTS。流式正文和最终正文都会经过身份连续性保护。

## 5. 音色控制

页面通过 `/api/voices` 取得可选择的公开音色 key。`/api/speech` 只接收 key，服务端再用 `src/voices.mjs` 的白名单映射为 MiniMax `voice_id`，避免客户端直接指定任意账号音色。

内置普通话女声包括甜美、柔和、温暖、成熟、淡雅和嗲气 6 类陪伴音色，以及经典、妩媚、傲娇、强势 4 类御姐音色。选择保存在浏览器 `lumi-voice-profile`，真人和动漫模式共用；切换音色不改变人物提示词、记忆或动作。`MINIMAX_TTS_VOICES_JSON` 可将当前账号的克隆/文生音色加入服务端白名单。

## 6. 人物连续性规则

- 人物以配置的名字、关系、风格和背景作为稳定第一人称。
- 普通生活邀请按共享场景自然继续，例如散步、逛湖边和下楼。
- 不以手机、屏幕、应用、模型或技术机制解释自己为何不能行动。
- 不生成具体住址、危险行为或违法行为；安全边界仍高于人物设定。
- 旧错误回答在进入下一轮模型上下文前过滤，避免一次错误持续污染后续对话。

## 7. 记忆和诊断

结构化记忆落盘到 `data/companion-memory.json`，完整聊天不在服务端持久化。清空按钮调用 `/api/chat/memory/clear`，同时清理该 `userId` 的记忆和连续状态。

`/api/chat/debug/recent` 提供最近 20 次请求的内存诊断，用于比较：

1. 浏览器实际发送的人物设定和历史；
2. 服务端召回的记忆和连续状态；
3. 发给供应商的最终消息数组；
4. 模型原始正文；
5. 已发送的 SSE 分句；
6. 页面应采用的最终结果。

诊断数据不落盘，服务重启后清空。

## 8. 真人渲染边界

DINet 当前采用“完整回答 → 单次 TTS WAV → 整段 MP4”的方式。常驻 worker 的推理速度已经快于实时，但首句仍需等待全文、TTS 和首个 MP4。下一阶段的性能优化应是分句流水线或 fMP4/WebM/WebRTC 增量传输，而不是继续压缩帧率或减小网络。

真人动作来自预录底片，动作种类受素材限制；VRM 动作来自标准骨骼姿势，控制能力更强。两种渲染层共享语义动作名，但不能直接共享底层动作资源。

## 9. 验收基线

- `npm test` 全部通过；
- `/api/health` 返回当前供应商和模型；
- `/api/dinet/status` 的 `ready` 为 `true`；
- 真人回答结束不闪白、不双声，WAV 不播放 RIFF 元数据；
- 动漫人物切换后首次构图居中，动作期间根节点不横移；
- 人物名字、背景与页面实际保存值一致；
- “带你出去玩 / 下楼”等场景不出现“我在手机里”或技术身份解释。
