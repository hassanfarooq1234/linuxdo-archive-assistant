const BRIDGE_URL = "http://127.0.0.1:17805/import-topic";
const BRIDGE_OPEN_FOLDER_URL = "http://127.0.0.1:17805/open-folder";
const HISTORY_KEY = "challenge05_export_history";
const SETTINGS_KEY = "challenge05_export_settings";
const MAX_HISTORY = 12;

const PDF_PROFILE_MAP = {
  full: "configs/pdf.ctf-full.json",
  brief: "configs/pdf.ctf-brief.json",
};

const DEFAULT_SETTINGS = {
  enablePdf: true,
  pdfProfile: "full",
};

const exportBtn = document.getElementById("exportBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const logEl = document.getElementById("log");
const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const enablePdfEl = document.getElementById("enablePdf");
const pdfProfileEl = document.getElementById("pdfProfile");

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
    // Brief pause to avoid rate limiting
    if (i + BATCH < missingIds.length) {
      await new Promise((r) => setTimeout(r, 300));
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

async function postToBridgeWithRetry(payload, maxAttempts = 3) {
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
  openFolderBtn.style.display = "none";
  try {
    log("检查当前标签页...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !isLinuxDoTopicUrl(tab.url)) {
      throw new Error("当前页面不是 linux.do 主题帖。");
    }

    log("从当前页面读取 topic JSON（含分页拉取全部楼层）...");
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchTopicJsonInPage,
    });
    if (!execResult?.result?.topicJson) {
      throw new Error("未获取到 topic JSON。");
    }

    const totalPosts = execResult.result.topicJson.post_stream?.posts?.length || 0;
    log(`已获取 ${totalPosts} 楼，准备发送...`);

    const settings = await loadSettings();
    const profileKey = settings.pdfProfile;
    const pdfConfigPath = PDF_PROFILE_MAP[profileKey];
    const mode = settings.enablePdf ? "md+pdf" : "md-only";

    const postStartVal = document.getElementById("postStart").value.trim();
    const postEndVal = document.getElementById("postEnd").value.trim();

    log(`发送到本地服务（${mode}，失败低频重试）...`);
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
    };
    if (postStartVal) payload.post_start = parseInt(postStartVal, 10);
    if (postEndVal) payload.post_end = parseInt(postEndVal, 10);
    const result = await postToBridgeWithRetry(payload, 3);

    log(
      [
        "导出完成",
        `Topic ID: ${result.topic_id}`,
        `Mode: ${mode}`,
        `Markdown: ${result.markdown_path}`,
        `PDF: ${result.pdf_path || "(未生成)"}`,
        `Index: ${result.index_path || "(未更新)"}`,
        `Task Log: ${result.task_log_path || "(未记录)"}`,
      ].join("\n")
    );
    if (result.output_dir) {
      openFolderBtn.style.display = "block";
      openFolderBtn.onclick = async () => {
        try {
          const resp = await fetch(`${BRIDGE_OPEN_FOLDER_URL}?path=${encodeURIComponent(result.output_dir)}`);
          const data = await resp.json();
          if (!data.ok) {
            log(`打开目录失败: ${data.error || data.message || "unknown"}`);
          }
        } catch (err) {
          log(`打开目录失败: ${err.message}`);
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
  } catch (err) {
    const message = err?.message || String(err);
    log(`失败: ${message}`);
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
  }
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
  renderHistory([]);
}

exportBtn.addEventListener("click", runExport);
clearHistoryBtn.addEventListener("click", clearHistory);

Promise.all([getHistory().then(renderHistory), loadSettings()])
  .then(bindSettingEvents)
  .catch(() => {
    renderHistory([]);
  });
