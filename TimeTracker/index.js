// Time Tracker — projects, tags, a pausable timer, history and statistics.
// Everything is stored in this browser's localStorage.

const STORE_KEY = "timetracker.v2";
const DAY_MS = 86400000;
const COLORS = ["#e53935", "#ff7a1a", "#ffd60a", "#2bd52b", "#1ec8a0", "#1ea7ff", "#5b6cff", "#a35bff", "#ff5bd1", "#ff5577", "#9e9e9e"];

// Tags come in two kinds: "activity" tags (what you're doing) are listed first and
// lead the auto-filled task name; "content" tags (what you're doing it with) follow.
const DEFAULT_TAGS = [
  ["Watching", "#5b6cff", "activity"], ["Listening", "#1ea7ff", "activity"], ["Reading", "#2bd52b", "activity"],
  ["Mining", "#e53935", "activity"], ["OCR Mining", "#ff5bd1", "activity"],
  ["YouTube", "#e53935", "content"], ["Anime", "#ff5577", "content"], ["Podcast", "#1ec8a0", "content"],
  ["Audiobook", "#ff7a1a", "content"], ["Book", "#ffd60a", "content"], ["Manga", "#a35bff", "content"],
];
const ACTIVITY_NAMES = new Set(DEFAULT_TAGS.filter((t) => t[2] === "activity").map((t) => t[0].toLowerCase()));

// ---------- state ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function freshState() {
  const projectId = uid();
  return {
    projects: [{ id: projectId, name: "Learning Japanese", color: "#e53935" }],
    tags: DEFAULT_TAGS.map(([name, color, kind]) => ({ id: uid(), projectId, name, color, kind })),
    entries: [], // {id, projectId, title, tagIds, start, end, pausedMs}
    running: null, // {projectId, title, tagIds, start, pausedMs, pausedAt}
    currentProjectId: projectId,
    draftTagIds: [],
  };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.projects) && s.projects.length) {
      // Older saves have no tag kinds: treat the known activity words as activities.
      for (const t of s.tags) if (!t.kind) t.kind = ACTIVITY_NAMES.has(t.name.toLowerCase()) ? "activity" : "content";
      return s;
    }
  } catch { /* fall through */ }
  return freshState();
}

let state = loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

let activeTab = "timer";
let visibleDays = 14;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const project = () => state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0];
const isActivity = (t) => t.kind === "activity";
// Activities first, then content; otherwise keep the order the tags were created in.
const byKind = (a, b) => isActivity(b) - isActivity(a);
const projectTags = (pid = state.currentProjectId) => state.tags.filter((t) => t.projectId === pid).sort(byKind);
const tagById = (id) => state.tags.find((t) => t.id === id);
const projectEntries = (pid = state.currentProjectId) => state.entries.filter((e) => e.projectId === pid);

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }

// Active (non-paused) duration of an entry.
const activeMs = (e) => Math.max(0, e.end - e.start - (e.pausedMs || 0));

function runningElapsed(r = state.running) {
  if (!r) return 0;
  const now = r.pausedAt || Date.now();
  return Math.max(0, now - r.start - r.pausedMs);
}

