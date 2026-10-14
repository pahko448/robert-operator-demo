const API_BASE = "/robert";
const SIDEBAR_STORAGE_KEY = "robert-sidebar-collapsed";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const MODE_LABELS = {
  content_optimization: "内容优化",
  content_completion: "内容填充",
  content_creation: "内容创作",
};
const MODE_COPY = {
  content_optimization: {label: "参考文案", placeholder: "粘贴需要优化的完整或接近完整文案"},
  content_completion: {label: "框架与想法", placeholder: "填写提纲、框架、已有观点或零散想法"},
  content_creation: {label: "主题与方向", placeholder: "填写主题、核心观点和希望传达的方向"},
};

let currentUser = null;
let selectedKind = null;
let currentTask = null;
let selectedClipFile = null;
let toastTimer = null;
let historyItems = [];
let historyLearningPattern = null;
let historyTotal = 0;
let historyLoadTimer = null;
let historyCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let generationClock = null;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {"Content-Type": "application/json", ...(options.headers || {})},
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  return {response, body};
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function setSidebarCollapsed(collapsed, persist = true) {
  const workspace = $("#workspace-view");
  const toggle = $("#sidebar-toggle");
  if (!workspace || !toggle) return;
  workspace.classList.toggle("sidebar-collapsed", collapsed);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "展开左侧导航" : "收起左侧导航");
  toggle.title = collapsed ? "展开左侧导航" : "收起左侧导航";
  if (persist) {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0"); } catch {}
  }
}

function restoreSidebarState() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1"; } catch {}
  setSidebarCollapsed(collapsed, false);
}

function setAuthenticated(value, user = null) {
  $("#library-page").innerHTML = "";
  currentUser = value ? (user || currentUser) : null;
  $("#login-view").classList.toggle("hidden", value);
  $("#workspace-view").classList.toggle("hidden", !value);
  $("#logout").classList.toggle("hidden", !value);
  $("#account-name").classList.toggle("hidden", !value);
  $("#account-name").textContent = value ? (currentUser?.display_name || currentUser?.username || "团队成员") : "";
  $("#history-library").classList.toggle("hidden", currentUser?.role !== "ADMIN");
  $("#history-review").textContent = currentUser?.role === "ADMIN" ? "内容审核" : "我的提交";
  $("#review-panel").classList.add("hidden");
  if (value) showWorkspacePage("creator");
}

async function restoreSession() {
  try {
    const {response, body} = await request("/auth/me", {method: "GET"});
    setAuthenticated(response.ok, body?.user);
  } catch {
    setAuthenticated(false);
  }
}

function showWorkspacePage(name) {
  $("#creator-page").classList.toggle("hidden", name !== "creator");
  $("#history-page").classList.toggle("hidden", name !== "history");
  $("#library-page").classList.toggle("hidden", name !== "library");
  $("#result-view").classList.add("hidden");
  $$(`[data-workspace-view]`).forEach((button) => button.classList.toggle("active", button.dataset.workspaceView === name));
  if (name === "history") loadHistory();
  if (name === "library") loadLibrary();
}

function currentCreationMode() {
  return $("input[name='creation_mode']:checked")?.value || "content_optimization";
}

function updateCopyModeFields() {
  if (selectedKind !== "copy") return;
  const copy = MODE_COPY[currentCreationMode()];
  $("#source-label").innerHTML = `${copy.label} <strong>必填</strong>`;
  $("#source-input").placeholder = copy.placeholder;
}

function updateGenerationModeHelp() {
  const mode = $("input[name='generation_mode']:checked")?.value || "standard";
  const help = $("#generation-mode-help");
  if (!help) return;
  const messages = selectedKind === "clip"
    ? {
        standard: "适合日常批量切片，快速完成原句筛选与标题生成；不会改写原句。",
        high_quality: "适合重要或复杂课程内容，更侧重语义理解、原句筛选与标题质量；耗时更长、费用更高，仍不会改写原句。",
      }
    : {
        standard: "适合日常批量文案，速度更快、费用更低；使用相同业务规则和知识边界。",
        high_quality: "适合重要或复杂文案，更侧重内容理解、结构、节奏、衔接与表达打磨；耗时更长、费用更高。",
      };
  help.textContent = messages[mode];
}

function selectKind(kind, focusSource = true) {
  selectedKind = kind;
  $$(`[data-kind]`).forEach((button) => button.setAttribute("aria-checked", String(button.dataset.kind === kind)));
  $("#business-form").setAttribute("aria-disabled", "false");
  $("#business-fields").disabled = false;
  $("#empty-selection").classList.add("hidden");
  $("#copy-mode-panel").classList.toggle("hidden", kind !== "copy");
  $("#instruction-field").classList.toggle("hidden", kind !== "copy");
  $("#clip-file-panel").classList.toggle("hidden", kind !== "clip");
  $("#clip-options").classList.toggle("hidden", kind !== "clip");
  $("#authorization-text").textContent = kind === "copy" ? "点击生成即确认本次参考内容、框架或主题可用于内部处理。" : "点击生成即确认本次逐字稿或字幕可用于内部处理。";
  $("#submit-business").textContent = kind === "copy" ? "生成文案" : "生成切片方案";
  if (kind === "copy") {
    clearClipFile();
    updateCopyModeFields();
  } else {
    $("#source-label").innerHTML = "授权逐字稿 <strong>必填</strong>";
    $("#source-input").placeholder = "粘贴逐字稿，或在下方选择 SRT / TXT 文件";
  }
  updateGenerationModeHelp();
  $("#business-state").textContent = "";
  if (focusSource) setTimeout(() => $("#source-input").focus(), 80);
}

