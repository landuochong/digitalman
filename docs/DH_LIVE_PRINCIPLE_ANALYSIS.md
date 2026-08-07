# DH_live / MatesX 口型原理分析

> 结论：DH_live 的自然口型不是“嘴部贴片”，而是一个轻量的混合渲染系统：
> **音频时序模型 → 连续口型参数 → 个性化 3D 网格形变 → 稠密图像变形 → 神经网络重绘嘴部 → 羽化融合回原视频。**

本文基于项目中 `experiments/dh-live` 的本地源码和当前实际生成的形象包分析，目的是理解其工程原理，并为后续独立实现划清边界。本文不是许可证或法律意见。

## 1. 完整运行链路

```text
16 kHz PCM 音频
    │
    ├─ 80 维 Kaldi FBank（50 ms 窗、20 ms 帧移）
    │
    ├─ 两帧特征合并 + 2 层单向 LSTM
    │
    └─ 每个视频帧输出 6 个连续 BlendShape 系数（25 fps）
                       │
底色视频当前帧          │
    │                  │
    ├─ 当前帧的人脸矩阵、209 个网格点
    │                  │
    └──────────┬───────┘
               │
          WebGL 3D 网格形变
               │
        稠密位移场 + 嘴/脸/牙齿控制图
               │
        原图 ROI 按位移场进行 warp
               │
       DINet_mini 重绘嘴唇、口腔和牙齿
               │
          羽化融合回当前视频帧
```

它保留了底色视频中眼睛、头发、身体、衣服和动作，只对跟说话有关的脸部局部做低成本生成。因此它比整脸实时生成轻，同时比直接替换嘴部图片自然。

## 2. 形象包不是几张嘴图

视频预处理由 `data_preparation_mini.py` 和 `data_preparation_web.py` 完成。

### 2.1 视频与人脸约束

- 视频固定处理成 25 fps。
- 每帧使用 MediaPipe Face Mesh 检测 478 个三维关键点。
- 检查单人、正脸、人脸尺寸和相邻帧位移，明显跳动会判定为不合格。
- 检查原视频是否存在明显说话，避免底视频本身的嘴形与新语音冲突。
- 关键点经过五点时域平滑，权重为 `[0.015, 0.095, 0.78, 0.095, 0.015]`。

### 2.2 稳定 ROI 和逐帧同步

- 裁剪中心跟随人脸，但裁剪尺寸取全视频平均值并固定为偶数，减少 ROI 忽大忽小。
- 每帧右上角写入一个 2×2 黑白编码，表示帧序号模 16。
- 浏览器不是只相信 `video.currentTime`，而是读取这 2×2 像素，选择对应的人脸矩阵和网格数据。

这个小设计很重要：浏览器视频解码与 `requestAnimationFrame` 不严格同步时，仍能保证“当前画面、当前网格、当前裁剪框”属于同一帧。

### 2.3 `combined_data.json.gz` 的实际内容

以当前 `minimax_idle_test` 包为例：

| 字段 | 实际内容 |
|---|---|
| `frame_num` | 111 帧 |
| `size` | 184×184 的脸部处理区域 |
| `face3D_obj` | 727 行个性化 OBJ 顶点与三角面数据 |
| `ref_data` | 80 个浮点数：64 维人物外观特征 + 16 维分区亮度 |
| `json_data` | 每帧一个裁剪框和 434 个数 |
| 每帧 `points` | 16 个变换矩阵值 + 209×2 个网格坐标 |
| `uid` | `matesx_...` 数据包标识 |
| `authorized` | 当前为 `false` |

预处理还会把检测到的人脸拟合到平均三维脸，对嘴唇进行归一化，再生成适应该人物比例的 3D wrap mesh。所以不同人物不是共用一个固定嘴框。

## 3. 声音如何变成口型

公开 Python 网络位于 `talkingface/models/audio2bs_lstm.py`。

### 3.1 输入特征

- 音频：16 kHz 单声道 PCM。
- FBank：80 个 Mel 频带。
- 窗长：50 ms。
- 帧移：20 ms。
- 每两个声学帧合成一个视频口型帧，输出速率为 25 fps。

### 3.2 时序网络

```text
2 × 80 FBank
  → Linear 160→80
  → BatchNorm + LeakyReLU + Linear
  → 2 层单向 LSTM（hidden=192）
  → MLP 192→256→256→6
  → 6 个连续口型系数
```

单向 LSTM 会保留跨音频块的隐藏状态，因此口型包含前后发音的连续过渡。这里预测的不是“闭嘴、小开、大开”三个档位，也不是音量，而是 6 维连续发音形变。

`pca.pkl` 表明这 6 个系数还能还原为一个对称的 15×30×3 嘴部特征场。离线推理代码对部分系数进行缩放和方向修正，并过滤不合理的网格形变。

## 4. WebGL 不负责画最终的嘴

`MiniLive2.js` 的 WebGL 阶段加载：