// "1 h 46 min", "40 min 4 sec", "17 sec"
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${sec} sec`;
  return `${sec} sec`;
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const fmtHM = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = (t) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const fmtShortDate = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const toDateInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function fromInputs(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

const pillsHtml = (tagIds) =>
  (tagIds || []).map(tagById).filter(Boolean).sort(byKind)
    .map((t) => `<span class="pill" style="--c:${t.color}">${esc(t.name)}</span>`).join("");

// ---------- auto-filled task names ----------
// "Watching" + "YouTube" -> "Watching YouTube"; "Listening" + "Audiobook" -> "Listening to Audiobook";
// "Watching" + "Mining" + "Anime" -> "Watching & Mining Anime".
const joinNames = (names) =>
  names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];

function autoTitle(tagIds) {
  const tags = tagIds.map(tagById).filter(Boolean);
  const acts = tags.filter(isActivity).map((t) => t.name);
  const things = tags.filter((t) => !isActivity(t)).map((t) => t.name);
  if (!acts.length) return joinNames(things);
  if (!things.length) return joinNames(acts);
  const lastAct = acts[acts.length - 1].toLowerCase();
  const joiner = lastAct === "listening" ? " to " : " ";
  return joinNames(acts) + joiner + joinNames(things);
}

// Fill a title box from the chosen tags, but only if it is empty or still holds
// the previous automatic name, so text you typed yourself is never overwritten.
function applyAutoTitle(input, prevTagIds, nextTagIds) {
  const current = input.value.trim();
  if (current === "" || current === autoTitle(prevTagIds)) input.value = autoTitle(nextTagIds);
}

// ---------- timer ----------
function startTimer(title, tagIds) {
  if (state.running) stopTimer();
  state.running = {
    projectId: state.currentProjectId,
    title: title.trim() || "Untitled",
    tagIds: [...tagIds],
    start: Date.now(),
    pausedMs: 0,
    pausedAt: null,
  };
  save();
  render();
}

function togglePause() {
  const r = state.running;
  if (!r) return;
  if (r.pausedAt) { r.pausedMs += Date.now() - r.pausedAt; r.pausedAt = null; }
  else r.pausedAt = Date.now();
  save();
  renderRunning();
}

function stopTimer() {
  const r = state.running;
  if (!r) return;
  const end = r.pausedAt || Date.now();
  if (end - r.start - r.pausedMs >= 1000) {
    state.entries.push({ id: uid(), projectId: r.projectId, title: r.title, tagIds: r.tagIds, start: r.start, end, pausedMs: r.pausedMs });
  }
  state.running = null;
  $("title-input").value = "";
  save();
  render();
}

function tick() {
  const r = state.running;
  if (!r) { document.title = "Time Tracker"; return; }
  const txt = fmtClock(runningElapsed());
  $("running-time").textContent = txt;
  $("mini-time").textContent = txt;
  document.title = `${r.pausedAt ? "❚❚" : "▶"} ${txt} · ${r.title}`;
}
setInterval(tick, 1000);

// ---------- rendering: project bar ----------
function renderProjectBar() {
  const p = project();
  $("project-dot").style.background = p.color;
  document.documentElement.style.setProperty("--accent", p.color); // theme stats in the project's colour
  $("project-name").textContent = p.name;
  $("project-menu").innerHTML = state.projects
    .map((x) => `<button data-pid="${x.id}" class="${x.id === p.id ? "current" : ""}"><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</button>`)
    .join("");
}

// ---------- rendering: timer tab ----------
function renderTagPicker() {
  const selected = new Set(state.draftTagIds);
  const tags = projectTags();
  const firstContent = tags.findIndex((t) => !isActivity(t));
  $("tag-picker").innerHTML =
    tags.map((t, i) => (i === firstContent && i > 0 ? `<span class="tag-break"></span>` : "") + `
      <span class="chip ${selected.has(t.id) ? "on" : ""}" style="--c:${t.color}">
        <button type="button" class="chip-main" data-tag="${t.id}">${esc(t.name)}</button>
        <button type="button" class="chip-edit" data-edit-tag="${t.id}" title="Edit tag">✎</button>
      </span>`).join("") +
    `<button type="button" id="new-tag" class="link-btn">+ New tag</button>`;
}

function renderRunning() {
  const r = state.running;
  const showRunning = !!r && r.projectId === state.currentProjectId;
  $("start-form").classList.toggle("hidden", showRunning);
  $("running").classList.toggle("hidden", !showRunning);
  $("entry-card").classList.toggle("is-running", showRunning);
  if (r) {
    $("running-title").textContent = r.title;
    $("running-tags").innerHTML = pillsHtml(r.tagIds);
    $("running-clock").classList.toggle("paused", !!r.pausedAt);
    $("pause-btn").textContent = r.pausedAt ? "▶" : "❚❚";
    $("pause-btn").title = r.pausedAt ? "Resume" : "Pause";
    $("mini-title").textContent = r.title;
  }
  // Mini timer: visible when running and the full timer isn't on screen.
  $("mini-timer").classList.toggle("hidden", !r || (activeTab === "timer" && showRunning));
  tick();
}

function renderHistory() {
  const list = projectEntries().sort((a, b) => b.start - a.start);
  const groups = new Map();
  for (const e of list) {
    const k = startOfDay(e.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const html = [];
  let n = 0;
  for (const [day, items] of groups) {
    if (n++ >= visibleDays) break;
    const total = items.reduce((s, e) => s + activeMs(e), 0);
    html.push(`<div class="day"><div class="day-head"><span>${fmtDate(day)}</span><span class="day-total">${fmtDur(total)}</span></div><div class="day-list">`);
    for (const e of items) {
      const paused = e.pausedMs >= 1000 ? `<span class="entry-paused">| Paused time: ${fmtDur(e.pausedMs)}</span>` : "";
      html.push(`
        <div class="entry" data-id="${e.id}">
          <div class="entry-main">
            <div class="entry-title">${esc(e.title)}</div>
            <div class="entry-meta">
              <span class="entry-dur">${fmtDur(activeMs(e))}</span>
              <span class="entry-range">${fmtHM(e.start)} – ${fmtHM(e.end)}</span>${paused}
              ${pillsHtml(e.tagIds)}
            </div>
          </div>
          <div class="entry-actions">
            <button class="icon-btn" data-act="continue" title="Continue">▶</button>
            <button class="icon-btn" data-act="edit" title="Edit">✎</button>
            <button class="icon-btn" data-act="delete" title="Delete">✕</button>
          </div>
        </div>`);
    }
    html.push(`</div></div>`);
  }
  if (groups.size > visibleDays) html.push(`<button id="more-btn" class="btn btn-ghost more-btn">Show older days</button>`);
  $("history").innerHTML = html.join("");
  $("history-empty").classList.toggle("hidden", list.length > 0);
}

// ---------- rendering: statistics tab ----------
function projectSpans() {
  const spans = projectEntries().map((e) => ({ ...e, ms: activeMs(e) }));
  const r = state.running;
  if (r && r.projectId === state.currentProjectId) spans.push({ ...r, end: Date.now(), ms: runningElapsed(r) });
  return spans;
}

function renderStats() {
  const spans = projectSpans();
  const total = spans.reduce((s, e) => s + e.ms, 0);
  $("s-total").textContent = fmtDur(total);
  $("s-sessions").textContent = spans.length;

  const longest = spans.reduce((a, b) => (b.ms > (a?.ms || 0) ? b : a), null);
  $("s-longest").textContent = longest ? fmtDur(longest.ms) : "—";
  $("s-longest-sub").textContent = longest ? longest.title : "";

  // Per-day totals (sessions are attributed to the day they started)
  const perDay = new Map();
  for (const e of spans) { const k = startOfDay(e.start); perDay.set(k, (perDay.get(k) || 0) + e.ms); }
  let record = null;
  for (const [day, ms] of perDay) if (!record || ms > record.ms) record = { day, ms };
  $("s-record").textContent = record ? fmtDur(record.ms) : "—";
  $("s-record-sub").textContent = record ? fmtShortDate(record.day) + ", " + new Date(record.day).getFullYear() : "";

  renderHeatmap(perDay);

  // Last 30 days chart
  const today = startOfDay(Date.now());
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = addDays(today, -i); days.push({ d, ms: perDay.get(d) || 0 }); }
  const max = Math.max(...days.map((x) => x.ms), 1);
  $("chart").innerHTML = days
    .map(({ d, ms }) => `<div class="chart-col" data-tip="${fmtShortDate(d)} — ${ms ? fmtDur(ms) : "nothing"}"><div class="chart-bar" style="height:${ms ? Math.max(2, (ms / max) * 100) : 0}%"></div></div>`)
    .join("");
  $("chart-from").textContent = fmtShortDate(days[0].d);

  // Time per tag
  const perTag = new Map();
  for (const e of spans) for (const id of e.tagIds || []) perTag.set(id, (perTag.get(id) || 0) + e.ms);
  const rows = projectTags().map((t) => ({ t, ms: perTag.get(t.id) || 0 })).sort((a, b) => b.ms - a.ms);
  const tagMax = Math.max(...rows.map((r) => r.ms), 1);
  $("tag-stats").innerHTML = rows.length
    ? rows.map(({ t, ms }) => `
        <span class="name" style="--c:${t.color}">${esc(t.name)}</span>
        <div class="track"><div class="fill" style="--c:${t.color};width:${(ms / tagMax) * 100}%"></div></div>
        <span class="val">${fmtDur(ms)}</span>`).join("")
    : `<span class="muted">No tags in this project yet.</span>`;
}

// ---------- activity heatmap (GitHub-style calendar) ----------
// Colour levels by time tracked that day.
const HEAT_LEVELS = [30 * 60000, 60 * 60000, 2 * 3600000]; // <30 min, <1 h, <2 h, 2 h+
const heatLevel = (ms) => (!ms ? 0 : ms < HEAT_LEVELS[0] ? 1 : ms < HEAT_LEVELS[1] ? 2 : ms < HEAT_LEVELS[2] ? 3 : 4);
const mondayOf = (t) => addDays(startOfDay(t), -((new Date(t).getDay() + 6) % 7)); // weeks start on Monday
let heatRange = "last"; // "last" = past 12 months, or a year like "2026"

function renderHeatRange(perDay) {
  const years = new Set([new Date().getFullYear()]);
  for (const d of perDay.keys()) years.add(new Date(d).getFullYear());
  const opts = [["last", "Last 12 months"], ...[...years].sort((a, b) => b - a).map((y) => [String(y), String(y)])];
  if (!opts.some(([v]) => v === heatRange)) heatRange = "last";
  $("heat-range").innerHTML = opts.map(([v, l]) => `<option value="${v}" ${v === heatRange ? "selected" : ""}>${l}</option>`).join("");
}

function renderHeatmap(perDay) {
  renderHeatRange(perDay);
  const today = startOfDay(Date.now());
  let from, to; // inclusive day range shown
  if (heatRange === "last") { to = today; from = addDays(addDays(today, 1), -365); }
  else { const y = Number(heatRange); from = new Date(y, 0, 1).getTime(); to = Math.min(new Date(y, 11, 31).getTime(), today); }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const cols = [];
  let lastMonth = -1;
  for (let week = mondayOf(from); week <= to; week = addDays(week, 7)) {
    const cells = [];
    let label = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(week, i);
      if (d < from || d > to) { cells.push(`<i class="out"></i>`); continue; }
      const date = new Date(d);
      if (date.getDate() <= 7 && date.getMonth() !== lastMonth && !label) { label = months[date.getMonth()]; lastMonth = date.getMonth(); }
      const ms = perDay.get(d) || 0;
      const when = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      cells.push(`<i data-l="${heatLevel(ms)}" data-tip="${ms ? fmtDur(ms) : "No time"} on ${when}"${d === today ? ' class="today"' : ""}></i>`);
    }
    cols.push(`<div class="heat-col"><span class="heat-month">${label}</span>${cells.join("")}</div>`);
  }
  $("heatmap").innerHTML = cols.join("");

  // Summary: total, active days, current and longest streak within the range
  let total = 0, active = 0, longest = 0, run = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ms = perDay.get(d) || 0;
    total += ms;
    if (ms) { active++; run++; longest = Math.max(longest, run); } else run = 0;
  }
  let current = 0;
  for (let d = perDay.get(today) ? today : addDays(today, -1); perDay.get(d); d = addDays(d, -1)) current++;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const label = heatRange === "last" ? "in the last 12 months" : `in ${heatRange}`;
  $("heat-summary").innerHTML =
    `<b>${fmtDur(total)}</b> ${label} · ${plural(active, "active day")} · ` +
    (heatRange === "last" ? `current streak <b>${plural(current, "day")}</b> · ` : "") +
    `longest streak <b>${plural(longest, "day")}</b>`;

  // Show the most recent weeks first on narrow screens
  const sc = $("heat-scroll");
  sc.scrollLeft = sc.scrollWidth;
}

function render() {
  renderProjectBar();
  renderTagPicker();
  renderRunning();
  if (activeTab === "timer") renderHistory();
  else renderStats();
}

// ---------- modal ----------
let modalHandlers = null;

function openModal({ title, body, okText = "Save", onOk, onDelete, onOpen }) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = body;
  $("modal-ok").textContent = okText;
  $("modal-delete").classList.toggle("hidden", !onDelete);
  modalHandlers = { onOk, onDelete };
  $("modal").showModal();
  onOpen?.();
  $("modal-body").querySelector("input")?.focus();
}
function closeModal() { $("modal").close(); modalHandlers = null; }

$("modal-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (modalHandlers?.onOk?.() === false) return; // validation failed
  closeModal();
  save();
  render();
});
$("modal-cancel").addEventListener("click", closeModal);
$("modal-delete").addEventListener("click", () => {
  if (modalHandlers?.onDelete?.() === false) return;
  closeModal();
  save();
  render();
});

const swatchHtml = (current) =>
  `<div class="swatches" id="m-swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === current ? "on" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>`;
