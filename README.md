# 露米 · AI 虚拟好友

一个可直接运行的语音优先数字人好友：点击麦克风说话，识别结束后自动发送，AI 通过语音回答；支持多轮上下文、音频驱动嘴型，以及眨眼、呼吸、注视和情绪表情。字幕默认关闭，可按需开启。没有 API Key 时会自动进入本地演示模式。

完整的调研、实验过程、问题记录和 VRM 路线决策见 [docs/EXPERIMENT_LOG.md](docs/EXPERIMENT_LOG.md)。

Duix-Mobile 真人版的 Android 桥接、复现步骤和当前限制见 [integrations/duix-android/README.md](integrations/duix-android/README.md)。

真人预录动作路线对 LiveTalking 的源码分析、可移植部分和三段视频录制规范见 [docs/LIVETALKING_REFERENCE.md](docs/LIVETALKING_REFERENCE.md)。

把新录制视频自动制作成 DH_live 动作包的命令和 macOS 环境准备见 [integrations/dh-live/README.md](integrations/dh-live/README.md)。

服务启动后也可以打开 <http://localhost:3000/dh-action-studio.html> 使用本地“真人动作制作”页面：选择视频后先检查规格，再启动预处理并查看实时日志。上传和任务接口只接受本机访问，视频保存在 Git 已忽略的 `data/dh-action-uploads/`，不会发送到外部网站。

## 启动

要求 Node.js 18 或更高版本，无需安装依赖。

```bash
cp .env.example .env
# 编辑 .env，配置 OpenAI 或 MiniMax；只体验演示模式可跳过
npm start
```

打开 <http://localhost:3000>。推荐 Chrome 或 Edge，以获得浏览器语音识别能力。

- 真人视频实验版：<http://localhost:3000/>
- 常驻 DINet 真人口型版（MiniMax 16 kHz WAV）：<http://localhost:3000/?profile=dinet>
- Wav2Lip256 对照版：<http://localhost:3000/?profile=wav2lip>
- VRM 动漫版：<http://localhost:3000/vrm.html>

VRM 版使用独立的参数化骨骼、表情和音频嘴型系统：待机时只保留低幅呼吸、自然眨眼和小范围注视；每轮最多触发一个有冷却时间的手势，避免持续摇晃。当前可触发 11 种对话动作：挥手、鼓掌、欢呼、鞠躬、害羞、思考、关心、惊讶、耸肩、交叉手势和抱胸；另有自然下垂、指尖轻触、双臂抱胸 3 种待机姿势。页面提供三套随项目分发的造型，以及两套需要本地放置的 Nike-chan 可选造型，选择会保存在浏览器。人物区支持 360° 自由观察：左键/单指拖动旋转、滚轮缩放、右键拖动平移、双击恢复默认构图。右上角“角色设定”可选择温暖好友、元气伙伴、冷静知己，也可配置名字、关系和说话风格；角色设定只进入文案提示词，不会作为隐藏文字送入语音。依赖、模型来源和不同模型的许可条件记录在 [public/vrm/THIRD_PARTY.md](public/vrm/THIRD_PARTY.md)。

如果 3000 端口已被占用，可使用 `PORT=3417 npm start`，然后打开对应端口。

## 本地长期记忆

参考 `xiyu-ai` 的分层记忆、权重、衰减、去重与召回思路，项目会从用户明确表达中保存少量长期信息：希望使用的称呼、喜欢或不喜欢的事物、明确要求记住的内容，以及明天/下周等需要后续跟进的事项。回答前只召回与当前话题相关的最多 6 条记忆；回答后再异步写入，不阻塞流式文案和语音。

默认文件为 `data/companion-memory.json`，权限设置为仅当前用户可读写，且整个 `data/` 目录已被 Git 忽略。可用 `MEMORY_FILE` 指定其他位置。手机号、邮箱、证件、银行卡、密码、验证码和详细住址不会进入记忆；疑似提示词注入内容也会被拒绝。当前版本不保存完整服务端聊天记录。

同一文件还保存非恋爱数值化的对话连续状态：交流次数只用于形成“初识、熟悉、亲近、默契”的语气提示；上一轮平静、愉快、关切、好奇或兴奋心境会按 1.5 小时半衰期自然减弱。当前消息的明确情绪永远优先，延续状态只影响措辞和低幅表情，不会重复触发挥手、鼓掌等明显动作，也不会向用户展示隐藏数值。

## 两种运行模式

- 演示模式：内置本地回复，使用系统中文语音；可验证完整 UI、数字人表情和近似嘴型。
- OpenAI 模式：后端通过 Responses API 生成回复，通过 Speech API 生成 MP3。
- MiniMax 模式：后端通过 Chat Completions 流式生成纯朗读正文，服务端按句发送给 Speech 2.8 合成 16 kHz 单声道 WAV。情绪和动作在本地分析，与朗读正文完全分离。API Key 始终只保存在服务端。

默认文本模型为 `gpt-5.6-luna`，适合高频好友对话的成本与响应速度；可用 `OPENAI_TEXT_MODEL` 覆盖。默认语音模型为低延迟的 `tts-1`，声音为 `nova`。

## 嘴型与表情设计

- 语音播放时分别分析低频和中频能量，映射到开口高度、嘴宽和圆唇程度，而不是单纯二态开合。
- 本地系统语音无法接入 Web Audio，因此用语音边界事件和合成节律生成近似嘴型。
- 情绪标签控制眉形、腮红、姿态和状态文案；独立的眨眼、呼吸和注视动画减少“静态贴图感”。
- 用户开始输入下一条消息或重新按下麦克风时，会立即停止当前语音，支持自然插话；频谱嘴型使用攻击/释放平滑，减少抖动。

当前 MVP 的嘴型属于音频驱动近似同步。若需要影视级逐音素精度，下一阶段应接入返回 phoneme/viseme 时间戳的 TTS 或本地强制对齐器，并把 viseme 序列映射到 8–15 个标准嘴型。

## 验证

```bash
npm test
curl http://localhost:3000/api/health
# 配置真实密钥后执行，会产生少量 API 用量
npm run test:live
```

## 隐私与边界

浏览器仅把最近 10 轮聊天发送给服务端；服务端不落盘保存完整聊天，但会按上一节规则在本机保存少量结构化长期记忆。产品应明确告知用户这是 AI 虚拟伙伴，而非真人或心理/医疗服务。生产部署时还应加入账号体系、内容安全策略、限流、记忆查看/删除入口和危机干预流程。

## 可选 Nike-chan 模型

个人非商用测试可以从 AITuber Kit 本地副本复制 `nikechan_v1.vrm` 和 `nikechan_v2.vrm` 到 `public/vrm/models/`。模型条款禁止向第三方再分发，因此这两个文件已被 Git 忽略；使用前请阅读 AITuber Kit 的 `docs/character_model_licence_en.md`。
