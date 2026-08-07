# DH_live 真人动作包工具

项目固定使用 DH_live 提交 `6a1ee7d3aeb310e244bc6d6ce7703e7e8cdfbef9`。官方提交在 macOS 上引用 Windows 专用的 `subprocess.CREATE_NO_WINDOW`，OpenGL 离线渲染还需要 3.3 Core Context、标准 GLSL、VAO 绑定和 Retina 逻辑视口修复。本目录保存两份最小兼容补丁，不修改模型算法。

如果主服务已经启动，可以直接打开 <http://localhost:3000/dh-action-studio.html>。页面支持选择本机视频、检查分辨率/帧率/时长、启动生成任务和查看实时日志；等价的命令行方式保留如下。

首次准备研究源码：

```bash
./integrations/dh-live/prepare.sh
```

脚本会检出固定版本、应用 macOS 补丁，并把已下载的 `resources/models/DINet_mini/epoch_40_new.pth` 复制到上游要求的位置。`experiments/` 和 `resources/` 都不进入 Git。

只检查视频规格：

```bash
node scripts/prepare_dh_action.mjs \
  --name nod_smile \
  --video /absolute/path/nod-smile.mp4 \
  --check-only
```

生成并安装动作包：

```bash
node scripts/prepare_dh_action.mjs \
  --name nod_smile \
  --video /absolute/path/nod-smile.mp4 \
  --use-for happy,agreement
```

处理流程包括：视频元数据检查、25 fps 转换、逐帧人脸与关键点检测、源视频说话检查、嘴部区域平滑、DH_live 网页资源打包、产物结构验证、与 `idle` 的分辨率/人脸位置检查，以及动作清单登记。

默认拒绝覆盖同名动作。确认替换时使用 `--force`；只生成不安装时使用 `--no-install`。MediaPipe 在 macOS 上需要正常的本机图形上下文，如果受限的后台环境无法创建 NSOpenGL，上述生成命令应在普通 Terminal 中执行。

页面的上传与任务接口仅允许 `127.0.0.1`/`::1` 访问，文件落在 Git 忽略的 `data/dh-action-uploads/`；生成进程使用参数数组直接启动，不执行 shell 字符串。单个视频限制为 120 MB、0.6–12 秒，并只接受常见视频扩展名。