function wireSwatches() {
  $("m-swatches").addEventListener("click", (ev) => {
    const b = ev.target.closest(".swatch");
    if (!b) return;
    $("m-swatches").querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s === b));
  });
}
const pickedColor = () => $("m-swatches").querySelector(".swatch.on")?.dataset.color || COLORS[0];

function tagToggleHtml(selectedIds, pid) {
  const sel = new Set(selectedIds);
  return `<div class="tag-picker" id="m-tags">${projectTags(pid).map((t) => `
      <span class="chip ${sel.has(t.id) ? "on" : ""}" style="--c:${t.color}"><button type="button" class="chip-main" data-tag="${t.id}" style="padding-right:10px">${esc(t.name)}</button></span>`).join("")}</div>`;
}
function wireTagToggles() {
  $("m-tags").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tag]");
    if (!b) return;
    const prev = pickedTags();
    b.parentElement.classList.toggle("on");
    if ($("m-title")) applyAutoTitle($("m-title"), prev, pickedTags());
  });
}
const pickedTags = () => [...$("m-tags").querySelectorAll(".chip.on [data-tag]")].map((b) => b.dataset.tag);

function editProject(p) {
  openModal({
    title: p ? "Edit project" : "New project",
    okText: p ? "Save" : "Create",
    body: `<label class="field">Name <input id="m-name" class="input" maxlength="60" required value="${esc(p?.name || "")}"></label>
           <div class="field">Color ${swatchHtml(p?.color || COLORS[Math.floor(Math.random() * COLORS.length)])}</div>`,
    onOpen: wireSwatches,
    onOk: () => {
      const name = $("m-name").value.trim();
      if (!name) return false;
      if (p) Object.assign(p, { name, color: pickedColor() });
      else {
        const np = { id: uid(), name, color: pickedColor() };
        state.projects.push(np);
        state.currentProjectId = np.id;
        state.draftTagIds = [];
      }
    },
    onDelete: p && state.projects.length > 1 ? () => {
      if (!confirm(`Delete project "${p.name}" and all of its sessions and tags?`)) return false;
      if (state.running?.projectId === p.id) state.running = null;
      state.projects = state.projects.filter((x) => x.id !== p.id);
      state.entries = state.entries.filter((e) => e.projectId !== p.id);
      state.tags = state.tags.filter((t) => t.projectId !== p.id);
      state.currentProjectId = state.projects[0].id;
      state.draftTagIds = [];
    } : null,
  });
}

