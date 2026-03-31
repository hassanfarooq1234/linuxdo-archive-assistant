const BRIDGE_URL = "http://127.0.0.1:17805/import-topic";
const BRIDGE_HEALTH_URL = "http://127.0.0.1:17805/health";

const exportBtn = document.getElementById("exportBtn");
const startBridgeHint = document.getElementById("startBridgeHint");
const logEl = document.getElementById("log");
const enablePdfEl = document.getElementById("enablePdf");

function setStartBridgeVisible(visible) {
  startBridgeHint.style.display = visible ? "block" : "none";
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

async function ensureBridgeReady() {
  const health = await checkBridgeHealth();
  if (health.ok) {
    setStartBridgeVisible(false);
    return health;
  }

  setStartBridgeVisible(true);
  throw new Error("Bridge not running, please start it manually: uv run python local_bridge_server.py");
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

async function runExport() {
  exportBtn.disabled = true;
  try {
    log("\u68c0\u67e5\u5f53\u524d\u6807\u7b7e\u9875...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !isLinuxDoTopicUrl(tab.url)) {
      throw new Error("\u5f53\u524d\u9875\u9762\u4e0d\u662f linux.do \u4e3b\u9898\u5e16\u3002");
    }

    await ensureBridgeReady();

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

    const mode = enablePdfEl.checked ? "md+pdf" : "md-only";

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
    };

    log(`\u53d1\u9001\u5230\u672c\u5730\u6865\uff08${mode}\uff09...`);
    const accepted = await startAsyncImportWithRetry(payload, 3);

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
  } catch (err) {
    const message = err?.message || String(err);
    log(`\u5931\u8d25: ${message}`);
  } finally {
    exportBtn.disabled = false;
  }
}

exportBtn.addEventListener("click", runExport);

refreshBridgeStatus();
