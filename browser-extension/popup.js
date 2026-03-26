const BRIDGE_URL = "http://127.0.0.1:17805/import-topic";
const BRIDGE_OPEN_FOLDER_URL = "http://127.0.0.1:17805/open-folder";
const BRIDGE_HEALTH_URL = "http://127.0.0.1:17805/health";
const BRIDGE_TASK_STATUS_URL = "http://127.0.0.1:17805/task-status";
const BRIDGE_PROTOCOL_URL = "linuxdo-archive://start";
const HISTORY_KEY = "challenge05_export_history";
const SETTINGS_KEY = "challenge05_export_settings";
const MAX_HISTORY = 12;
const BRIDGE_START_TIMEOUT_MS = 15000;
const BRIDGE_POLL_INTERVAL_MS = 1000;
const TASK_POLL_TIMEOUT_MS = 30 * 60 * 1000;

const PDF_PROFILE_MAP = {
  full: "configs/pdf.ctf-full.json",
  brief: "configs/pdf.ctf-brief.json",
};

const DEFAULT_SETTINGS = {
  enablePdf: true,
  pdfProfile: "full",
};

const exportBtn = document.getElementById("exportBtn");
const startBridgeBtn = document.getElementById("startBridgeBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const logEl = document.getElementById("log");
const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const enablePdfEl = document.getElementById("enablePdf");
const pdfProfileEl = document.getElementById("pdfProfile");

function setStartBridgeVisible(visible) {
  startBridgeBtn.style.display = visible ? "block" : "none";
}

function log(msg) {
  logEl.textContent = msg;
}

function isLinuxDoTopicUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "linux.do" && /\/t\/(?:[^/]+\/)?\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

async function fetchTopicJsonInPage() {
  const url = new URL(window.location.href);
  const cleanPath = url.pathname.replace(/\/$/, "");
  const jsonPath = cleanPath.endsWith(".json") ? cleanPath : `${cleanPath}.json`;
  const jsonUrl = `${url.origin}${jsonPath}`;
  const reqUrl = `${jsonUrl}${jsonUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}`;
  const resp = await fetch(reqUrl, { credentials: "include", cache: "no-store" });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 140)}`);
  }
  const topicJson = JSON.parse(text);

  // Paginate: fetch remaining posts via stream IDs
  const stream = topicJson.post_stream?.stream || [];
  const loadedIds = new Set((topicJson.post_stream?.posts || []).map((p) => p.id));
  const missingIds = stream.filter((id) => !loadedIds.has(id));

  const BATCH = 20;
  const topicId = topicJson.id || cleanPath.match(/(\d+)/)?.[1];
  for (let i = 0; i < missingIds.length; i += BATCH) {
    const batch = missingIds.slice(i, i + BATCH);
    const params = batch.map((id) => `post_ids[]=${id}`).join("&");
    const batchUrl = `${url.origin}/t/${topicId}/posts.json?${params}&_ts=${Date.now()}`;
    const bResp = await fetch(batchUrl, { credentials: "include", cache: "no-store" });
    if (!bResp.ok) continue;
    const bData = await bResp.json();
    const newPosts = bData.post_stream?.posts || [];
    topicJson.post_stream.posts.push(...newPosts);
    // Pause between batches to avoid Cloudflare / Discourse rate limiting
    if (i + BATCH < missingIds.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return {
    topicUrl: window.location.href,
    topicJson,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkBridgeHealth(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(BRIDGE_HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { ok: false, reason: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return { ok: !!data.ok, data };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function launchBridgeProtocol() {
  const link = document.createElement("a");
  link.href = BRIDGE_PROTOCOL_URL;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function waitForBridgeReady(timeoutMs = BRIDGE_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await checkBridgeHealth();
    if (health.ok) {
      setStartBridgeVisible(false);
      return health;
    }
    await wait(BRIDGE_POLL_INTERVAL_MS);
  }
  throw new Error("本地桥启动超时，请手动运行启动脚本。");
}

async function ensureBridgeReady(autoLaunch = false) {
  const health = await checkBridgeHealth();
  if (health.ok) {
    setStartBridgeVisible(false);
    return health;
  }

  setStartBridgeVisible(true);
  if (!autoLaunch) {
    throw new Error("本地桥未启动，请点击“启动本地桥”或手动运行启动脚本。");
  }

  log("未检测到本地桥，正在尝试自动启动...");
  launchBridgeProtocol();
  return waitForBridgeReady();
}

async function refreshBridgeStatus() {
  const health = await checkBridgeHealth();
  if (health.ok) {
    setStartBridgeVisible(false);
    if (logEl.textContent === "准备就绪") {
      log("准备就绪（本地桥在线）");
    }
    return;
  }
  setStartBridgeVisible(true);
  if (!logEl.textContent || logEl.textContent === "准备就绪") {
    log("本地桥未启动，可先点“启动本地桥”再导出。");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("zh-CN", { hour12: false });
}

function formatStageLabel(stage) {
  const labels = {
    queued: "\u6392\u961f\u4e2d",
    starting: "\u51c6\u5907\u5f00\u59cb",
    writing_raw_json: "\u5199\u5165\u539f\u59cb JSON",
    rendering_markdown: "\u6574\u7406\u6b63\u6587\u4e0e\u56fe\u7247",
    generating_pdf: "\u751f\u6210 PDF",
    updating_index: "\u66f4\u65b0\u7d22\u5f15",
    completed: "\u5df2\u5b8c\u6210",
    failed: "\u5931\u8d25",
  };
  return labels[stage] || stage || "\u8fdb\u884c\u4e2d";
}

function formatTaskProgress(task, mode) {
  const lines = [];
  lines.push(`\u4efb\u52a1\u72b6\u6001\uff1a${task.status === "queued" ? "\u6392\u961f\u4e2d" : task.status === "completed" ? "\u5df2\u5b8c\u6210" : task.status === "failed" ? "\u5931\u8d25" : "\u6267\u884c\u4e2d"}`);
  lines.push(`\u5f53\u524d\u9636\u6bb5\uff1a${formatStageLabel(task.stage)}`);
  if (task.message) {
    lines.push(task.message);
  }
  if (typeof task.current === "number" && typeof task.total === "number") {
    lines.push(`\u697c\u5c42\u8fdb\u5ea6\uff1a${task.current}/${task.total}`);
  }
  if (task.topic_id) {
    lines.push(`Topic ID: ${task.topic_id}`);
  }
  if (mode) {
    lines.push(`Mode: ${mode}`);
  }
  return lines.join("\n");
}

async function startAsyncImportWithRetry(payload, maxAttempts = 3) {
  let lastError = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const resp = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (!resp.ok || !result.ok) {
        throw new Error(result.message || result.error || `Bridge HTTP ${resp.status}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (i < maxAttempts - 1) {
        await wait((i + 1) * 3000);
      }
    }
  }
  throw lastError || new Error("Bridge request failed");
}