function editTag(t) {
  openModal({
    title: t ? "Edit tag" : "New tag",
    okText: t ? "Save" : "Create",
    body: `<label class="field">Name <input id="m-name" class="input" maxlength="40" required value="${esc(t?.name || "")}"></label>
           <div class="field">Type
             <div class="kind-toggle" id="m-kind">
               <label><input type="radio" name="kind" value="activity" ${t?.kind === "activity" ? "checked" : ""}> Activity <span class="muted">(Watching, Listening…) — listed first</span></label>
               <label><input type="radio" name="kind" value="content" ${t?.kind === "activity" ? "" : "checked"}> Content <span class="muted">(YouTube, Audiobook…)</span></label>
             </div>
           </div>
           <div class="field">Color ${swatchHtml(t?.color || COLORS[Math.floor(Math.random() * COLORS.length)])}</div>`,
    onOpen: wireSwatches,
    onOk: () => {
      const name = $("m-name").value.trim();
      if (!name) return false;
      const kind = $("m-kind").querySelector("input:checked").value;
      if (t) Object.assign(t, { name, kind, color: pickedColor() });
      else state.tags.push({ id: uid(), projectId: state.currentProjectId, name, kind, color: pickedColor() });
    },
    onDelete: t ? () => {
      if (!confirm(`Delete tag "${t.name}"? It will be removed from all sessions.`)) return false;
      state.tags = state.tags.filter((x) => x.id !== t.id);
      const strip = (o) => { if (o?.tagIds) o.tagIds = o.tagIds.filter((id) => id !== t.id); };
      state.entries.forEach(strip);
      strip(state.running);
      state.draftTagIds = state.draftTagIds.filter((id) => id !== t.id);
    } : null,
  });
}

