const BRIDGE_BASE_URL = "http://127.0.0.1:17805";
const BRIDGE_URL = `${BRIDGE_BASE_URL}/import-topic`;
const BRIDGE_HEALTH_URL = `${BRIDGE_BASE_URL}/health`;
const BRIDGE_TASK_STATUS_URL = `${BRIDGE_BASE_URL}/task-status`;
const BRIDGE_OPEN_FOLDER_URL = `${BRIDGE_BASE_URL}/open-folder`;
const DEFAULT_STATUS_TITLE = "准备就绪";
const DEFAULT_STATUS_META = "打开一个 Linux.do 帖子后，点击上方按钮开始导出。";
const DEFAULT_LOG = "默认导出整帖，可在“高级选项”里限制楼层范围。";
const STORAGE_KEYS = ["enablePdf", "postStart", "postEnd", "advancedOpen"];

const exportBtn = document.getElementById("exportBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const bridgeBadge = document.getElementById("bridgeBadge");
const bridgeHint = document.getElementById("bridgeHint");
const enablePdfEl = document.getElementById("enablePdf");
const advancedPanel = document.getElementById("advancedPanel");
const postStartEl = document.getElementById("postStart");
const postEndEl = document.getElementById("postEnd");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const statusTitleEl = document.getElementById("statusTitle");
const statusMetaEl = document.getElementById("statusMeta");
const logEl = document.getElementById("log");

let latestOutputDir = "";

function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  progressBar.style.width = `${safePercent}%`;
  progressText.textContent = `${safePercent}%`;
}

function setStatus(title, meta = "", logMessage = "") {
  statusTitleEl.textContent = title;
  statusMetaEl.textContent = meta;
  logEl.textContent = logMessage;
}

function setBridgeBadge(kind, text) {
  bridgeBadge.className = `badge ${kind}`.trim();
  bridgeBadge.textContent = text;
}

function setBridgeHint(text, visible = true) {
  bridgeHint.textContent = text;
  bridgeHint.style.display = visible ? "block" : "none";
}

function setBusy(isBusy) {
  exportBtn.disabled = isBusy;
  enablePdfEl.disabled = isBusy;
  postStartEl.disabled = isBusy;
  postEndEl.disabled = isBusy;
  if (isBusy) {
    openFolderBtn.disabled = true;
    return;
  }
  openFolderBtn.disabled = !latestOutputDir;
}

function setLatestOutputDir(path) {
  latestOutputDir = path || "";
  openFolderBtn.disabled = !latestOutputDir;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadOptions() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  enablePdfEl.checked = stored.enablePdf !== false;
  postStartEl.value = stored.postStart || "";
  postEndEl.value = stored.postEnd || "";
  advancedPanel.open = Boolean(stored.advancedOpen);
}

async function saveOptions() {
  await chrome.storage.local.set({
    enablePdf: enablePdfEl.checked,
    postStart: postStartEl.value.trim(),
    postEnd: postEndEl.value.trim(),
    advancedOpen: advancedPanel.open,
  });
}

function isLinuxDoTopicUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "linux.do" && /\/t\/(?:[^/]+\/)?\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizePositiveInt(value) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("楼层范围必须是大于等于 1 的整数。",
    );
  }
  return parsed;
}

function readPostRange() {
  const postStart = normalizePositiveInt(postStartEl.value.trim());
  const postEnd = normalizePositiveInt(postEndEl.value.trim());
  if (postStart !== null && postEnd !== null && postStart > postEnd) {
    throw new Error("起始楼层不能大于结束楼层。");
  }
  return { postStart, postEnd };
}

async function checkBridgeHealth(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BRIDGE_HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: Boolean(data.ok), data };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshBridgeStatus() {
  const health = await checkBridgeHealth();
  if (health.ok) {
    if (health.data?.busy) {
      setBridgeBadge("busy", "忙碌中");
      setBridgeHint("本地桥在线，但正在处理其他导出任务。", true);
    } else {
      setBridgeBadge("online", "在线");
      setBridgeHint("本地桥已连接，可以直接导出。", true);
    }
    return;
  }

  setBridgeBadge("offline", "未启动");
  setBridgeHint("请先启动本地桥：uv run python .\\local_bridge_server.py", true);
}

async function ensureBridgeReady() {
  const health = await checkBridgeHealth();
  if (health.ok) {
    return health;
  }
  throw new Error("本地桥未启动，请先运行 uv run python .\\local_bridge_server.py");
}

