# Duix Android 真人版验证

这套集成把现有露米后端接到 Duix-Mobile：Android 系统中文语音识别得到文字，通过 `/api/chat/stream` 逐句显示文案；全文结束后调用一次 `/api/speech`，再把 MiniMax 返回的 16 kHz、单声道、16-bit WAV 转为 PCM，在一个 `DUIX.startPush()` / `stopPush()` 会话中播放。

Duix 源码、SDK 和人物模型不复制进本仓库；`companion-bridge.patch` 固定基于 Duix-Mobile 提交 `690fe81dd0bab842d6f7b033ebcefcf30e1b5111`。人物仍受 Duix Community License 约束。

## 已验证结果

- Mac Apple Silicon + Android 14 ARM64 模拟器可以构建和运行 SDK 4.1.1。
- 官方 Lily 模型以 540×960 初始化成功。
- “测试对话”完成了 Android → MiniMax 文案 → MiniMax TTS → WAV → Duix 口型播放闭环。
- 文案仍会逐句显示，但整段回答只合成一个 WAV、只建立一次 AudioTrack 会话，避免两段独立 TTS 在句子边界产生停顿、欠载或音爆；开始新对话或停止播放会取消旧队列。
- MiniMax WAV 含有可变长度的 `LIST/INFO` 元数据，实测 PCM `data` 块从偏移 78 开始而非固定的 44。桥接会按 RIFF chunk 结构定位 `data`，验证 16kHz、单声道、16-bit PCM 后再推送，避免把 WAV 元数据当音频播放造成音爆。
- 一次热启动实测中，首句 3.373 秒到达、完整文案 3.389 秒结束、WAV 4.260 秒就绪、Duix 4.357 秒开始播放。该次首句和全文仅相差 16 毫秒，等待全文换来了无人工音频拼接点的自然停顿。
- “点击说话”可以打开 Google 中文语音识别界面；API Key 始终只在 Node 服务端。
- Lily 的 `motionRegions=[]`，当前只有素材自带的眨眼、轻微头部和身体运动，没有可触发的手势。

## 语义动作桥接

后端 SSE `meta`/`done` 事件会返回 `action`。Android 桥接保留每轮动作，并在音频真正开始时尝试匹配当前模型的 `motionRegions`：优先精确名称，其次使用挥手、鼓掌、思考、欢呼、鞠躬、害羞、惊讶、关心、耸肩、交叉和抱胸的中英文别名。每轮最多触发一次；模型不提供对应区间时记录安全回退，不移动整个人物画面伪造动作。

官方 Lily 没有任何 `motionRegions`，因此这项能力用于后续定制模型验证，不会改变 Lily 当前的待机表现。

## 准备源码

```bash
./integrations/duix-android/prepare.sh
```

脚本把 Duix-Mobile 放到被 Git 忽略的 `.duix-mobile/`，检出已验证提交并应用桥接补丁。需要 Android SDK API 34、NDK 25.1、CMake 3.18.1 和 JDK 17。

在 `.duix-mobile/duix-android/dh_aigc_android/local.properties` 配置本机路径，例如：

```properties
sdk.dir=/Users/你的用户名/Library/Android/sdk
ndk.dir=/Users/你的用户名/Library/Android/sdk/ndk/25.1.8937393
```

然后用 Android Studio 打开 `dh_aigc_android` 并构建 `test` 模块。

## 本地运行

先启动露米后端。桥接补丁默认使用独立的 3417 端口，避免本机其他服务占用 3000：

```bash
PORT=3417 npm start
adb reverse tcp:3417 tcp:3417
```

安装 APK 后，在 Duix 首页使用：

```text
BaseConfig:
https://github.com/duixcom/Duix-Mobile/releases/download/v1.0.0/gj_dh_res.zip

Lily:
https://github.com/duixcom/Duix-Mobile/releases/download/v2.0.1/Lily.zip
```

进入人物页后：

- `测试对话`：发送固定句子，适合检查网络、MiniMax 和口型链路。
- `点击说话`：打开系统中文语音识别；识别结果进入同一对话链路。
- `停止播放` 或再次点击说话：调用 `DUIX.stopAudio()`，支持打断当前回复。

物理 Android 设备调试也可使用 `adb reverse`。如果不通过 ADB，可在启动 `CallActivity` 时传入 `companionBaseUrl`，指向局域网内可访问的后端地址。

## 当前限制

当前需要等待全文生成后再开始一次 TTS。下一阶段只有在 TTS 能返回同一条连续音频流时，才适合通过 `DUIX.pushPcm()` 边收边播；不能再把多次独立 TTS 结果直接拼接，否则会重新引入句间音爆。