// Edit an existing entry, or create one manually when `e` is null.
function editEntry(e) {
  const start = e?.start ?? Date.now() - 3600000;
  const end = e?.end ?? Date.now();
  openModal({
    title: e ? "Edit session" : "Add session",
    okText: e ? "Save" : "Add",
    body: `<label class="field">Title <input id="m-title" class="input" maxlength="120" value="${esc(e?.title || "")}"></label>
           <div class="field">Tags ${tagToggleHtml(e?.tagIds || [], e?.projectId || state.currentProjectId)}</div>
           <label class="field">Date <input id="m-date" class="input" type="date" required value="${toDateInput(start)}"></label>
           <div class="row2">
             <label class="field">Start <input id="m-start" class="input" type="time" required value="${fmtHM(start)}"></label>
             <label class="field">End <input id="m-end" class="input" type="time" required value="${fmtHM(end)}"></label>
           </div>
           <label class="field">Paused (minutes) <input id="m-paused" class="input" type="number" min="0" step="1" value="${Math.round((e?.pausedMs || 0) / 60000)}"></label>`,
    onOpen: wireTagToggles,
    onOk: () => {
      const s = fromInputs($("m-date").value, $("m-start").value);
      let en = fromInputs($("m-date").value, $("m-end").value);
      if (en <= s) en = addDays(en, 1); // crosses midnight
      const pausedMs = Math.min(Math.max(0, Number($("m-paused").value) || 0) * 60000, en - s);
      const data = { title: $("m-title").value.trim() || "Untitled", tagIds: pickedTags(), start: s, end: en, pausedMs };
      if (e) Object.assign(e, data);
      else state.entries.push({ id: uid(), projectId: state.currentProjectId, ...data });
    },
    onDelete: e ? () => { state.entries = state.entries.filter((x) => x.id !== e.id); } : null,
  });
}