async function fetchTaskStatus(taskId) {
  const resp = await fetch(`${BRIDGE_TASK_STATUS_URL}?task_id=${encodeURIComponent(taskId)}`, {
    cache: "no-store",
  });
  const result = await resp.json();
  if (!resp.ok || !result.ok) {
    throw new Error(result.message || result.error || `Task status HTTP ${resp.status}`);
  }
  return result;
}

async function pollTaskUntilDone(taskId, mode, onProgress, timeoutMs = TASK_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let transientErrors = 0;
  let lastRendered = "";

  while (Date.now() < deadline) {
    try {
      const task = await fetchTaskStatus(taskId);
      transientErrors = 0;
      const rendered = formatTaskProgress(task, mode);
      if (rendered !== lastRendered) {
        onProgress(rendered, task);
        lastRendered = rendered;
      }

      if (task.status === "completed") {
        return task;
      }
      if (task.status === "failed") {
        throw new Error(task.error || task.message || "\u5bfc\u51fa\u5931\u8d25");
      }
    } catch (err) {
      transientErrors += 1;
      if (transientErrors >= 5) {
        throw err;
      }
      const retryMsg = `\u6b63\u5728\u67e5\u8be2\u672c\u5730\u4efb\u52a1\u8fdb\u5ea6\uff08\u91cd\u8bd5 ${transientErrors}/5\uff09...`;
      if (retryMsg !== lastRendered) {
        onProgress(retryMsg, null);
        lastRendered = retryMsg;
      }
    }

    await wait(BRIDGE_POLL_INTERVAL_MS);
  }

  throw new Error("\u672c\u5730\u540e\u53f0\u4efb\u52a1\u7b49\u5f85\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u68c0\u67e5\u8f93\u51fa\u76ee\u5f55\u6216\u4efb\u52a1\u65e5\u5fd7\u3002");
}

async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = data[HISTORY_KEY];
  return Array.isArray(history) ? history : [];
}

async function saveHistory(history) {
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_HISTORY) });
}

