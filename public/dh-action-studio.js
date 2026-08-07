const elements = {
  file: document.querySelector("#video-file"),
  preview: document.querySelector("#preview"),
  fileNote: document.querySelector("#file-note"),
  form: document.querySelector("#action-form"),
  check: document.querySelector("#check"),
  build: document.querySelector("#build"),
  name: document.querySelector("#action-name"),
  useFor: document.querySelector("#use-for"),
  loop: document.querySelector("#loop"),
  returnTo: document.querySelector("#return-to"),
  resize: document.querySelector("#resize"),
  install: document.querySelector("#install"),
  force: document.querySelector("#force"),
  status: document.querySelector("#status"),
  dot: document.querySelector("#status-dot"),
  videoInfo: document.querySelector("#video-info"),
  warnings: document.querySelector("#warnings"),
  logs: document.querySelector("#logs"),
};

let uploadId = null;
let previewUrl = null;

function setStatus(label, state = "") {
  elements.status.textContent = label;
  elements.dot.className = `dot ${state}`;
}

async function responseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

elements.file.addEventListener("change", () => {
  uploadId = null;
  elements.build.disabled = true;
  const file = elements.file.files?.[0];
  if (!file) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  elements.preview.src = previewUrl;
  elements.preview.play().catch(() => {});
  elements.fileNote.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  elements.videoInfo.textContent = "";
  elements.warnings.textContent = "";
  elements.logs.textContent = "点击“检查视频”读取时长、帧率和尺寸。";
  setStatus("视频待检查");
});

elements.check.addEventListener("click", async () => {
  const file = elements.file.files?.[0];
  if (!file) {
    setStatus("请先选择视频", "failed");
    return;
  }
  elements.check.disabled = true;
  elements.build.disabled = true;
  setStatus("正在上传到本机并检查…", "running");
  elements.logs.textContent = "正在使用 ffprobe 检查视频…";
  try {
    const response = await fetch(`/api/dh-actions/uploads?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await responseJson(response);
    uploadId = data.uploadId;
    const { width, height, fps, duration } = data.video;
    elements.videoInfo.textContent = `${width}×${height} · ${fps.toFixed(2)} fps · ${duration.toFixed(2)} 秒`;
    elements.warnings.textContent = data.warnings.length ? data.warnings.join("；") : "视频规格正常";
    elements.logs.textContent = "检查通过。可以生成动作；完整处理通常需要几分钟。";
    elements.build.disabled = false;
    setStatus("检查通过", "ready");
  } catch (error) {
    elements.logs.textContent = error.message;
    setStatus("检查失败", "failed");
  } finally {
    elements.check.disabled = false;
  }
});

elements.loop.addEventListener("change", () => {
  elements.returnTo.disabled = elements.loop.value === "true";
});

async function pollTask(id) {
  const response = await fetch(`/api/dh-actions/tasks/${id}`);
  const task = await responseJson(response);
  elements.logs.textContent = task.logs.length ? task.logs.join("\n") : "任务已启动，正在等待模型输出…";
  elements.logs.scrollTop = elements.logs.scrollHeight;
  if (task.status === "running") {
    setStatus("正在生成动作…", "running");
    window.setTimeout(() => pollTask(id).catch(showTaskError), 900);
    return;
  }
  elements.build.disabled = false;
  if (task.status === "completed") setStatus(elements.install.checked ? "生成并安装完成" : "生成完成", "completed");
  else {
    if (task.error) elements.logs.textContent += `\n${task.error}`;
    setStatus("生成失败", "failed");
  }
}

function showTaskError(error) {
  elements.build.disabled = false;
  elements.logs.textContent += `\n${error.message}`;
  setStatus("无法读取任务进度", "failed");
}

elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!uploadId || !elements.form.reportValidity()) return;
  elements.build.disabled = true;
  setStatus("正在启动模型…", "running");
  elements.logs.textContent = "正在创建动作任务…";
  try {
    const response = await fetch("/api/dh-actions/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId,
        name: elements.name.value,
        useFor: elements.useFor.value,
        loop: elements.loop.value === "true",
        returnTo: elements.returnTo.value,
        resize: elements.resize.checked,
        install: elements.install.checked,
        force: elements.force.checked,
      }),
    });
    const task = await responseJson(response);
    await pollTask(task.id);
  } catch (error) {
    showTaskError(error);
  }
});
