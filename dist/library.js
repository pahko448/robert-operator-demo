const VIDEO_LABELS = {traffic: "流量视频", sales: "带货视频", general: "通用 / 待分类"};
const QUALITY_NAMES = {content_quality: "内容质量好", traffic_effect: "流量效果好", sales_effect: "带货效果好"};
let libraryItems = [], importPreviewItems = [];
let librarySelected = new Set();
let reviewItems = [];
const REVIEW_NAMES = {pending: "待审核", approved: "已纳入团队参考", rejected: "已退回", revoked: "已撤销团队参考"};

async function digestText(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text).trim())))].map(v => v.toString(16).padStart(2, "0")).join("");
}

async function loadReviews() {
  const panel = $("#review-panel"); panel.classList.remove("hidden");
  panel.innerHTML = '<p>正在读取提交记录…</p>';
  try {
    const {response, body} = await request("/api/v1/library/reviews", {method: "GET"});
    if (!response.ok) throw new Error(body.detail || body.message || "读取失败");
    reviewItems = body.items || [];
    panel.innerHTML = '<div class="review-toolbar"><h2>' + (currentUser.role === "ADMIN" ? '内容审核' : '我的提交') + '</h2><select id="review-filter" aria-label="审核状态"><option value="all">全部审核状态</option>' + Object.entries(REVIEW_NAMES).map(([k,v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select><button id="review-refresh" class="button ghost" type="button">刷新</button><button id="review-close" class="button ghost" type="button">收起审核记录</button></div><div id="review-list"></div>';
    $("#review-filter").addEventListener("change", renderReviews);
    $("#review-refresh").addEventListener("click", loadReviews);
    $("#review-close").addEventListener("click", () => panel.classList.add("hidden"));
    renderReviews();
  } catch (error) {
    panel.innerHTML = '<p>' + escapeHtml(error.message) + '，请重试。</p><button id="review-retry" class="button ghost" type="button">重试</button>';
    $("#review-retry").addEventListener("click", loadReviews);
  }
}
function renderReviews() {
  const filter = $("#review-filter").value;
  const items = reviewItems.filter(r => filter === "all" || r.status === filter);
  $("#review-list").innerHTML = items.length ? items.map(r => '<article class="review-row"><div><button class="review-title" data-review-open="' + r.entry_id + '" type="button">' + escapeHtml(r.title) + '</button><p>' + escapeHtml(r.content.slice(0,100)) + '</p><small>提交人：' + escapeHtml(r.submitter_display_name || r.submitter_username) + ' · ' + escapeHtml(historyTime(r.submitted_at)) + ' · 第' + r.source_version + '版</small></div><div><span>' + escapeHtml(VIDEO_LABELS[r.video_type]) + '</span><p>' + escapeHtml(r.quality_labels.map(x=>QUALITY_NAMES[x]).join(' / ')) + '</p><strong>' + escapeHtml(REVIEW_NAMES[r.status]) + '</strong></div><button class="button ghost" data-review-open="' + r.entry_id + '" type="button">' + (currentUser.role === "ADMIN" ? '查看并审核' : '查看内容与结果') + '</button></article>').join('') : '<div class="history-empty">暂无符合条件的提交记录。</div>';
  $$('[data-review-open]').forEach(b => b.addEventListener('click', () => openReview(reviewItems.find(r=>r.entry_id===b.dataset.reviewOpen))));
}
function openReview(item) {
  const old = $("#review-dialog"); if (old) old.remove();
  const dialog = document.createElement("dialog"); dialog.id = "review-dialog"; dialog.className = "quality-dialog review-dialog";
  const admin = currentUser.role === "ADMIN", pending = item.status === "pending";
  dialog.innerHTML = '<form method="dialog"><h2>' + escapeHtml(item.title) + '</h2><p>提交人：' + escapeHtml(item.submitter_display_name || item.submitter_username) + ' · ' + escapeHtml(historyTime(item.submitted_at)) + ' · 第' + item.source_version + '版</p><p>状态：' + escapeHtml(REVIEW_NAMES[item.status]) + '</p><h3>提交文案（审核版本）</h3><div class="review-body">' + escapeHtml(item.content) + '</div><p>提交说明：' + escapeHtml(item.submission_note || '无') + '</p><p>仅作为内部结构、节奏和表达参考，不迁移人物经历或效果承诺。</p>' +
    (admin && pending ? '<label>视频类型<select id="review-video-type">' + videoOptions(item.video_type) + '</select></label><fieldset class="quality-checks"><legend>审核标记</legend>' + labelOptions('review-label',item.quality_labels) + '</fieldset>' : '<p>' + escapeHtml(VIDEO_LABELS[item.video_type]) + ' · ' + escapeHtml(item.quality_labels.map(x=>QUALITY_NAMES[x]).join(' / ')) + '</p>') +
    (item.reviewed_by ? '<p>审核人：' + escapeHtml(item.reviewer_display_name || item.reviewed_by) + ' · ' + escapeHtml(historyTime(item.reviewed_at)) + '</p><p>审核意见：' + escapeHtml(item.review_opinion || '通过') + '</p>' : '') +
    (admin && (pending || item.status === 'approved') ? '<label>审核意见／原因<textarea id="review-opinion" maxlength="1000" placeholder="退回或撤销须填写原因"></textarea></label>' : '') +
    '<p id="review-error" class="field-error" aria-live="polite"></p><div class="library-actions"><button class="button ghost" type="submit" value="cancel">关闭</button>' + (admin && pending ? '<button class="button ghost" type="button" data-decision="rejected">退回</button><button class="button primary" type="button" data-decision="approved">通过并纳入团队参考</button>' : admin && item.status==='approved' ? '<button class="button ghost" type="button" data-decision="revoked">撤销团队参考</button>' : '') + '</div></form>';
  document.body.append(dialog); dialog.showModal();
  $$('[data-decision]',dialog).forEach(button => button.addEventListener('click',async()=>{
    $$('[data-decision]',dialog).forEach(b=>b.disabled=true);
    try {
      const payload = {decision:button.dataset.decision, review_opinion:$("#review-opinion",dialog)?.value || '', video_type:$("#review-video-type",dialog)?.value || item.video_type, quality_labels:pending ? $$('input[name="review-label"]:checked',dialog).map(x=>x.value) : item.quality_labels};
      const {response,body}=await request('/api/v1/library/'+item.entry_id,{method:'PATCH',body:JSON.stringify(payload)});
      if(!response.ok) throw new Error(body.detail || body.message || '审核失败');
      dialog.close(); await loadReviews(); await loadHistory(); showToast(REVIEW_NAMES[body.item.status]);
    }catch(error){$("#review-error",dialog).textContent=error.message+'，请检查或刷新记录后重试。';}
    finally{$$('[data-decision]',dialog).forEach(b=>b.disabled=false);}
  }));
}
document.addEventListener("DOMContentLoaded", () => {
  $("#history-review").addEventListener("click", loadReviews);
  $("#history-library").addEventListener("click", () => { if(currentUser?.role === "ADMIN") showWorkspacePage("library"); });
});
function videoOptions(value) {
  return Object.entries(VIDEO_LABELS).map(([key, label]) => '<option value="' + key + '"' + (value === key ? ' selected' : '') + '>' + label + '</option>').join("");
}
function labelOptions(name, values) {
  return Object.entries(QUALITY_NAMES).map(([key, label]) => '<label><input type="checkbox" name="' + name + '" value="' + key + '"' + (values.includes(key) ? ' checked' : '') + '> ' + label + '</label>').join("");
}
function libraryLayout() {
  $("#library-page").innerHTML =
    '<header class="page-header"><div><p class="eyebrow">管理员维护</p><h1>管理参考文案</h1></div><div class="library-actions"><button id="library-back" class="button ghost" type="button">返回历史成稿</button><button id="library-refresh" class="button ghost" type="button">刷新文案库</button></div></header>' +
    '<section class="content-panel library-intake"><h2>现有文案类型归类</h2><p>勾选原始文案库中的流量视频，确认后其余原始条目归为带货。效果标签保持原样。</p><input id="library-search" type="search" placeholder="搜索文案标题或正文">' +
    '<div class="library-actions"><button id="library-classify" class="button primary" type="button">确认流量清单，其余归为带货</button><span id="library-selection-count"></span></div><p id="library-status" aria-live="polite"></p><p id="library-classification-summary"></p><div class="library-inline"><label>视频类型<select id="library-type-filter"><option value="all">全部类型</option><option value="traffic">流量视频</option><option value="sales">带货视频</option><option value="general">待分类</option></select></label><label>参考标记<select id="library-quality-filter"><option value="all">全部标记</option><option value="traffic_effect">流量效果好</option><option value="sales_effect">带货效果好</option><option value="quality_only">仅内容质量好（未标记效果）</option><option value="withdrawn">已撤回</option></select></label></div></section>' +
    '<section class="content-panel library-intake"><h2>补充效果好的文案</h2><p>粘贴完整文案或选择 TXT 文件；多篇之间用单独一行 --- 分隔。预览后确认入库。</p>' +
    '<div class="library-inline"><label>适用类型<select id="import-video-type">' + videoOptions("traffic") + '</select></label><fieldset><legend>人工质量与效果标记（可多选）</legend>' + labelOptions("import-label", ["content_quality"]) + '</fieldset></div>' +
    '<label>资料来源（可选）<input id="library-import-source" maxlength="200" placeholder="例如：运营提供的效果好文案"></label><textarea id="library-import-text" maxlength="100000" placeholder="粘贴文案正文"></textarea><div class="library-actions"><label class="button ghost">选择 TXT 文件<input id="library-import-file" type="file" accept=".txt,text/plain"></label><button id="library-parse" class="button ghost" type="button">预览条目</button></div>' +
    '<div id="library-import-preview"></div><label class="library-authorization"><input id="library-import-authorized" type="checkbox"> 确认这些文案可用于团队内部参考</label><button id="library-import-confirm" class="button primary" type="button" disabled>确认补充到团队库</button><p id="library-import-status" aria-live="polite"></p></section><div id="library-list"></div>';
  if (currentUser?.role !== "ADMIN") {
    $("#library-page h1").textContent = "个人优质参考";
    $$(".library-intake").forEach(section => section.classList.add("hidden"));
    $("#library-page .eyebrow").textContent = "仅供本人使用";
  }
  $("#library-refresh").addEventListener("click", loadLibrary);
  $("#library-back").addEventListener("click", () => showWorkspacePage("history"));
  $("#library-search").addEventListener("input", renderLibraryItems);
  $("#library-type-filter").addEventListener("change", renderLibraryItems);
  $("#library-quality-filter").addEventListener("change", renderLibraryItems);
  $("#library-quality-filter").closest(".library-inline").insertAdjacentHTML("afterend", '<div class="library-actions"><span id="library-filter-count"></span><button id="library-view-results" class="button ghost" type="button">查看筛选结果</button></div>');
  $("#library-view-results").addEventListener("click", () => $("#library-list").scrollIntoView({behavior:"smooth",block:"start"}));
  $("#library-classify").addEventListener("click", confirmClassify);
  $("#library-parse").addEventListener("click", previewImport);
  $("#library-import-confirm").addEventListener("click", confirmImport);
  $("#library-import-authorized").addEventListener("change", updateImportButton);
  $("#library-import-text").addEventListener("input", () => { importPreviewItems = []; $("#library-import-preview").textContent = ""; updateImportButton(); });
  $("#library-import-file").addEventListener("change", async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt") || file.size > 300000) return showToast("请选择 300 KB 以内的 TXT 文件");
    $("#library-import-text").value = await file.text(); previewImport();
  });
}
async function loadLibrary() {
  if (currentUser?.role !== "ADMIN") return;
  if (!$("#library-list")) libraryLayout();
  $("#library-status").textContent = "正在读取团队库…";
  try {
    const {response, body} = await request("/api/v1/library", {method: "GET"});
    if (!response.ok) throw new Error(body.message || body.detail || "读取失败");
    libraryItems = body.items || [];
    librarySelected = new Set(libraryItems.filter(item => item.source_locator && item.video_type === "traffic").map(item => item.entry_id));
    $("#library-status").textContent = '共 ' + libraryItems.length + ' 篇，' + libraryItems.filter(i => i.active).length + ' 篇可参考；标记为运营人工认可。';
    const original = libraryItems.filter(i => i.source_locator);
    const traffic = original.filter(i=>i.video_type==='traffic').length;
    const sales = original.filter(i=>i.video_type==='sales').length;
    const trafficGood = original.filter(i=>i.active && i.quality_labels.includes('traffic_effect')).length;
    const salesGood = original.filter(i=>i.active && i.quality_labels.includes('sales_effect')).length;
    const onlyQuality = original.filter(i=>i.active && i.quality_labels.includes('content_quality') && !i.quality_labels.some(x=>x==='traffic_effect'||x==='sales_effect')).length;
    $("#library-classification-summary").textContent = `原始库 ${original.length} 篇：流量 ${traffic} 篇、带货 ${sales} 篇；流量效果好 ${trafficGood} 篇、带货效果好 ${salesGood} 篇、仅内容质量好 ${onlyQuality} 篇。`;
    renderLibraryItems();
  } catch (error) { $("#library-status").textContent = error.message + '，可点击“刷新文案库”重试。'; }
}
function renderLibraryItems() {
  const query = $("#library-search").value.trim().toLowerCase();
  const kind = $("#library-type-filter").value, quality = $("#library-quality-filter").value;
  const visible = libraryItems.filter(i => (i.title + " " + i.content).toLowerCase().includes(query)
    && (kind==='all'||i.video_type===kind)
    && (quality==='all'||quality==='withdrawn'&&!i.active||i.active&&(quality==='quality_only' ? i.quality_labels.includes('content_quality')&&!i.quality_labels.some(x=>x==='traffic_effect'||x==='sales_effect') : i.quality_labels.includes(quality))));
  $("#library-filter-count").textContent = `当前筛选 ${visible.length} 篇`;
  $("#library-list").innerHTML = visible.length ? visible.map(item =>
    '<article class="library-entry"><div class="library-entry-header">' +
    (item.source_locator ? '<label><input type="checkbox" data-library-select="' + item.entry_id + '"' + (librarySelected.has(item.entry_id) ? ' checked' : '') + '> 流量清单</label>' : '<span>后续补充</span>') +
    '<strong>' + escapeHtml(item.title) + '</strong><button class="button ghost" type="button" data-library-edit="' + item.entry_id + '">调整标记 / 撤回</button></div>' +
    '<p class="library-tags">' + escapeHtml(VIDEO_LABELS[item.video_type]) + ' · ' + escapeHtml(item.quality_labels.map(x => QUALITY_NAMES[x]).join(" / ") || "已撤回") + '</p>' +
    '<details><summary>查看文案与来源</summary><p class="library-body">' + escapeHtml(item.content) + '</p><p>来源：' + (item.source_locator ? '运营提供文案库' : item.source_path.startsWith("history/") ? '管理员确认的历史成稿' : '管理员补充') + ' · 内部结构表达参考</p>' + (item.classification_source ? '<p>分类依据：' + escapeHtml(item.classification_source) + ' · 运营确认，仅本批原条目适用</p>' : '') + '</details></article>'
  ).join("") : '<div class="history-empty">没有匹配文案，调整搜索条件后重试。</div>';
  $$("[data-library-select]").forEach(input => input.addEventListener("change", () => {
    if (input.checked) librarySelected.add(input.dataset.librarySelect); else librarySelected.delete(input.dataset.librarySelect);
    $("#library-selection-count").textContent = '已选择 ' + librarySelected.size + ' 篇流量文案';
  }));
  $$("[data-library-edit]").forEach(button => button.addEventListener("click", () => openQualityDialog(null, libraryItems.find(i => i.entry_id === button.dataset.libraryEdit))));
  $("#library-selection-count").textContent = '已选择 ' + librarySelected.size + ' 篇流量文案';
}
async function confirmClassify() {
  const total = libraryItems.filter(i => i.source_locator).length;
  if (!confirm('确认 ' + librarySelected.size + ' 篇为流量视频，其余 ' + (total - librarySelected.size) + ' 篇为带货视频？此操作不会增加效果标签。')) return;
  const button = $("#library-classify"); button.disabled = true;
  try {
    const {response, body} = await request("/api/v1/library/classify", {method: "POST", body: JSON.stringify({traffic_ids: [...librarySelected]})});
    if (!response.ok) throw new Error(body.message || body.detail || "归类失败");
    await loadLibrary(); showToast('已归类：流量 ' + body.traffic + ' 篇，带货 ' + body.sales + ' 篇');
  } catch (error) { $("#library-status").textContent = error.message + '，请重试。'; }
  finally { button.disabled = false; }
}
function previewImport() {
  const parts = $("#library-import-text").value.trim().split(/\r?\n\s*---+\s*\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 100 || parts.some(t => t.length < 10 || t.length > 5000)) {
    importPreviewItems = []; $("#library-import-preview").textContent = "每次 1 至 100 篇，每篇 10 至 5000 字。"; updateImportButton(); return;
  }
  importPreviewItems = parts;
  $("#library-import-preview").innerHTML = '<p>预览 ' + parts.length + ' 篇；重复正文会关联原条目。</p><ol>' + parts.map(t => '<li>' + escapeHtml(t.split("\n")[0].slice(0, 80)) + '（' + t.length + ' 字）</li>').join("") + '</ol>';
  updateImportButton();
}
function updateImportButton() {
  $("#library-import-confirm").disabled = !importPreviewItems.length || !$("#library-import-authorized").checked;
}
async function confirmImport() {
  const labels = $$('input[name="import-label"]:checked').map(x => x.value);
  if (!labels.length) return showToast("至少选择一种质量或效果标记");
  const items = importPreviewItems.map(content => ({content, video_type: $("#import-video-type").value, quality_labels: labels, authorization_confirmed: true, source_label: $("#library-import-source").value}));
  const button = $("#library-import-confirm"); button.disabled = true;
  try {
    const {response, body} = await request("/api/v1/library/import", {method: "POST", body: JSON.stringify({items})});
    if (!response.ok) throw new Error(body.message || body.detail || "补充失败");
    $("#library-import-status").textContent = '新增 ' + body.created + ' 篇，关联更新 ' + body.updated + ' 篇。';
    importPreviewItems = []; $("#library-import-text").value = ""; $("#library-import-preview").textContent = ""; await loadLibrary();
  } catch (error) { $("#library-import-status").textContent = error.message + '，请检查文案后重试。'; }
  finally { updateImportButton(); }
}
async function openQualityDialog(task, item = null) {
  if (item?.approval_ids) return showToast("审核入库的文案请在内容审核中撤销，不直接改写审核结果");
  const admin = currentUser?.role === "ADMIN";
  const content = task?.response?.business_output?.content || item?.content || "";
  const hash = item?.content_sha256 || await digestText(content);
  let labels = item?.quality_labels || task?.libraryLabels || (task?.liked ? ["content_quality"] : []);
  let personalSnapshots = [];
  if (!item) {
    const {response, body} = await request("/api/v1/library/personal", {method: "GET"});
    if (!response.ok) return showToast(body.message || body.detail || "无法读取标记，请重试");
    personalSnapshots = (body.items || []).filter(i => i.source_path === "history/" + task.conversationId);
    const current = personalSnapshots.find(i => i.content_sha256 === hash && i.source_version === (task.revisionCount || 1));
    if (current) labels = current.quality_labels;
  }
  const old = $("#quality-dialog"); if (old) old.remove();
  const dialog = document.createElement("dialog"); dialog.id = "quality-dialog"; dialog.className = "quality-dialog";
  const own = !task?.ownerUsername || task.ownerUsername === currentUser.username;
  dialog.innerHTML = '<form method="dialog"><h2>' + (item ? '调整参考标记' : '标记优质 / 提交团队审核') + '</h2><p>个人标记立即生效；团队参考须管理员审核通过。</p>' +
    (!item ? '<fieldset class="quality-checks"><legend>本次操作（二选一）</legend>' + (own ? '<label><input type="radio" name="quality-destination" value="personal" checked> 标记为个人优质</label>' : '') + '<label><input type="radio" name="quality-destination" value="team"' + (!own ? ' checked' : '') + '> 提交团队审核</label></fieldset>' : '') +
    '<p class="quality-snapshot">本次标记：' + escapeHtml(item?.title || task?.title || "当前成稿") + ' · ' + (task ? '第 ' + (task.revisionCount || 1) + ' 版' : '文案库条目') + '</p>' +
    '<label>适用类型<select id="quality-video-type">' + videoOptions(item?.video_type || task?.videoType || "general") + '</select></label>' +
    '<fieldset class="quality-checks"><legend>人工质量与效果标记（可多选）</legend>' + labelOptions("quality-label", labels) + '</fieldset><p class="field-help">无需填写数据和平台。清除全部标签即可撤回参考资格。</p>' +
    (!item ? '<label id="submission-note-field" class="hidden">提交说明（可选）<textarea id="submission-note" maxlength="1000" placeholder="说明推荐理由，不填平台和数据"></textarea></label>' : '') +
    (personalSnapshots.length ? '<details><summary>管理已标记的个人参考版本</summary>' + personalSnapshots.map(i => '<p>第' + i.source_version + '版 · ' + escapeHtml(i.quality_labels.map(x=>QUALITY_NAMES[x]).join(' / ') || '已撤回') + ' <button class="button ghost" type="button" data-personal-snapshot="' + i.entry_id + '">查看／调整</button></p>').join('') + '</details>' : '') +
    (item ? '<details><summary>查看此参考版本正文</summary><div class="review-body">' + escapeHtml(item.content) + '</div></details>' : '') +
    '<p id="quality-save-state" class="field-error" aria-live="polite"></p><div class="library-actions"><button class="button ghost" value="cancel" type="submit">取消</button><button id="quality-save" class="button primary" type="button">保存</button></div></form>';
  document.body.append(dialog); dialog.showModal();
  $$('[data-personal-snapshot]',dialog).forEach(b=>b.addEventListener('click',()=>openQualityDialog(null,personalSnapshots.find(i=>i.entry_id===b.dataset.personalSnapshot))));
  const updateDestination = () => {
    const team = $('input[name="quality-destination"]:checked', dialog)?.value === "team";
    $("#submission-note-field", dialog)?.classList.toggle("hidden", !team);
    $("#quality-save", dialog).textContent = item ? "保存调整" : team ? "提交管理员审核" : "保存个人标记";
  };
  $$('input[name="quality-destination"]', dialog).forEach(r => r.addEventListener("change", updateDestination)); updateDestination();
  $("#quality-save").addEventListener("click", async () => {
    const button = $("#quality-save"); button.disabled = true;
    const qualityLabels = $$('input[name="quality-label"]:checked', dialog).map(x => x.value);
    const team = !item && $('input[name="quality-destination"]:checked', dialog)?.value === "team";
    const body = {video_type: $("#quality-video-type").value, quality_labels: qualityLabels, destination: item ? (item.scope?.startsWith("personal:") ? "personal" : "team") : team ? "team" : "personal", submission_note: $("#submission-note", dialog)?.value || ""};
    const url = item ? "/api/v1/library/" + encodeURIComponent(item.entry_id) : "/api/v1/library/history";
    if (!item) Object.assign(body, {owner_username: task.ownerUsername || currentUser.username, conversation_id: task.conversationId, content_sha256: hash});
    try {
      const result = await request(url, {method: item ? "PATCH" : "POST", body: JSON.stringify(body)});
      if (!result.response.ok) throw new Error(result.body.message || result.body.detail || "保存失败");
      if (!team && task) {
        task.liked = qualityLabels.length > 0;
      }
      if (task && !team) { task.libraryLabels = qualityLabels; renderResult(); }
      dialog.close(); showToast(team ? (result.body.duplicate ? "此版本已提交，可在提交记录查看状态" : "已提交，审核通过后供团队参考") : qualityLabels.length ? "已保存参考标记" : "已撤回参考资格");
      if (item) await loadLibrary();
    } catch (error) { $("#quality-save-state").textContent = error.message + "，请重试。"; }
    finally { button.disabled = false; }
  });
}