function editRunning() {
  const r = state.running;
  if (!r) return;
  openModal({
    title: "Edit running session",
    body: `<label class="field">Title <input id="m-title" class="input" maxlength="120" value="${esc(r.title)}"></label>
           <div class="field">Tags ${tagToggleHtml(r.tagIds, r.projectId)}</div>
           <label class="field">Started at <input id="m-start" class="input" type="time" value="${fmtHM(r.start)}"></label>`,
    onOpen: wireTagToggles,
    onOk: () => {
      r.title = $("m-title").value.trim() || "Untitled";
      r.tagIds = pickedTags();
      let s = fromInputs(toDateInput(r.start), $("m-start").value);
      if (s > Date.now()) s = addDays(s, -1);
      r.start = s;
    },
  });
}

// ---------- CSV ----------
function exportCsv() {
  const p = project();
  const rows = [["title", "tags", "start", "end", "active_minutes", "paused_minutes"]];
  for (const e of projectEntries().sort((a, b) => a.start - b.start)) {
    rows.push([e.title, (e.tagIds || []).map((id) => tagById(id)?.name).filter(Boolean).join("; "),
      new Date(e.start).toISOString(), new Date(e.end).toISOString(),
      Math.round(activeMs(e) / 60000), Math.round((e.pausedMs || 0) / 60000)]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const filename = `${p.name.replace(/\W+/g, "-").toLowerCase()}-${toDateInput(Date.now())}.csv`;
  if (window.AndroidBridge) return window.AndroidBridge.saveFile(filename, csv); // Android app
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- events ----------
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab)));

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("tab-timer").classList.toggle("hidden", tab !== "timer");
  $("tab-stats").classList.toggle("hidden", tab !== "stats");
  render();
}