async function fetchTopicJsonInPage(postStart, postEnd) {
  const pageUrl = new URL(window.location.href);
  const match = pageUrl.pathname.match(/^\/t\/(?:([^/]+)\/)?(\d+)(?:\/.*)?$/);
  if (!match) {
    throw new Error("当前页面 URL 不符合 Linux.do 帖子格式。");
  }

  const [, slug, topicId] = match;
  const topicPath = slug ? `/t/${slug}/${topicId}` : `/t/${topicId}`;
  const jsonUrl = `${pageUrl.origin}${topicPath}.json`;
  const requestUrl = `${jsonUrl}${jsonUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}`;
  const response = await fetch(requestUrl, { credentials: "include", cache: "no-store" });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 140)}`);
  }

  const topicJson = JSON.parse(responseText);
  const stream = topicJson.post_stream?.stream || [];
  const totalAvailablePosts = stream.length;
  const normalizedStart = Number.isInteger(postStart) && postStart > 0 ? postStart : 1;
  const normalizedEnd = Number.isInteger(postEnd) && postEnd > 0 ? postEnd : totalAvailablePosts;
  const targetStart = Math.max(1, normalizedStart);
  const targetEnd = Math.max(targetStart, Math.min(normalizedEnd, totalAvailablePosts));
  const targetIds = stream.slice(targetStart - 1, targetEnd);
  const targetIdSet = new Set(targetIds);

  if (targetIds.length === 0) {
    throw new Error(`目标楼层范围无有效内容：${targetStart}-${targetEnd}`);
  }

  const loadedIds = new Set((topicJson.post_stream?.posts || []).map((post) => post.id));
  const missingIds = targetIds.filter((id) => !loadedIds.has(id));
  const batchSize = 20;

  for (let index = 0; index < missingIds.length; index += batchSize) {
    const batch = missingIds.slice(index, index + batchSize);
    const params = batch.map((id) => `post_ids[]=${id}`).join("&");
    const batchUrl = `${pageUrl.origin}/t/${topicId}/posts.json?${params}&_ts=${Date.now()}`;
    const batchResponse = await fetch(batchUrl, { credentials: "include", cache: "no-store" });
    if (!batchResponse.ok) {
      continue;
    }
    const batchData = await batchResponse.json();
    const newPosts = batchData.post_stream?.posts || [];
    topicJson.post_stream.posts.push(...newPosts);
    if (index + batchSize < missingIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  topicJson.post_stream.posts = (topicJson.post_stream?.posts || [])
    .filter((post) => targetIdSet.has(post.id))
    .sort((left, right) => (left.post_number || 0) - (right.post_number || 0));

  return {
    topicUrl: window.location.href,
    topicJson,
    fetchStats: {
      requestedStart: targetStart,
      requestedEnd: targetEnd,
      requestedTotal: targetIds.length,
      missingBeforeFetch: missingIds.length,
      loadedAfterFetch: topicJson.post_stream.posts.length,
      totalAvailablePosts,
    },
  };
}

function estimateProgress(task) {
  switch (task.stage) {
    case "queued":
      return 18;
    case "starting":
      return 24;
    case "writing_raw_json":
      return 32;
    case "rendering_markdown": {
      if (typeof task.current === "number" && typeof task.total === "number" && task.total > 0) {
        return 35 + (task.current / task.total) * 45;
      }
      return 52;
    }
    case "generating_pdf":
      return 84;
    case "updating_index":
      return 94;
    case "completed":
      return 100;
    case "failed":
      return 100;
    default:
      return 20;
  }
}

function describeTask(task) {
  const parts = [];
  if (task.topic_id) {
    parts.push(`Topic ID: ${task.topic_id}`);
  }
  if (typeof task.current === "number" && typeof task.total === "number" && task.total > 0) {
    parts.push(`处理进度：${task.current}/${task.total}`);
  }
  if (task.updated_at) {
    parts.push(`最近更新：${new Date(task.updated_at).toLocaleString("zh-CN", { hour12: false })}`);
  }
  return parts.join("\n");
}

async function submitAsyncImport(payload, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (response.status === 429) {
        throw new Error(result.message || "本地桥正在忙，请稍后再试。");
      }
      if (!response.ok || !result.ok) {
        throw new Error(result.message || result.error || `Bridge HTTP ${response.status}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await wait(attempt * 1500);
      }
    }
  }
  throw lastError || new Error("提交导出任务失败。");
}