function renderHistory(history) {
  if (!history.length) {
    historyListEl.innerHTML = `<div class="history-empty">暂无记录</div>`;
    return;
  }
  historyListEl.innerHTML = history
    .map(
      (item) => `
      <div class="history-item">
        <div><strong>${escapeHtml(item.topicId || "-")}</strong> · ${escapeHtml(item.status || "-")} · ${escapeHtml(item.mode || "-")}</div>
        <div>${escapeHtml(formatTime(item.time))}</div>
        <div>${escapeHtml(item.pdfPath || item.markdownPath || "-")}</div>
      </div>
    `
    )
    .join("");
}

async function appendHistory(entry) {
  const history = await getHistory();
  history.unshift(entry);
  await saveHistory(history);
  renderHistory(history);
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = data[SETTINGS_KEY] || {};
  const settings = {
    enablePdf: typeof raw.enablePdf === "boolean" ? raw.enablePdf : DEFAULT_SETTINGS.enablePdf,
    pdfProfile: PDF_PROFILE_MAP[raw.pdfProfile] ? raw.pdfProfile : DEFAULT_SETTINGS.pdfProfile,
  };
  enablePdfEl.checked = settings.enablePdf;
  pdfProfileEl.value = settings.pdfProfile;
  pdfProfileEl.disabled = !settings.enablePdf;
  return settings;
}

