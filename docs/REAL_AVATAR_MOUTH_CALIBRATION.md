# 真人口型配置与校准

本文档说明真人模式如何从音频生成口型，以及如何为每个真人角色维护独立的嘴型尺寸、位置、唇色和牙齿参数。算法由所有角色共用，角色差异只保存在 [`config/real-avatar-mouth-profiles.json`](../config/real-avatar-mouth-profiles.json) 中。

## 1. 渲染链路

一次真人语音渲染依次经过：

```text
16 kHz 单声道 PCM WAV
  → Audio2BlendShape LSTM（连续 6 维嘴形系数）
  → 人物专属 3D 网格形变
  → OpenGL 稠密几何控制图
  → DINet 重绘 184×184 人脸局部
  → 恢复人物原唇色和亮度
  → 小开口上牙边缘补偿
  → 按人物配置缩放并羽化合成回原视频
  → H.264 MP4 / 连续 fMP4 分片
```

Node 服务在 [`src/dinet-render.mjs`](../src/dinet-render.mjs) 中解析人物、动作和口型配置，再把已经校验的配置传给常驻 Python worker。Python 侧的具体图像处理位于 [`scripts/dinet_worker.py`](../scripts/dinet_worker.py)。模型只常驻一份；切换人物时切换人物帧、参考特征、网格和配置，不重复加载模型。

## 2. 配置结构

配置文件包含一套安全默认值和每个人物的覆盖值：

```json
{
  "version": 1,
  "defaults": { "mouthMotionScale": 0.82 },
  "characters": {
    "lumi": { "mouthMotionScale": 0.79 },
    "xiaotao": { "mouthMotionScale": 0.78 }
  }
}
```

人物条目未填写的字段继承 `defaults`。所有字段由 [`src/real-mouth-profiles.mjs`](../src/real-mouth-profiles.mjs) 在服务启动时读取并校验；越界值会使服务明确报错，不会静默使用异常参数。配置在进程启动时加载，因此修改后必须重启服务。

| 参数 | 作用 | 范围 | 调大后的表现 |
| --- | --- | --- | --- |
| `mouthMotionScale` | Audio2BlendShape 六维形变的总幅度 | 0.65–1.15 | 张合与发音动作更明显 |
| `mouthWidthScale` | 最终嘴部合成区域的横向比例 | 0.65–1.10 | 嘴更宽、更长 |
| `mouthHeightScale` | 最终嘴部合成区域的纵向比例 | 0.75–1.15 | 嘴唇和开口整体更高 |
| `compositeCenterX` | 嘴部合成区域水平中心 | 0.42–0.58 | 合成区域向右移动 |
| `compositeCenterY` | 嘴部合成区域垂直中心 | 0.32–0.52 | 合成区域向下移动 |
| `lipColorCenterX` | 唇色检测区域水平中心 | 0.42–0.58 | 唇色检测区域向右移动 |
| `lipColorCenterY` | 唇色检测区域垂直中心 | 0.40–0.58 | 唇色检测区域向下移动 |
| `lipColorStrength` | 恢复人物原唇色的混合强度 | 0–1 | 更接近底片唇色 |
| `lipBrightnessOffset` | 唇部最终亮度偏移 | -12–20 | 唇面更亮 |
| `teethStrength` | 小开口上牙边缘的混合强度 | 0–1 | 上牙更明显 |

`compositeCenter*` 控制最终合成位置，`lipColorCenter*` 只控制唇色和口腔检测位置。两组中心不要混为一组：嘴的位置正确但颜色只染到一侧时，应调整后者。

当前已校准基线如下，实际值始终以配置文件为准：

| 人物 | 动作幅度 | 宽度 | 高度 | 唇色强度 | 唇部亮度 | 牙齿强度 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 露米 `lumi` | 0.79 | 0.94 | 0.97 | 0.82 | +8 | 0.38 |
| 小桃 `xiaotao` | 0.78 | 0.91 | 1.00 | 0.92 | +10 | 0.44 |

## 3. 推荐校准顺序

每次只改一类变量，并始终使用同一段音频、同一个动作底片和相同观察帧进行前后对比。不要同时改尺寸、位置和颜色，否则无法判断改善来自哪个参数。