$("project-select").addEventListener("click", (ev) => {
  ev.stopPropagation();
  $("project-menu").classList.toggle("hidden");
});
$("project-menu").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-pid]");
  if (!b) return;
  state.currentProjectId = b.dataset.pid;
  state.draftTagIds = [];
  visibleDays = 14;
  $("project-menu").classList.add("hidden");
  save();
  render();
});
document.addEventListener("click", () => $("project-menu").classList.add("hidden"));
$("project-edit").addEventListener("click", () => editProject(project()));
$("project-new").addEventListener("click", () => editProject(null));

$("tag-picker").addEventListener("click", (ev) => {
  const edit = ev.target.closest("[data-edit-tag]");
  if (edit) return editTag(tagById(edit.dataset.editTag));
  if (ev.target.id === "new-tag") return editTag(null);
  const b = ev.target.closest("[data-tag]");
  if (!b) return;
  const id = b.dataset.tag;
  const prev = state.draftTagIds;
  state.draftTagIds = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
  applyAutoTitle($("title-input"), prev, state.draftTagIds);
  save();
  renderTagPicker();
});

$("start-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  startTimer($("title-input").value, state.draftTagIds);
});
$("pause-btn").addEventListener("click", togglePause);
$("stop-btn").addEventListener("click", stopTimer);
$("running-edit").addEventListener("click", editRunning);
$("manual-btn").addEventListener("click", () => editEntry(null));
$("export-btn").addEventListener("click", exportCsv);

$("mini-timer").addEventListener("click", () => {
  if (state.running) { state.currentProjectId = state.running.projectId; save(); }
  switchTab("timer");
});

$("history").addEventListener("click", (ev) => {
  if (ev.target.id === "more-btn") { visibleDays += 14; renderHistory(); return; }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const e = state.entries.find((x) => x.id === b.closest(".entry").dataset.id);
  if (!e) return;
  if (b.dataset.act === "continue") startTimer(e.title, e.tagIds || []);
  else if (b.dataset.act === "edit") editEntry(e);
  else if (b.dataset.act === "delete" && confirm(`Delete "${e.title}"?`)) {
    state.entries = state.entries.filter((x) => x.id !== e.id);
    save();
    render();
  }
});

// Chart hover tooltip
$("chart").addEventListener("mousemove", (ev) => {
  const col = ev.target.closest(".chart-col");
  const tip = $("chart-tip");
  if (!col) return tip.classList.add("hidden");
  tip.textContent = col.dataset.tip;
  tip.style.left = `${col.offsetLeft + col.offsetWidth / 2}px`;
  tip.classList.remove("hidden");
});
$("chart").addEventListener("mouseleave", () => $("chart-tip").classList.add("hidden"));

// Heatmap tooltip: hover on desktop, tap on phones
function showHeatTip(ev) {
  const cell = ev.target.closest("i[data-tip]");
  const tip = $("heat-tip");
  if (!cell) return tip.classList.add("hidden");
  const wrap = $("heat-wrap").getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  tip.textContent = cell.dataset.tip;
  const x = Math.min(Math.max(r.left - wrap.left + r.width / 2, 70), wrap.width - 70);
  tip.style.left = `${x}px`;
  tip.style.top = `${r.top - wrap.top - 4}px`;
  tip.classList.remove("hidden");
}
$("heatmap").addEventListener("mousemove", showHeatTip);
$("heatmap").addEventListener("click", showHeatTip);
$("heatmap").addEventListener("mouseleave", () => $("heat-tip").classList.add("hidden"));
$("heat-scroll").addEventListener("scroll", () => $("heat-tip").classList.add("hidden"));
$("heat-range").addEventListener("change", (ev) => { heatRange = ev.target.value; renderStats(); });

// Keep several open tabs in sync.
window.addEventListener("storage", (ev) => {
  if (ev.key !== STORE_KEY) return;
  state = loadState();
  render();
});

// Refresh statistics every 30 s while the timer runs.
setInterval(() => { if (state.running && activeTab === "stats") renderStats(); }, 30000);

// Android back button: close dialogs/menus, then return to the Timer tab. Returns true if handled.
function handleBack() {
  if ($("modal").open) { closeModal(); return true; }
  if (!$("project-menu").classList.contains("hidden")) { $("project-menu").classList.add("hidden"); return true; }
  if (activeTab !== "timer") { switchTab("timer"); return true; }
  return false;
}

save(); // persist the default project/tags on first visit so their ids stay stable
render();