async function saveSettings() {
  const settings = {
    enablePdf: enablePdfEl.checked,
    pdfProfile: PDF_PROFILE_MAP[pdfProfileEl.value] ? pdfProfileEl.value : DEFAULT_SETTINGS.pdfProfile,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function bindSettingEvents() {
  enablePdfEl.addEventListener("change", async () => {
    pdfProfileEl.disabled = !enablePdfEl.checked;
    await saveSettings();
  });
  pdfProfileEl.addEventListener("change", saveSettings);
}

async function runExport() {
  exportBtn.disabled = true;
  startBridgeBtn.disabled = true;
  openFolderBtn.style.display = "none";
  try {
    log("\u68c0\u67e5\u5f53\u524d\u6807\u7b7e\u9875...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !isLinuxDoTopicUrl(tab.url)) {
      throw new Error("\u5f53\u524d\u9875\u9762\u4e0d\u662f linux.do \u4e3b\u9898\u5e16\u3002");
    }

    await ensureBridgeReady(true);

    log("\u4ece\u5f53\u524d\u9875\u9762\u8bfb\u53d6 topic JSON\uff08\u542b\u5206\u9875\u62c9\u53d6\u5168\u90e8\u697c\u5c42\uff09...");
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchTopicJsonInPage,
    });
    if (!execResult?.result?.topicJson) {
      throw new Error("\u672a\u83b7\u53d6\u5230 topic JSON\u3002");
    }

    const totalPosts = execResult.result.topicJson.post_stream?.posts?.length || 0;
    log(`\u5df2\u83b7\u53d6 ${totalPosts} \u697c\uff0c\u51c6\u5907\u53d1\u9001...`);

    const settings = await loadSettings();
    const profileKey = settings.pdfProfile;
    const pdfConfigPath = PDF_PROFILE_MAP[profileKey];
    const mode = settings.enablePdf ? "md+pdf" : "md-only";

    const postStartVal = document.getElementById("postStart").value.trim();
    const postEndVal = document.getElementById("postEnd").value.trim();

    const payload = {
      source: "browser_extension",
      topic_url: execResult.result.topicUrl,
      topic_json: execResult.result.topicJson,
      output_root: "cases",
      download_images: true,
      image_retry_count: 2,
      image_retry_delay: 1.5,
      generate_pdf: settings.enablePdf,
      keep_html_for_pdf: true,
      update_index: true,
      index_sort_by: "updated_desc",
      index_only_with_pdf: false,
      pdf_config_path: settings.enablePdf ? pdfConfigPath : "configs/pdf.default.json",
      async_task: true,
    };
    if (postStartVal) payload.post_start = parseInt(postStartVal, 10);
    if (postEndVal) payload.post_end = parseInt(postEndVal, 10);

    log(`\u53d1\u9001\u5230\u672c\u5730\u6865\uff08${mode}\uff09...\n\u8fdb\u5ea6\u67e5\u8be2\u4ec5\u8bbf\u95ee 127.0.0.1\uff0c\u4e0d\u4f1a\u989d\u5916\u8bf7\u6c42 linux.do\u3002`);
    const accepted = await startAsyncImportWithRetry(payload, 3);

    if (accepted.task_id) {
      log(
        [
          "\u5df2\u8fdb\u5165\u672c\u5730\u540e\u53f0\u4efb\u52a1",
          `Task ID: ${accepted.task_id}`,
          `Mode: ${mode}`,
          "\u8fdb\u5ea6\u67e5\u8be2\u4ec5\u8bbf\u95ee 127.0.0.1\uff0c\u4e0d\u4f1a\u989d\u5916\u8bf7\u6c42 linux.do\u3002",
        ].join("\n")
      );
      const finalTask = await pollTaskUntilDone(accepted.task_id, mode, (message) => log(message));
      const result = finalTask.result || {};

      log(
        [
          "\u5bfc\u51fa\u5b8c\u6210",
          `Topic ID: ${result.topic_id}`,
          `Mode: ${mode}`,
          `Markdown: ${result.markdown_path}`,
          `PDF: ${result.pdf_path || "(\u672a\u751f\u6210)"}`,
          `Index: ${result.index_path || "(\u672a\u66f4\u65b0)"}`,
          `Task Log: ${result.task_log_path || "(\u672a\u8bb0\u5f55)"}`,
        ].join("\n")
      );

      if (result.output_dir) {
        openFolderBtn.style.display = "block";
        openFolderBtn.onclick = async () => {
          try {
            const resp = await fetch(`${BRIDGE_OPEN_FOLDER_URL}?path=${encodeURIComponent(result.output_dir)}`);
            const data = await resp.json();
            if (!data.ok) {
              log(`\u6253\u5f00\u76ee\u5f55\u5931\u8d25: ${data.error || data.message || "unknown"}`);
            }
          } catch (err) {
            log(`\u6253\u5f00\u76ee\u5f55\u5931\u8d25: ${err.message}`);
          }
        };
      }

      await appendHistory({
        time: new Date().toISOString(),
        topicId: result.topic_id,
        status: "success",
        mode,
        markdownPath: result.markdown_path,
        pdfPath: result.pdf_path || "",
        indexPath: result.index_path || "",
        taskLogPath: result.task_log_path || "",
        pdfProfile: profileKey,
      });
      return;
    }

    log(
      [
        "\u5bfc\u51fa\u5b8c\u6210",
        `Topic ID: ${accepted.topic_id}`,
        `Mode: ${mode}`,
        `Markdown: ${accepted.markdown_path}`,
        `PDF: ${accepted.pdf_path || "(\u672a\u751f\u6210)"}`,
        `Index: ${accepted.index_path || "(\u672a\u66f4\u65b0)"}`,
        `Task Log: ${accepted.task_log_path || "(\u672a\u8bb0\u5f55)"}`,
      ].join("\n")
    );
    if (accepted.output_dir) {
      openFolderBtn.style.display = "block";
      openFolderBtn.onclick = async () => {
        try {
          const resp = await fetch(`${BRIDGE_OPEN_FOLDER_URL}?path=${encodeURIComponent(accepted.output_dir)}`);
          const data = await resp.json();
          if (!data.ok) {
            log(`\u6253\u5f00\u76ee\u5f55\u5931\u8d25: ${data.error || data.message || "unknown"}`);
          }
        } catch (err) {
          log(`\u6253\u5f00\u76ee\u5f55\u5931\u8d25: ${err.message}`);
        }
      };
    }
    await appendHistory({
      time: new Date().toISOString(),
      topicId: accepted.topic_id,
      status: "success",
      mode,
      markdownPath: accepted.markdown_path,
      pdfPath: accepted.pdf_path || "",
      indexPath: accepted.index_path || "",
      taskLogPath: accepted.task_log_path || "",
      pdfProfile: profileKey,
    });
  } catch (err) {
    const message = err?.message || String(err);
    log(`\u5931\u8d25: ${message}`);
    await appendHistory({
      time: new Date().toISOString(),
      topicId: "",
      status: "failed",
      mode: "unknown",
      markdownPath: "",
      pdfPath: "",
      error: message,
    });
  } finally {
    exportBtn.disabled = false;
    startBridgeBtn.disabled = false;
  }
}

async function startBridgeManually() {
  startBridgeBtn.disabled = true;
  try {
    log("正在尝试启动本地桥...");
    launchBridgeProtocol();
    await waitForBridgeReady();
    log("本地桥已启动，现在可以导出了。");
  } catch (err) {
    log(`启动失败: ${err?.message || String(err)}`);
  } finally {
    startBridgeBtn.disabled = false;
  }
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
  renderHistory([]);
}

exportBtn.addEventListener("click", runExport);
startBridgeBtn.addEventListener("click", startBridgeManually);
clearHistoryBtn.addEventListener("click", clearHistory);

Promise.all([getHistory().then(renderHistory), loadSettings()])
  .then(async () => {
    bindSettingEvents();
    await refreshBridgeStatus();
  })
  .catch(() => {
    renderHistory([]);
  });