- 个性化 OBJ 网格；
- 每帧 209 个二维网格点；
- 每帧 4×4 人脸变换矩阵；
- `bs_texture_halfFace.png` 中的 6 组形变基；
- 音频模型产生的 6 个 BlendShape 系数。

顶点着色器将音频形变施加到 3D 网格，同时套用底色视频当前帧的头部姿态。片元着色器输出的也不是最终彩色人脸，而是一张机器可读的控制图：

- R/G 通道编码稠密采样或位移坐标；
- 其他区域值标记脸、嘴、下颌、牙齿等区域；
- 特殊顶点类别用于处理口腔和牙齿关系。

因此 WebGL 解决的是几何连续性和当前头部姿态，不是简单画一个二维椭圆嘴。

## 5. DINet_mini 为什么能处理嘴唇、牙齿和肤色

公开模型位于 `talkingface/models/DINet_mini.py`，当前检查点 `epoch_40_new.pth` 约 24 MB。

### 5.1 人物参考特征

每个形象从第一帧提取：

- 原人物嘴部附近的 RGB 和嘴部边缘图；
- 两份带透明通道的牙齿参考图；
- 64 维人物外观/风格向量；
- 4×4 共 16 维的区域亮度特征。

这解释了为什么生成的牙齿、嘴唇和皮肤能接近原人物，而不是一套通用嘴贴在所有人脸上。

### 5.2 推理与融合

1. 从 WebGL 控制图取出稠密形变场。
2. 用 `grid_sample` 对原始脸部 ROI 做连续采样和变形。
3. 只取中央约 112×80 的嘴部生成区域。
4. 将变形后的原图与几何控制图一起送入 DINet_mini。
5. 用人物 64 维外观向量通过自适应调制控制颜色、纹理和牙齿外观。
6. 通过嘴部羽化 mask 把神经网络输出与变形后的原图融合。
7. 把 184×184 结果缩放并放回底色视频对应 ROI。

网络还把原图背景特征以跳连方式注入解码器，从而尽量保留原人物的光照和局部细节。

## 6. 训练数据在学什么

`DHLive_mini_dataset.py` 和 `mini_live/train.py` 显示，渲染网络使用真实说话视频训练：

- 源帧和目标说话帧对齐；
- 选择张嘴参考帧并使用牙齿分割；
- 几何嘴图、牙齿 mask 和原图共同构成条件；
- 目标是真实视频中的嘴部画面；
- 使用像素 L1、VGG 感知和 GAN 判别损失；
- 带颜色、对比度、色相等增强。

所以模型学到的是“在这个人的肤色、角度和光照下，这种几何发音形状应该长成什么真实像素”，而不是从几个预录嘴形中挑一张。

## 7. 公开部分与预编译运行时的边界

当前本地仓库可以看到：

- 视频预处理和人物数据包生成 Python 源码；
- Audio2BlendShape 的网络结构和训练数据代码；
- DINet_mini 的网络结构、训练与离线推理源码；
- WebGL 网格和前端调用代码；
- 24 MB 的 DINet_mini 检查点；
- README 声明 `MIT License`。

当前本地仓库没有看到：

- README/离线示例引用的 LSTM 音频检查点；
- `DHLiveMini.wasm` 对应的 C/C++ 推理源代码；
- WASM 内的数据包授权、Logo、音频 LSTM、DINet 推理实现源码；
- 独立的 `LICENSE` 文件（只有 README 中的许可证声明）。

4.4 MB 的 WASM 字符串中可见 `authorized`、版本校验、`LSTM` 和 ncnn 类型信息。前端只调用 `_processJson`、`_setAudioBuffer`、`_updateBlendShape`、`_processImage` 等接口。因此可以确认浏览器核心推理被封装在预编译 WASM 中，但仅凭二进制不能把其内部实现当作我们自己的可维护源码。

持久显示的 MatesX 标识并不是人物图片的版权水印。结合 `combined_data.authorized=false`、`uid=matesx_...`、README 的去 Logo 流程和 WASM 接口判断，它来自这套网页运行时/数据包授权机制。HTML 中另有一个仅用于加载阶段的 `MatesX: loading...` 文本，两者需要区分。

### 7.1 `DHLiveMini.wasm` 静态拆解结果

对当前 4.4 MB 文件（SHA-256 `7199459b6599a14190aa603d1859f9303fda004e4b78d3206907356d38094783`）直接解析 WebAssembly 模块，它没有 `name`、`producers` 或 source map 自定义段，因此原始 C++ 函数名和源码调试信息已被去除。对外业务导出只有：

- `processJson`：读取除 `json_data` 以外的人物元数据，包括 `uid`、`authorized`、`version`、`ref_data` 和 `face3D_obj`；
- `setAudioBuffer` / `clearAudio` / `getAudioVad`：管理音频、清除时序状态和计算语音活性；
- `updateBlendShape`：向 JS 分配的缓冲区写入 12 个 float，前端将前 6 个当作嘴部系数；
- `processImage`：接收原视频人脸裁剪、WebGL 稠密网格形变结果和当前帧索引，将神经融合后的 RGBA 像素原地写回。