1. **确认底片与人脸数据。** 先检查人物身份、画面尺寸、帧率和 `combined_data.json.gz` 是否匹配。明显漂移、双嘴或人脸边缘破碎通常不是配置问题。
2. **校准位置。** 先调 `compositeCenterX/Y`，使生成嘴部与原嘴中心重合；再调 `lipColorCenterX/Y`，让唇色检测覆盖上下唇而不覆盖大面积皮肤。
3. **校准宽高。** 嘴太长先降低 `mouthWidthScale`，嘴唇整体太厚再降低 `mouthHeightScale`。建议每次改变 0.02–0.05。
4. **校准动作幅度。** 尺寸正确后再调 `mouthMotionScale`。它影响发音张合，不适合用来修复静态嘴宽。
5. **恢复颜色。** 嘴唇发灰或发紫时逐步增加 `lipColorStrength`；只在颜色正确但仍偏暗时小幅增加 `lipBrightnessOffset`。
6. **最后处理牙齿。** 只有小开口呈连续黑线时才增加 `teethStrength`。牙齿像白条、口香糖或贴片时立即降低该值，不要用它填满大张口的口腔。

牙齿补偿不是一张固定牙齿贴图。worker 只在嘴部中央寻找狭长的深色小开口，沿口腔上边缘生成很薄的半透明象牙色区域，并保留嘴角和下方口腔阴影。大张口仍应看到暗色口腔；这是正常结果。

## 4. 症状与参数对应

| 症状 | 优先检查 | 处理建议 |
| --- | --- | --- |
| 嘴太宽、太长 | `mouthWidthScale` | 每次降低 0.02–0.05 |
| 嘴唇整体太大、太厚 | `mouthHeightScale` | 小幅降低；再检查动作幅度 |
| 张嘴过猛，但闭嘴尺寸正常 | `mouthMotionScale` | 降低 0.02–0.05 |
| 嘴整体偏左、右、上或下 | `compositeCenterX/Y` | 小步移动，先不要改尺寸 |
| 嘴色灰紫 | `lipColorStrength`、`lipColorCenter*` | 先确认检测中心，再增加强度 |
| 嘴色正确但发暗 | `lipBrightnessOffset` | 每次增加 2–3 |
| 小开口是一条黑线 | `teethStrength` | 从低值逐步增加并检查动态视频 |
| 牙齿像口香糖或白色贴片 | `teethStrength` | 降低强度；不要增加亮度补偿 |
| 嘴边缘重影、漂移或双嘴 | 动作底片、人脸数据包 | 重新检查预处理和素材，配置无法根治 |
| 只有某个动作异常 | 对应动作包 | 对比 `idle`；不要先修改人物全局参数 |

## 5. 生效、缓存与验证

配置解析发生在 Node 进程启动时。修改配置后重启：

```bash
npm run start
```

解析后的完整人物配置会进入 DINet 内容寻址缓存键。只要任一人物参数发生变化，新请求就会生成新的文件名，无需手工删除 `public/dinet-avatar/generated/`。`version` 用于配置结构或参数语义升级；只调整数值时不必递增。

可以使用一段 16 kHz 单声道 PCM WAV 直接验收整句渲染：

```bash
curl --data-binary @/path/to/sample.wav \
  "http://127.0.0.1:3000/api/dinet/render?action=idle&character=lumi"
```

返回结果中的 `mouthProfile` 是本次渲染实际使用的解析后配置，`cached` 表示是否命中相同音频、人物、动作、素材和配置的旧结果。验收时至少检查闭口、小张口、大张口和连续发音，不要只看一张静态截图。

提交前运行：

```bash
python3 -m py_compile scripts/dinet_worker.py
node --test test/dinet-render.test.mjs test/companion.test.mjs
git diff --check
```

## 6. 新增人物检查表

- 在真人角色白名单和动作映射中增加同名角色编号。
- 准备至少一套稳定闭嘴、无遮挡、同帧率的 `idle` 动作包。
- 为允许说话的动作生成匹配的 `combined_data.json.gz`。
- 在 `characters` 中增加完整人物配置，不长期依赖 `defaults`。
- 使用同一验收音频完成位置、尺寸、幅度、颜色、牙齿六步校准。
- 检查普通整句、连续分片、动作切换和回答结束回待机。
- 更新 `test/dinet-render.test.mjs` 中的人物配置断言。

动作底片的制作与口型安全等级另见 [`CHARACTER_ACTION_VIDEO_PRODUCTION_GUIDE.md`](CHARACTER_ACTION_VIDEO_PRODUCTION_GUIDE.md)，模型原理另见 [`DH_LIVE_PRINCIPLE_ANALYSIS.md`](DH_LIVE_PRINCIPLE_ANALYSIS.md)。