async function pollTaskStatus(taskId) {
  while (true) {
    const response = await fetch(`${BRIDGE_TASK_STATUS_URL}?task_id=${encodeURIComponent(taskId)}`, {
      cache: "no-store",
    });
    const task = await response.json();
    if (!response.ok || !task.ok) {
      throw new Error(task.message || task.error || `轮询失败: HTTP ${response.status}`);
    }

    setProgress(estimateProgress(task));
    setStatus(
      task.status === "failed" ? "导出失败" : "正在导出",
      task.message || "正在处理，请稍候。",
      describeTask(task),
    );

    if (task.status === "completed") {
      const result = task.result || {};
      setLatestOutputDir(result.output_dir || "");
      setProgress(100);
      setStatus(
        "导出完成",
        result.pdf_path ? "Markdown 和 PDF 已生成。" : "Markdown 已生成。",
        [
          `Topic ID: ${result.topic_id || task.topic_id || "-"}`,
          `输出目录: ${result.output_dir || "-"}`,
          `Markdown: ${result.markdown_path || "-"}`,
          `PDF: ${result.pdf_path || "(未生成)"}`,
        ].join("\n"),
      );
      return result;
    }

    if (task.status === "failed") {
      throw new Error(task.error || task.message || "导出失败");
    }

    await wait(1200);
  }
}

async function openLatestOutputFolder() {
  if (!latestOutputDir) {
    return;
  }

  const response = await fetch(
    `${BRIDGE_OPEN_FOLDER_URL}?path=${encodeURIComponent(latestOutputDir)}`,
    { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.message || result.error || "打开目录失败");
  }
}

async function runExport() {
  setBusy(true);
  setLatestOutputDir("");

  try {
    await saveOptions();
    const { postStart, postEnd } = readPostRange();
    setProgress(5);
    setStatus("检查当前页面", "确认你现在打开的是 Linux.do 帖子页。", "");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !isLinuxDoTopicUrl(tab.url)) {
      throw new Error("当前页面不是 Linux.do 帖子页。请先打开一个帖子。");
    }

    setProgress(10);
    setStatus("检查本地桥", "确认本地桥在线。", "");
    await ensureBridgeReady();
    await refreshBridgeStatus();

    setProgress(16);
    setStatus(
      "抓取帖子 JSON",
      postStart || postEnd
        ? `正在按范围抓取楼层 ${postStart || 1} - ${postEnd || "最后一楼"}，只补目标范围内缺失的楼。`
        : "正在读取当前帖子并补齐分页楼层，楼层多时会稍慢。",
      "",
    );
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchTopicJsonInPage,
      args: [postStart, postEnd],
    });
    if (!execResult?.result?.topicJson) {
      throw new Error("未获取到帖子 JSON。可能页面尚未完全加载。");
    }

    const fetchStats = execResult.result.fetchStats || null;
    const totalPosts = execResult.result.topicJson.post_stream?.posts?.length || 0;
    const modeLabel = enablePdfEl.checked ? "Markdown + PDF" : "仅 Markdown";
    setProgress(22);
    setStatus(
      "提交导出任务",
      fetchStats
        ? `已抓到目标范围 ${fetchStats.loadedAfterFetch}/${fetchStats.requestedTotal} 楼，准备交给本地桥处理。`
        : `已抓到 ${totalPosts} 楼，准备交给本地桥处理。`,
      `导出模式：${modeLabel}${postStart || postEnd ? `\n楼层范围：${postStart || 1} - ${postEnd || "最后一楼"}` : "\n楼层范围：整帖"}`,
    );

    const payload = {
      source: "browser_extension",
      topic_url: execResult.result.topicUrl,
      topic_json: execResult.result.topicJson,
      output_root: "cases",
      download_images: true,
      image_retry_count: 2,
      image_retry_delay: 1.5,
      generate_pdf: enablePdfEl.checked,
      keep_html_for_pdf: true,
      update_index: true,
      index_sort_by: "updated_desc",
      index_only_with_pdf: false,
      async_task: true,
      post_start: postStart,
      post_end: postEnd,
    };

    const accepted = await submitAsyncImport(payload, 3);
    setProgress(25);
    setStatus("后台处理中", accepted.message || "任务已被本地桥接收。", `任务 ID: ${accepted.task_id}`);
    await pollTaskStatus(accepted.task_id);
  } catch (error) {
    setProgress(100);
    setStatus("导出失败", error?.message || String(error), "请先确认本地桥已启动，再重试一次。");
  } finally {
    setBusy(false);
    await refreshBridgeStatus();
  }
}

enablePdfEl.addEventListener("change", saveOptions);
postStartEl.addEventListener("change", saveOptions);
postEndEl.addEventListener("change", saveOptions);
advancedPanel.addEventListener("toggle", saveOptions);
exportBtn.addEventListener("click", runExport);
openFolderBtn.addEventListener("click", async () => {
  try {
    await openLatestOutputFolder();
  } catch (error) {
    setStatus("打开目录失败", error?.message || String(error), latestOutputDir || "");
  }
});

(async () => {
  await loadOptions();
  setProgress(0);
  setStatus(DEFAULT_STATUS_TITLE, DEFAULT_STATUS_META, DEFAULT_LOG);
  setLatestOutputDir("");
  await refreshBridgeStatus();
})();