字符串和类型信息进一步确认了 ncnn 推理引擎、`Convolution`、`LSTM`、`Gemm`、`MatMul`、`GridSample`、`Interp`、Mel banks 以及模型权重读取逻辑均被编译进此文件。WASM 中可见 `authorized` 和固定版本校验文本，但找不到 `MatesX` 文本字面量，表明画面标识更可能是内置图形/像素模板，而不是 Canvas `fillText`。前端对人物画面唯一的 `fillText` 调用是可选 FPS 数字，没有 MatesX 覆盖层。

因此，“嘴和文案在不同位置”在空间上成立，但两者都由同一次 `processImage` 写回的人脸裁剪缓冲区输出，不是可以独立关闭的 DOM 文本层。所有本地动作包均明确包含 `authorized:false` 和 `matesx_...` UID；修改授权字段、补丁 WASM 分支或对输出区域做定向覆盖，实质都是规避该运行时的授权标识，不作为项目的洁净实现路线。

## 8. 为什么我们的洁净贴片方案失败

| 能力 | 失败的洁净贴片原型 | DH_live |
|---|---|---|
| 音频理解 | RMS 音量映射到少量档位 | FBank + LSTM 的 6 维连续发音参数 |
| 时序 | 阈值和平滑 | LSTM 隐状态，包含协同发音过渡 |
| 空间定位 | 嘴中心、宽高、角度 | 478 点检测、个性化 3D 网格、逐帧矩阵 |
| 形变 | 整张嘴图缩放 | 209 点网格 + 稠密形变场 |
| 牙齿/口腔 | 固定贴片像素 | 几何区域、牙齿参考和神经生成 |
| 肤色/光照 | Alpha 羽化 | 64 维外观 + 16 维亮度 + 神经融合 |
| 视频同步 | 按时间估算 | 帧内 2×2 编码锁定精确帧序号 |

结论是：继续调嘴贴片的大小、颜色、羽化或帧数，最多只能让边缘不那么突兀，无法达到 DH_live 的发音准确度和真实感。

## 9. 独立实现应复刻哪些“能力”，而不是复制哪些文件

要避免继续依赖 MatesX 的数据格式、预编译 WASM 和授权标识，独立实现至少需要以下等价模块：

1. **自有形象预处理器**
   - MediaPipe/其他可用的人脸网格；
   - 稳定 ROI、逐帧矩阵和帧同步标记；
   - 自有 JSON/二进制形象格式，不生成 `matesx_` UID。

2. **自有 Audio2Motion 模型**
   - 从 16 kHz 音频预测连续、带时序的嘴部形变；
   - 自己从合规说话视频构建嘴部几何特征和 PCA/BlendShape 标签；
   - 训练并导出自己的模型权重。

3. **自有几何渲染器**
   - 维护嘴唇、下颌、口腔、牙齿的网格拓扑；
   - 输出稠密位移场和区域 mask；
   - 浏览器端可以用 WebGL/WebGPU 实现。

4. **自有轻量神经嘴部渲染器**
   - 输入原帧、几何控制图和人物外观特征；
   - 只生成嘴部局部并羽化融合；
   - 使用自有或条款明确的训练数据和权重；
   - 浏览器可优先尝试 ONNX Runtime Web/WebGPU，后续再优化成 WASM/ncnn。

## 10. 对当前项目的直接决策

- 停止继续优化 `profile=clean` 的多档嘴贴片，它已被验证为错误技术路线。
- DH_live 现有运行时可继续作为效果基准，不再把它当作“只需去掉文字”的最终技术底座。
- 第一阶段应先做离线、可观察的等价管线，逐层输出并检查：音频系数、网格控制图、warp 结果、神经嘴部和最终融合图。
- 模型验证成功后再移植到浏览器；这样可以把“模型不对”和“Web 运行时不对”分开。
- Mac 适合做预处理和推理验证；正式训练这两类模型仍更适合 NVIDIA CUDA 环境。

## 11. 源码定位

- 视频预处理：`experiments/dh-live/data_preparation_mini.py`
- Web 形象包生成：`experiments/dh-live/data_preparation_web.py`
- 音频模型：`experiments/dh-live/talkingface/models/audio2bs_lstm.py`
- 音频特征与推理：`experiments/dh-live/talkingface/model_utils.py`、`audio_model.py`
- 轻量生成器：`experiments/dh-live/talkingface/models/DINet_mini.py`
- 人物参考特征：`experiments/dh-live/talkingface/render_model_mini.py`
- 训练数据：`experiments/dh-live/talkingface/data/DHLive_mini_dataset.py`
- 训练入口：`experiments/dh-live/mini_live/train.py`
- WebGL 与逐帧调度：`experiments/dh-live/web_demo/static/js/MiniLive2.js`
- 预编译推理运行时：`experiments/dh-live/web_demo/static/DHLiveMini.wasm`