function typeLabel(kind) {
  return kind === "copy" ? "短视频文案生成" : "原课精华切片";
}

function mustKeepItems(data) {
  return String(data.get("must_keep_text") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function buildTask(data) {
  const isClipFile = selectedKind === "clip" && selectedClipFile;
  return {
    id: crypto.randomUUID(),
    conversationId: "",
    kind: selectedKind,
    title: String(data.get("title") || "").trim(),
    source: isClipFile ? selectedClipFile.content : String(data.get("source") || "").trim(),
    sourceFormat: isClipFile ? selectedClipFile.format : "text",
    sourceFilename: isClipFile ? selectedClipFile.name : "",
    creationMode: selectedKind === "copy" ? currentCreationMode() : "",
    instruction: selectedKind === "copy" ? String(data.get("user_instruction") || "").trim() : "",
    previousOutput: "",
    purpose: selectedKind === "clip" ? String(data.get("target_purpose") || "").trim() : "",
    generationMode: String(data.get("generation_mode") || "standard"),
    mustKeep: selectedKind === "clip" ? mustKeepItems(data) : [],
    liked: false,
    revisionCount: 0,
    versions: [],
    startedAt: Date.now(),
    elapsedMs: 0,
    status: "RUNNING",
    requestId: "",
    response: null,
    message: "",
  };
}

function preferenceHtml(task) {
  const values = [task.generationMode === "high_quality" ? "精细生成" : "日常生成"];
  if (task.kind === "copy") values.unshift(VIDEO_LABELS[task.videoType || "general"], MODE_LABELS[task.creationMode] || "内容优化");
  if (task.kind === "clip" && task.purpose) values.push(task.purpose);
  if (task.revisionCount) values.push(`已修改 ${task.revisionCount - 1} 次`);
  return `<div class="preference-list">${values.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function outputHtml(task) {
  const output = task.response?.business_output || {};
  const content = task.kind === "copy" ? output.content : output.clip_script;
  const titles = Array.isArray(output.titles) ? output.titles : [];
  const summary = task.kind === "copy" ? output.change_summary : task.sourceFormat === "srt" ? `时间轴已保留，选用 ${output.alignment_report?.selected_cue_count || 0} 个字幕段` : `选用 ${output.fidelity_report?.selected_segment_count || 0} 个原文片段`;
  const artifacts = output.artifacts && typeof output.artifacts === "object" ? Object.keys(output.artifacts) : [];
  return `<div id="business-output-text" class="output-content">${escapeHtml(content || "无正文")}</div>${titles.length ? `<h3>备选标题</h3><ol class="title-list">${titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ol>` : ""}${summary ? `<p class="output-summary">${escapeHtml(summary)}</p>` : ""}${artifacts.length ? `<div class="artifact-list">${artifacts.map((name) => `<button class="button ghost" type="button" data-download-artifact="${escapeHtml(name)}">下载 ${escapeHtml(name)}</button>`).join("")}</div>` : ""}`;
}

function traceHtml(task) {
  const used = Array.isArray(task.response?.source_trace) ? task.response.source_trace : [];
  const retrieved = Array.isArray(task.response?.reference_context) && task.response.reference_context.length ? task.response.reference_context : used;
  if (!retrieved.length) return `<p class="field-help">公网演示未检索真实资料，结果是固定合成样例，未调用AI。</p>`;
  const usedIds = new Set(used.map((item) => item.source_id));
  return `<p class="reference-summary">本轮读取 ${retrieved.length} 项参考，其中 ${used.length} 项实际用于成品。</p><div class="trace-list">${retrieved.map((item) => {
    const rawLabel = item.display_name || "资料";
    const isExample = item.namespace === "copy.approved-examples";
    const isUsed = usedIds.has(item.source_id);
    const cleanedLabel = rawLabel.replace(/^优质成稿参考[：:]\s*/, "").replace(/^运营确认成稿[：:]\s*/, "");
    const label = isExample ? `优质成稿：《${cleanedLabel}》` : cleanedLabel;
    const usedDescription = item.namespace === "clip.authorized-transcript" ? "采用了本次提交的逐字稿" : item.namespace === "clip.authorized-srt" ? "采用了本次提交的字幕与时间轴" : item.namespace === "copy.approved-examples" ? "实际参考了结构、节奏或内容衔接，没有复制具体表达" : "实际用于表达规则、观点或内容边界";
    const readDescription = item.namespace === "copy.approved-examples" ? "已读取作为结构与节奏候选，本轮未直接采用" : "已读取用于适配判断，本轮未直接写入成品";
    const preview = String(item.source_text || "").trim();
    return `<details class="trace-item"><summary><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(isUsed ? usedDescription : readDescription)}</small></span><span class="reference-status ${isUsed ? "used" : ""}">${isUsed ? "已采用" : "已读取"}</span></summary><div class="reference-preview">${preview ? escapeHtml(preview) : "该资料仅参与规则校验，本轮没有可展示的业务片段。"}</div></details>`;
  }).join("")}</div>`;
}

function formatDuration(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function versionHistoryHtml(task) {
  const versions = Array.isArray(task.versions) ? task.versions : [];
  if (versions.length < 2) return "";
  return `<details class="version-history"><summary>查看 ${versions.length} 个版本的修改记录</summary><div class="version-list">${[...versions].reverse().map((item) => {
    const added = Array.isArray(item.diff?.added) ? item.diff.added : [];
    const removed = Array.isArray(item.diff?.removed) ? item.diff.removed : [];
    return `<article><div><strong>第 ${Number(item.version_no || 1)} 版</strong><span>${item.is_revision ? "按要求修改" : "首次生成"} · ${formatDuration(item.execution_meta?.total_ms)}</span></div>${item.instruction ? `<p>本轮要求：${escapeHtml(item.instruction)}</p>` : ""}${item.change_summary ? `<p>调整说明：${escapeHtml(item.change_summary)}</p>` : ""}${added.length ? `<p class="diff-added">新增：${escapeHtml(added.join(" / "))}</p>` : ""}${removed.length ? `<p class="diff-removed">删改：${escapeHtml(removed.join(" / "))}</p>` : ""}</article>`;
  }).join("")}</div></details>`;
}

function renderResult() {
  const target = $("#result-view");
  const task = currentTask;
  $("#creator-page").classList.add("hidden");
  $("#history-page").classList.add("hidden");
  $("#library-page").classList.add("hidden");
  target.classList.remove("hidden");
  if (task.status === "RUNNING") {
    const elapsed = Date.now() - (task.startedAt || Date.now());
    target.innerHTML = `<div class="generation-running"><span class="generation-spinner" aria-hidden="true"></span><div><h2>正在生成${escapeHtml(typeLabel(task.kind))}</h2><p>${task.generationMode === "high_quality" ? "精细生成会进行更充分的内容推理" : "日常生成已启用快速模式"} · 已用时 ${formatDuration(elapsed)}</p></div></div>`;
    return;
  }
  clearInterval(generationClock); generationClock = null;
  const success = task.status === "SUCCESS";
  const readOnly = Boolean(task.readOnly);
  const likeButton = success && task.kind === "copy"
    ? `<button class="button ghost" type="button" data-quality>${currentUser?.role === "ADMIN" ? (readOnly ? "直接纳入团队优质库" : "标记优质 / 纳入团队库") : (readOnly ? "提交团队审核" : "标记优质 / 提交团队审核")}</button>`
    : success && !readOnly ? `<button class="button ghost ${task.liked ? "liked" : ""}" type="button" data-like>${task.liked ? "已标记优质" : "标记为优质"}</button>` : "";
  const revise = success && task.kind === "copy" && !readOnly ? `<section class="revision-box"><h3>继续修改这篇文案</h3><p>写清本轮要改什么，系统会基于当前成稿继续修改并覆盖历史中的最新成稿。</p><textarea id="revision-input" maxlength="2000" placeholder="例如：开头再直接一些；第二段缩短；结尾不要口号，改成一个具体行动"></textarea><div class="revision-actions"><span id="revision-state" class="field-error"></span><button class="button primary" type="button" data-revise>按要求修改</button></div></section>` : "";
  const versionMeta = success ? `第 ${Math.max(1, task.revisionCount || 1)} 版 · 已修改 ${Math.max(0, (task.revisionCount || 1) - 1)} 次 · 用时 ${formatDuration(task.elapsedMs)}` : "";
  target.innerHTML = `<div class="result-header"><div class="result-heading"><span class="result-status ${success ? "" : "error"}">${success ? "✓" : "!"}</span><div><h2>${success ? "生成完成" : "本次未生成内容"}</h2><p>${escapeHtml(task.title || typeLabel(task.kind))}${versionMeta ? ` · ${escapeHtml(versionMeta)}` : ""}</p></div></div><div class="result-actions">${success ? `<button class="button ghost" type="button" data-copy-output>复制结果</button><button class="button ghost" type="button" data-download-output>下载</button>${likeButton}` : ""}<button class="button ghost" type="button" data-open-history>历史成稿</button><button class="button ghost" type="button" data-new-task>新建内容</button></div></div>${success ? `<div class="result-grid"><main class="result-main"><h3>业务成品</h3><div class="output-box">${outputHtml(task)}</div>${versionHistoryHtml(task)}${revise}</main><aside class="result-side"><section class="side-section"><h3>本次设置</h3>${preferenceHtml(task)}</section><section class="side-section"><h3>本次参考</h3>${traceHtml(task)}</section></aside></div>` : `<div class="blocked-box">${escapeHtml(task.message || "服务未返回可用结果。请检查输入后重新创建。")}</div>`}`;
  $("[data-new-task]", target).addEventListener("click", startNew);
  $("[data-open-history]", target).addEventListener("click", () => showWorkspacePage("history"));
  if (success) {
    $("[data-copy-output]", target).addEventListener("click", copyOutput);
    $("[data-download-output]", target).addEventListener("click", downloadOutput);
    $$(`[data-download-artifact]`, target).forEach((button) => button.addEventListener("click", () => downloadArtifact(button.dataset.downloadArtifact)));
    $("[data-like]", target)?.addEventListener("click", toggleCurrentLike);
    $("[data-quality]", target)?.addEventListener("click", () => openQualityDialog(currentTask));
    if (task.kind === "copy" && !readOnly) {
      $("[data-revise]", target)?.addEventListener("click", submitRevision);
    }
  }
}

async function executeTask(task) {
  currentTask = task;
  task.startedAt = Date.now();
  renderResult();
  clearInterval(generationClock);
  generationClock = setInterval(() => { if (currentTask === task && task.status === "RUNNING") renderResult(); }, 1000);
  const clipOptions = {generation_mode: task.generationMode, must_keep_items: task.mustKeep, authorization_confirmed: true};
  if (task.purpose) clipOptions.target_purpose = task.purpose;
  const isSrt = task.kind === "clip" && task.sourceFormat === "srt";
  const payload = task.kind === "copy" ? {
    source_material: task.source,
    video_type: task.videoType || "general",
    creation_mode: task.creationMode,
    user_instruction: task.instruction,
    previous_output: task.previousOutput,
    conversation_id: task.conversationId,
    title: task.title,
    generation_mode: task.generationMode,
    authorization_confirmed: true,
  } : isSrt ? {
    workflow_type: "course_highlight",
    conversation_id: task.conversationId,
    title: task.title,
    source: {asset_type: "srt", filename: task.sourceFilename, content: task.source},
    options: clipOptions,
    requested_outputs: ["script", "zh_srt", "bilingual_srt", "cut_list", "source_trace"],
  } : {...clipOptions, transcript: task.source, conversation_id: task.conversationId, title: task.title};
  try {
    const {response, body} = await request(isSrt ? "/api/v1/tasks" : `/api/v1/${task.kind}`, {method: "POST", headers: {"Idempotency-Key": task.id}, body: JSON.stringify(payload)});
    if (response.status === 401) {
      setAuthenticated(false);
      throw new Error("登录已失效，请重新登录");
    }
    task.response = body || {};
    if (body?.status === "success") { task.libraryLabels = []; task.liked = false; }
    task.elapsedMs = Number(body?.execution_meta?.total_ms || (Date.now() - task.startedAt));
    task.revisionCount = Number(body?.revision_count || task.revisionCount || 1);
    task.versions = Array.isArray(body?.versions) ? body.versions : task.versions;
    task.requestId = body?.request_id || "";
    task.conversationId = body?.conversation_id || task.conversationId;
    task.status = body?.status === "success" ? "SUCCESS" : body?.status === "blocked" ? "BLOCKED" : response.status === 429 ? "QUOTA" : "ERROR";
    task.message = body?.blocked_reason || body?.message || "服务未返回可用结果";
  } catch (error) {
    task.elapsedMs = Date.now() - task.startedAt;
    task.status = "OFFLINE";
    task.message = error.message || "无法连接运行服务";
  }
  renderResult();
  showToast(task.status === "SUCCESS" ? "业务成品已生成" : task.message);
}

async function submitBusiness(event) {
  event.preventDefault();
  if (!selectedKind) return;
  const data = new FormData(event.currentTarget);
  const source = selectedKind === "clip" && selectedClipFile ? selectedClipFile.content : String(data.get("source") || "").trim();
  if (selectedKind === "copy" && !data.get("video_type")) {
    $("#business-state").textContent = "请选择流量视频或带货视频。";
    return;
  }
  if (!source) {
    $("#business-state").textContent = selectedKind === "clip" ? "请粘贴逐字稿，或选择 SRT / TXT 文件。" : "请填写参考内容、框架或主题。";
    return;
  }
  const keepItems = selectedKind === "clip" ? mustKeepItems(data) : [];
  const invalidKeep = keepItems.find((item) => !source.includes(item));
  if (invalidKeep) {
    $("#business-state").textContent = `必须保留原句“${invalidKeep}”没有出现在逐字稿中。`;
    return;
  }
  $("#business-state").textContent = "";
  showToast("已提交，请勿重复点击");
  const task = buildTask(data);
  task.videoType = String(data.get("video_type") || "general");
  await executeTask(task);
}

async function submitRevision() {
  const instruction = $("#revision-input").value.trim();
  if (!instruction) {
    $("#revision-state").textContent = "请写清本轮要修改的内容。";
    return;
  }
  const prior = currentTask;
  const revised = {...prior, id: crypto.randomUUID(), instruction, previousOutput: prior.response?.business_output?.content || "", status: "RUNNING", requestId: "", response: null, message: ""};
  await executeTask(revised);
}

async function toggleCurrentLike() {
  if (!currentTask?.conversationId) return showToast("当前成稿尚未写入历史");
  const liked = !currentTask.liked;
  const {response, body} = await request(`/api/v1/history/${encodeURIComponent(currentTask.conversationId)}/like`, {method: "PATCH", body: JSON.stringify({liked})});
  if (!response.ok) return showToast(body?.message || "点赞失败");
  currentTask.liked = liked;
  renderResult();
  const message = currentTask.kind === "copy"
    ? (liked ? "已加入优质成稿库，后续文案可参考" : "已从优质成稿库移除")
    : (liked ? "已标记为优质切片" : "已取消优质标记");
  showToast(message);
}

function historyItemKind(item) {
  return item?.business_type === "clip" ? "clip" : "copy";
}

function historyContent(item) {
  const output = item?.business_output;
  if (!output || typeof output !== "object") return "";
  return historyItemKind(item) === "copy" ? String(output.content || "") : String(output.clip_script || "");
}

function historyTime(value) {
  const date = new Date(Number(value || 0) * 1000);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false}).format(date);
}

function historyGroup(value) {
  const date = new Date(Number(value || 0) * 1000);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round((start - day) / 86400000);
  if (difference <= 0) return "今天";
  if (difference === 1) return "昨天";
  if (difference < 7) return "本周";
  return "更早";
}

function currentHistoryFilters() {
  const date = $("[data-history-date].active")?.dataset.historyDate || "all";
  return {
    query: $("#history-search").value.trim(),
    kind: $("#history-kind").value,
    mode: $("#history-mode").value,
    quality: $("#history-quality").value,
    videoType: $("#history-video-type").value,
    date,
    dateFrom: $("#history-date-from").value,
    dateTo: $("#history-date-to").value,
    sort: $("#history-sort").value,
  };
}

function historyDateRange(filters = currentHistoryFilters()) {
  const now = new Date();
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
  if (filters.date === "today") return {from: startOfDay(now), to: Math.floor(now.getTime() / 1000)};
  if (filters.date === "7d" || filters.date === "30d") {
    const days = filters.date === "7d" ? 7 : 30;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    return {from: Math.floor(from.getTime() / 1000), to: Math.floor(now.getTime() / 1000)};
  }
  if (filters.date === "custom" && filters.dateFrom && filters.dateTo) {
    const from = new Date(`${filters.dateFrom}T00:00:00`);
    const to = new Date(`${filters.dateTo}T23:59:59.999`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) return {from: Math.floor(from.getTime() / 1000), to: Math.floor(to.getTime() / 1000)};
  }
  return {};
}

function historyQueryString() {
  const filters = currentHistoryFilters();
  const params = new URLSearchParams({limit: "500", sort: filters.sort});
  if (filters.query) params.set("q", filters.query);
  if (filters.kind !== "all") params.set("business_type", filters.kind);
  if (filters.mode !== "all" && filters.kind !== "clip") params.set("creation_mode", filters.mode);
  if (filters.quality === "liked") params.set("liked", "true");
  if (filters.quality === "unliked") params.set("liked", "false");
  if (QUALITY_NAMES[filters.quality]) params.set("quality_label", filters.quality);
  if (filters.videoType !== "all") params.set("video_type", filters.videoType);
  const range = historyDateRange(filters);
  if (range.from) params.set("updated_from", String(range.from));
  if (range.to) params.set("updated_to", String(range.to));
  return params.toString();
}

function renderActiveHistoryFilters() {
  const filters = currentHistoryFilters();
  const labels = [];
  if (filters.query) labels.push(`关键词：${filters.query}`);
  if (filters.kind !== "all") labels.push(filters.kind === "copy" ? "短视频文案" : "原课精华切片");
  if (filters.mode !== "all" && filters.kind !== "clip") labels.push(MODE_LABELS[filters.mode] || filters.mode);
  if (filters.quality !== "all") labels.push(QUALITY_NAMES[filters.quality] || (filters.quality === "liked" ? "个人已标记" : "个人未标记"));
  if (filters.videoType !== "all") labels.push(VIDEO_LABELS[filters.videoType]);
  const dateLabels = {today: "今天", "7d": "近 7 天", "30d": "近 30 天"};
  if (dateLabels[filters.date]) labels.push(dateLabels[filters.date]);
  if (filters.date === "custom" && filters.dateFrom && filters.dateTo) labels.push(`${filters.dateFrom} 至 ${filters.dateTo}`);
  $("#history-active-filters").innerHTML = labels.length ? `<span>当前筛选</span>${labels.map((label) => `<strong>${escapeHtml(label)}</strong>`).join("")}` : "";
}

function historyRow(item) {
  const kind = historyItemKind(item);
  const mode = kind === "copy" ? MODE_LABELS[item.creation_mode] || "内容优化" : item.source_format === "srt" ? "SRT 时间轴" : "逐字稿";
  const content = historyContent(item);
  const adminView = currentUser?.role === "ADMIN";
  const historyKey = `${item.owner_username || ""}|${item.conversation_id || ""}`;
  const owner = adminView ? `<small class="history-owner">成员：${escapeHtml(item.owner_display_name || item.owner_username || "未知")}</small>` : "";
  return `<article class="history-row" data-history-key="${escapeHtml(historyKey)}">
    <div class="history-summary"><strong>${escapeHtml(item.title || (kind === "copy" ? "未命名文案" : "未命名切片"))}</strong>${owner}<p>${escapeHtml(content.slice(0, 150) || "暂无正文摘要")}</p></div>
    <div class="history-type"><span>${escapeHtml(typeLabel(kind))}</span><small>${escapeHtml(mode)}</small></div>
    <div class="history-updated"><span>${escapeHtml(historyTime(item.updated_at))}</span><small>已修改 ${Math.max(0, Number(item.revision_count || 1) - 1)} 次</small></div>
    <div class="history-quality"><span class="quality-badge ${(item.library_labels?.length || item.liked) ? "liked" : ""}">个人：${escapeHtml(item.library_labels?.length ? item.library_labels.map(x => QUALITY_NAMES[x]).join(" / ") : item.liked ? "优质" : "未标记")}</span><small>${escapeHtml(VIDEO_LABELS[item.video_type || "general"])}</small>${(item.team_reviews || []).map(r => `<small>团队：${escapeHtml(REVIEW_NAMES[r.status])}（第${r.source_version}版）</small>`).join("")}</div>
    <div class="history-actions"><button class="button ghost" type="button" data-history-open>查看</button>${!adminView && kind === "copy" ? `<button class="button ghost" type="button" data-history-revise>继续修改</button>` : ""}${!adminView ? `<button class="button ghost ${item.liked ? "liked" : ""}" type="button" data-history-like>${item.liked ? "取消优质" : "标记优质"}</button>` : ""}</div>
  </article>`;
}

function renderHistory() {
  const state = $("#history-state");
  const list = $("#history-list");
  const values = historyItems;
  $("#history-mode-field").classList.toggle("hidden", $("#history-kind").value === "clip");
  const approvedCount = historyItems.filter((item) => historyItemKind(item) === "copy" && item.liked).length;
  state.textContent = `显示 ${values.length} 条，共 ${historyTotal} 条记录${approvedCount ? ` · 当前结果中 ${approvedCount} 篇优质文案` : ""}`;
  renderActiveHistoryFilters();
  if (!values.length) {
    list.innerHTML = `<div class="history-empty"><strong>没有符合条件的成稿</strong><p>调整条件或清除筛选后再查看。</p><div><button class="button ghost" type="button" data-history-empty-clear>清除筛选</button></div></div>`;
    $("[data-history-empty-clear]", list).addEventListener("click", clearHistoryFilters);
    return;
  }
  const groups = new Map();
  for (const item of values) {
    const group = historyGroup(item.updated_at);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  list.innerHTML = [...groups.entries()].map(([group, items]) => `<section class="history-group"><h2>${group}</h2><div class="history-table"><div class="history-table-head"><span>成稿</span><span>类型 / 方式</span><span>最近更新</span><span>质量</span><span>操作</span></div>${items.map(historyRow).join("")}</div></section>`).join("");
  $$(`[data-history-key]`, list).forEach((row) => {
    const item = historyItems.find((value) => `${value.owner_username || ""}|${value.conversation_id || ""}` === row.dataset.historyKey);
    $("[data-history-open]", row).addEventListener("click", () => openHistory(item));
    $("[data-history-revise]", row)?.addEventListener("click", () => openHistory(item, true));
    $("[data-history-like]", row)?.addEventListener("click", () => {
      if (historyItemKind(item) === "copy") { openHistory(item); openQualityDialog(currentTask); } else toggleHistoryLike(item);
    });
  });
}

async function loadHistory() {
  const state = $("#history-state");
  const list = $("#history-list");
  state.textContent = "正在读取历史…";
  list.innerHTML = "";
  try {
    const {response, body} = await request(`/api/v1/history?${historyQueryString()}`, {method: "GET"});
    if (!response.ok) throw new Error("历史读取失败");
    historyItems = Array.isArray(body?.items) ? body.items : [];
    historyTotal = Number(body?.total ?? historyItems.length);
    historyLearningPattern = body?.learning_pattern || null;
    renderHistory();
  } catch (error) {
    state.textContent = error.message || "历史读取失败";
    list.innerHTML = `<div class="history-empty"><strong>历史读取失败</strong><p>请检查网络后重试。</p><button class="button primary" type="button" data-history-retry>重新读取</button></div>`;
    $("[data-history-retry]", list).addEventListener("click", loadHistory);
  }
}

function openHistory(item, revise = false) {
  if (!item) return;
  const kind = historyItemKind(item);
  currentTask = {
    id: crypto.randomUUID(), conversationId: item.conversation_id, kind, title: item.title,
    source: historyContent(item), sourceFormat: item.source_format || "text", sourceFilename: "",
    creationMode: item.creation_mode || "content_optimization", instruction: "", previousOutput: "",
    purpose: "", generationMode: item.generation_mode || "standard", mustKeep: [], liked: Boolean(item.liked),
    revisionCount: Number(item.revision_count || 1), status: "SUCCESS", requestId: item.request_id || "",
    versions: Array.isArray(item.versions) ? item.versions : [],
    elapsedMs: Number(item.execution_meta?.total_ms || 0),
    ownerUsername: item.owner_username || "", ownerDisplayName: item.owner_display_name || "",
    readOnly: currentUser?.role === "ADMIN",
    videoType: item.video_type || item.business_output?.video_type || "general",
    libraryLabels: item.library_labels || [],
    teamReviews: item.team_reviews || [],
    contentSha256: item.content_sha256 || "",
    response: {business_output: item.business_output || {}, source_trace: item.source_trace || [], reference_context: item.reference_context || [], execution_meta: item.execution_meta || {}}, message: "",
  };
  renderResult();
  if (revise && kind === "copy") setTimeout(() => $("#revision-input")?.focus(), 50);
}

async function toggleHistoryLike(item) {
  if (!item?.conversation_id) return;
  const liked = !item.liked;
  const {response, body} = await request(`/api/v1/history/${encodeURIComponent(item.conversation_id)}/like`, {method: "PATCH", body: JSON.stringify({liked})});
  if (!response.ok) return showToast(body?.message || "优质标记更新失败");
  Object.assign(item, body.item || {liked});
  await loadHistory();
  showToast(liked ? "已标记为优质成稿" : "已取消优质标记");
}

function clearHistoryFilters() {
  $("#history-search").value = "";
  $("#history-kind").value = "all";
  $("#history-mode").value = "all";
  $("#history-quality").value = "all";
  $("#history-video-type").value = "all";
  $("#history-date-from").value = "";
  $("#history-date-to").value = "";
  $$(`[data-history-date]`).forEach((button) => button.classList.toggle("active", button.dataset.historyDate === "all"));
  $("#history-custom-date").classList.add("hidden");
  closeHistoryCalendar();
  updateHistoryDateLabel();
  $("#history-sort").value = "updated_desc";
  loadHistory();
}

function setHistoryDate(value) {
  $$(`[data-history-date]`).forEach((button) => button.classList.toggle("active", button.dataset.historyDate === value));
  $("#history-custom-date").classList.toggle("hidden", value !== "custom");
  if (value === "custom") {
    const source = $("#history-date-from").value || $("#history-date-to").value;
    if (source) {
      const date = new Date(`${source}T00:00:00`);
      historyCalendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    openHistoryCalendar();
  } else {
    closeHistoryCalendar();
    loadHistory();
  }
}

function localDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function updateHistoryDateLabel() {
  const from = $("#history-date-from").value;
  const to = $("#history-date-to").value;
  $("#history-date-label").textContent = from && to ? `${from} 至 ${to}` : from ? `${from} 起，继续选择结束日期` : "请选择开始和结束日期";
}

function renderHistoryCalendar() {
  const year = historyCalendarMonth.getFullYear();
  const month = historyCalendarMonth.getMonth();
  $("#history-calendar-title").textContent = `${year} 年 ${month + 1} 月`;
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const from = $("#history-date-from").value;
  const to = $("#history-date-to").value;
  const today = localDateValue(new Date());
  const cells = Array.from({length: offset}, () => `<span class="calendar-empty"></span>`);
  for (let day = 1; day <= count; day += 1) {
    const value = localDateValue(new Date(year, month, day));
    const selected = value === from || value === to;
    const inRange = Boolean(from && to && value > from && value < to);
    cells.push(`<button type="button" data-calendar-date="${value}" class="${selected ? "selected " : ""}${inRange ? "in-range " : ""}${value === today ? "today" : ""}" aria-label="${value}">${day}</button>`);
  }
  $("#history-calendar-days").innerHTML = cells.join("");
  $("#history-calendar-hint").textContent = !from ? "先选择开始日期" : !to ? "再选择结束日期" : `${from} 至 ${to}`;
  $$(`[data-calendar-date]`, $("#history-calendar-days")).forEach((button) => button.addEventListener("click", () => chooseHistoryCalendarDate(button.dataset.calendarDate)));
}

function openHistoryCalendar() {
  renderHistoryCalendar();
  $("#history-calendar").classList.remove("hidden");
  $("#history-date-trigger").setAttribute("aria-expanded", "true");
}

function closeHistoryCalendar() {
  $("#history-calendar").classList.add("hidden");
  $("#history-date-trigger").setAttribute("aria-expanded", "false");
}

function chooseHistoryCalendarDate(value) {
  const from = $("#history-date-from");
  const to = $("#history-date-to");
  if (!from.value || to.value) {
    from.value = value;
    to.value = "";
  } else if (value < from.value) {
    from.value = value;
  } else {
    to.value = value;
  }
  updateHistoryDateLabel();
  renderHistoryCalendar();
  if (from.value && to.value) {
    closeHistoryCalendar();
    loadHistory();
  }
}

function clearHistoryCalendarDate() {
  $("#history-date-from").value = "";
  $("#history-date-to").value = "";
  updateHistoryDateLabel();
  renderHistoryCalendar();
}

function queueHistoryLoad() {
  clearTimeout(historyLoadTimer);
  historyLoadTimer = setTimeout(loadHistory, 250);
}

function startNew() {
  currentTask = null;
  showWorkspacePage("creator");
  window.scrollTo({top: 0, behavior: "smooth"});
}

async function copyOutput() {
  try { await navigator.clipboard.writeText($("#business-output-text")?.textContent || ""); showToast("业务成品已复制"); }
  catch { showToast("复制失败，请手动选择正文"); }
}

function downloadOutput() {
  const blob = new Blob([$("#business-output-text")?.textContent || ""], {type: "text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `${currentTask?.title || "Robert生成结果"}.txt`; link.click(); URL.revokeObjectURL(url);
}

function downloadArtifact(name) {
  const content = currentTask?.response?.business_output?.artifacts?.[name];
  if (typeof content !== "string") return;
  const blob = new Blob([content], {type: name.endsWith(".csv") ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

function clearClipFile() {
  selectedClipFile = null;
  $("#clip-file-input").value = "";
  $("#clip-file-state").textContent = "";
}

async function selectClipFile(event) {
  const file = event.target.files?.[0];
  if (!file) return clearClipFile();
  const lower = file.name.toLowerCase();
  const format = lower.endsWith(".srt") ? "srt" : lower.endsWith(".txt") ? "txt" : "";
  if (!format || file.size > 100000) {
    clearClipFile();
    $("#business-state").textContent = !format ? "仅支持 .srt 或 .txt 文件。" : "字幕文件不能超过 100 KB。";
    return;
  }
  const content = (await file.text()).trim();
  if (!content) return;
  selectedClipFile = {name: file.name, format, content};
  $("#clip-file-state").textContent = format === "srt" ? `已选择 ${file.name} · ${(content.match(/-->/g) || []).length} 条时间轴` : `已选择 ${file.name}`;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form); const state = $("#login-state"); const submit = $("button[type='submit']", form);
  state.textContent = "正在登录…"; submit.disabled = true;
  try {
    const {response, body} = await request("/auth/login", {method: "POST", body: JSON.stringify({username: data.get("username"), password: data.get("password")})});
    if (!response.ok) throw new Error(body?.detail === "INVALID_CREDENTIALS" ? "账号或密码不正确" : "登录失败");
    state.textContent = ""; form.reset(); setAuthenticated(true, body.user);
  } catch (error) { state.textContent = error.message || "登录失败"; }
  finally { submit.disabled = false; }
});

$("#logout").addEventListener("click", async () => { await request("/auth/logout", {method: "POST", body: "{}"}).catch(() => null); setAuthenticated(false); });
$("#sidebar-toggle").addEventListener("click", () => setSidebarCollapsed(!$("#workspace-view").classList.contains("sidebar-collapsed")));
$$(`[data-workspace-view]`).forEach((button) => button.addEventListener("click", () => showWorkspacePage(button.dataset.workspaceView)));
$$(`[data-open-history]`).forEach((button) => button.addEventListener("click", () => showWorkspacePage("history")));
$$(`[data-kind]`).forEach((button) => button.addEventListener("click", () => selectKind(button.dataset.kind)));
$$(`input[name='creation_mode']`).forEach((input) => input.addEventListener("change", updateCopyModeFields));
$$(`input[name='generation_mode']`).forEach((input) => input.addEventListener("change", updateGenerationModeHelp));
$("#source-input").addEventListener("input", (event) => {
  const count = event.target.value.length;
  $("#source-count").textContent = `${count} / 50000`;
  $("#source-count").classList.toggle("hidden", count < 40000);
});
$("#instruction-input").addEventListener("input", (event) => { $("#instruction-count").textContent = `${event.target.value.length} / 2000`; });
$("#business-form").addEventListener("submit", submitBusiness);
$("#clip-file-input").addEventListener("change", selectClipFile);
$("#history-new").addEventListener("click", startNew);
$("#history-search").addEventListener("input", queueHistoryLoad);
["history-kind", "history-mode", "history-quality", "history-sort", "history-video-type"].forEach((id) => {
  $(`#${id}`).addEventListener("change", loadHistory);
});
$$(`[data-history-date]`).forEach((button) => button.addEventListener("click", () => setHistoryDate(button.dataset.historyDate)));
$("#history-date-trigger").addEventListener("click", () => $("#history-calendar").classList.contains("hidden") ? openHistoryCalendar() : closeHistoryCalendar());
$("#history-calendar-prev").addEventListener("click", () => { historyCalendarMonth = new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth() - 1, 1); renderHistoryCalendar(); });
$("#history-calendar-next").addEventListener("click", () => { historyCalendarMonth = new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth() + 1, 1); renderHistoryCalendar(); });
$("#history-calendar-clear").addEventListener("click", clearHistoryCalendarDate);
$("#history-custom-date").addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", (event) => {
  if (!$("#history-custom-date").contains(event.target) && !event.target.closest("[data-history-date=custom]")) closeHistoryCalendar();
});
$("#history-clear").addEventListener("click", clearHistoryFilters);
restoreSidebarState();
restoreSession();
