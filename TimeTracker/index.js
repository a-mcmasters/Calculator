// Time Tracker — all data is stored in the browser's localStorage.

const STORAGE_KEY = "timetracker.entries";
const RUNNING_KEY = "timetracker.running";
const DAY_MS = 86400000;
const PALETTE = ["#00dbff", "#20d888", "#ff6bff", "#ff6500", "#9b98ff", "#fef21c", "#ff93db", "#39edf7"];

// ---------- storage ----------
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep working in memory */
  }
}

let entries = load(STORAGE_KEY, []); // [{id, task, category, start, end}] (ms timestamps)
let running = load(RUNNING_KEY, null); // {task, category, start}
let tickHandle = null;
let visibleDays = 14;

const persist = () => save(STORAGE_KEY, entries);

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
function startOfWeek(t) {
  // Monday as the first day of the week
  const d = new Date(startOfDay(t));
  const day = (d.getDay() + 6) % 7;
  return addDays(d.getTime(), -day);
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtShort(ms) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtHM(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toDateInput(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromInputs(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function colorFor(category) {
  if (!category) return "#8b91a1";
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// All entries plus the running session (as a virtual entry ending now).
function allSpans() {
  const list = entries.slice();
  if (running) list.push({ ...running, end: Date.now(), id: "__running" });
  return list;
}

// Time of a span that falls within [from, to), splitting across midnight correctly.
function overlap(e, from, to) {
  return Math.max(0, Math.min(e.end, to) - Math.max(e.start, from));
}
function totalBetween(from, to, spans = allSpans()) {
  return spans.reduce((sum, e) => sum + overlap(e, from, to), 0);
}

// ---------- timer ----------
function startTimer() {
  const task = $("task-input").value.trim() || "Untitled";
  const category = $("category-input").value.trim();
  running = { task, category, start: Date.now() };
  save(RUNNING_KEY, running);
  syncTimerUI();
  render();
}

function stopTimer() {
  if (!running) return;
  const end = Date.now();
  if (end - running.start >= 1000) {
    entries.push({ id: uid(), task: running.task, category: running.category, start: running.start, end });
    persist();
  }
  running = null;
  save(RUNNING_KEY, null);
  $("task-input").value = "";
  syncTimerUI();
  render();
}

function tick() {
  if (!running) return;
  const elapsed = Date.now() - running.start;
  $("timer-display").textContent = fmtClock(elapsed);
  document.title = `⏱ ${fmtClock(elapsed)} · ${running.task}`;
}

function syncTimerUI() {
  const btn = $("timer-btn");
  const card = document.querySelector(".timer-card");
  clearInterval(tickHandle);
  if (running) {
    btn.textContent = "Stop";
    btn.className = "btn stop";
    card.classList.add("running");
    $("task-input").value = running.task;
    $("category-input").value = running.category;
    tick();
    tickHandle = setInterval(() => {
      tick();
      // refresh stats every 30s while running
      if (Math.floor((Date.now() - running.start) / 1000) % 30 === 0) render();
    }, 1000);
  } else {
    btn.textContent = "Start";
    btn.className = "btn start";
    card.classList.remove("running");
    $("timer-display").textContent = "00:00:00";
    document.title = "Time Tracker";
  }
}

// ---------- rendering ----------
function renderStats() {
  const now = Date.now();
  const today = startOfDay(now);
  const spans = allSpans();

  $("stat-today").textContent = fmtShort(totalBetween(today, addDays(today, 1), spans));
  $("stat-week").textContent = fmtShort(totalBetween(startOfWeek(now), addDays(startOfWeek(now), 7), spans));
  $("stat-avg").textContent = fmtShort(totalBetween(addDays(today, -6), addDays(today, 1), spans) / 7);

  // Streak: consecutive days with tracked time, ending today (or yesterday if today is empty).
  let streak = 0;
  let day = today;
  if (totalBetween(day, addDays(day, 1), spans) === 0) day = addDays(day, -1);
  while (totalBetween(day, addDays(day, 1), spans) > 0) {
    streak++;
    day = addDays(day, -1);
  }
  $("stat-streak").textContent = `${streak} day${streak === 1 ? "" : "s"}`;
}

function renderWeekChart() {
  const today = startOfDay(Date.now());
  const spans = allSpans();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ d, total: totalBetween(d, addDays(d, 1), spans) });
  }
  const max = Math.max(...days.map((x) => x.total), 3600000);
  $("week-chart").innerHTML = days
    .map(({ d, total }) => {
      const label = new Date(d).toLocaleDateString(undefined, { weekday: "short" });
      const pct = (total / max) * 100;
      return `<div class="bar-col${d === today ? " today" : ""}" title="${fmtShort(total)}">
        <span class="bar-val">${total ? fmtShort(total) : ""}</span>
        <div class="bar" style="height:${pct}%"></div>
        <span class="bar-label">${label}</span>
      </div>`;
    })
    .join("");
}

function renderBreakdown() {
  const from = startOfWeek(Date.now());
  const to = addDays(from, 7);
  const totals = new Map();
  for (const e of allSpans()) {
    const t = overlap(e, from, to);
    if (!t) continue;
    const key = e.category || "Uncategorized";
    totals.set(key, (totals.get(key) || 0) + t);
  }
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((s, [, v]) => s + v, 0);
  $("category-breakdown").innerHTML = sorted.length
    ? sorted
        .map(([cat, t]) => {
          const color = colorFor(cat === "Uncategorized" ? "" : cat);
          return `<li><span>${escapeHtml(cat)}</span><span>${fmtShort(t)} · ${Math.round((t / sum) * 100)}%</span>
            <div class="track"><div class="fill" style="width:${(t / sum) * 100}%;background:${color}"></div></div></li>`;
        })
        .join("")
    : `<li class="muted">Nothing tracked this week yet.</li>`;
}

function renderHeatmap() {
  const today = startOfDay(Date.now());
  const start = addDays(startOfWeek(today), -11 * 7);
  const spans = allSpans();
  const cells = [];
  for (let d = start; d < addDays(startOfWeek(today), 7); d = addDays(d, 1)) {
    if (d > today) {
      cells.push(`<div class="heat-cell future"></div>`);
      continue;
    }
    const t = totalBetween(d, addDays(d, 1), spans);
    const h = t / 3600000;
    const level = t === 0 ? 0 : h < 1 ? 1 : h < 2 ? 2 : h < 4 ? 3 : 4;
    const label = new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    cells.push(`<div class="heat-cell" data-l="${level}" title="${label}: ${fmtShort(t)}"></div>`);
  }
  $("heatmap").innerHTML = cells.join("");
}

function renderHistory() {
  const q = $("filter-input").value.trim().toLowerCase();
  const list = entries
    .filter((e) => !q || e.task.toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q))
    .sort((a, b) => b.start - a.start);

  const groups = new Map();
  for (const e of list) {
    const key = startOfDay(e.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const today = startOfDay(Date.now());
  const html = [];
  let shown = 0;
  for (const [day, items] of groups) {
    if (shown++ >= visibleDays) break;
    const total = items.reduce((s, e) => s + (e.end - e.start), 0);
    const label =
      day === today
        ? "Today"
        : day === addDays(today, -1)
        ? "Yesterday"
        : new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    html.push(`<div class="day-group"><div class="day-head"><span>${label}</span><span>${fmtShort(total)}</span></div>`);
    for (const e of items) {
      const cat = e.category
        ? `<span class="entry-cat" style="background:${colorFor(e.category)}">${escapeHtml(e.category)}</span>`
        : "";
      html.push(`<div class="entry" data-id="${e.id}">
        <div class="entry-task">${escapeHtml(e.task)}${cat}</div>
        <span class="entry-time">${fmtHM(e.start)} – ${fmtHM(e.end)}</span>
        <span class="entry-dur">${fmtClock(e.end - e.start)}</span>
        <div class="entry-actions">
          <button class="icon-btn" data-act="resume" title="Continue this task">▶</button>
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="delete" title="Delete">✕</button>
        </div>
      </div>`);
    }
    html.push(`</div>`);
  }
  if (groups.size > visibleDays) html.push(`<button id="more-btn" class="btn ghost more">Show more (${groups.size - visibleDays} more days)</button>`);
  $("history").innerHTML = html.join("");
  $("empty").style.display = entries.length ? "none" : "";
}

function renderCategories() {
  const cats = [...new Set(entries.map((e) => e.category).filter(Boolean))].sort();
  $("category-list").innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join("");
}

function render() {
  renderStats();
  renderWeekChart();
  renderBreakdown();
  renderHeatmap();
  renderHistory();
  renderCategories();
}

// ---------- editing ----------
let editingId = null;

function openEdit(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $("edit-task").value = e.task;
  $("edit-category").value = e.category || "";
  $("edit-date").value = toDateInput(e.start);
  $("edit-start").value = fmtHM(e.start);
  $("edit-end").value = fmtHM(e.end);
  $("edit-dialog").showModal();
}

// Build a span from date + start/end times; an end before the start rolls over to the next day.
function spanFromInputs(date, startTime, endTime) {
  const start = fromInputs(date, startTime);
  let end = fromInputs(date, endTime);
  if (end <= start) end = addDays(end, 1);
  return { start, end };
}

// ---------- export ----------
function exportCsv() {
  const rows = [["task", "category", "start", "end", "duration_minutes"]];
  for (const e of [...entries].sort((a, b) => a.start - b.start)) {
    rows.push([e.task, e.category || "", new Date(e.start).toISOString(), new Date(e.end).toISOString(), Math.round((e.end - e.start) / 60000)]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `time-tracker-${toDateInput(Date.now())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- events ----------
$("timer-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  running ? stopTimer() : startTimer();
});

$("manual-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const { start, end } = spanFromInputs($("manual-date").value, $("manual-start").value, $("manual-end").value);
  entries.push({ id: uid(), task: $("manual-task").value.trim(), category: $("manual-category").value.trim(), start, end });
  persist();
  $("manual-task").value = "";
  render();
});

$("history").addEventListener("click", (ev) => {
  if (ev.target.id === "more-btn") {
    visibleDays += 14;
    renderHistory();
    return;
  }
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".entry").dataset.id;
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  if (btn.dataset.act === "delete") {
    if (confirm(`Delete "${e.task}"?`)) {
      entries = entries.filter((x) => x.id !== id);
      persist();
      render();
    }
  } else if (btn.dataset.act === "edit") {
    openEdit(id);
  } else if (btn.dataset.act === "resume") {
    if (running) stopTimer();
    $("task-input").value = e.task;
    $("category-input").value = e.category || "";
    startTimer();
  }
});

$("edit-form").addEventListener("submit", () => {
  const e = entries.find((x) => x.id === editingId);
  if (!e) return;
  const { start, end } = spanFromInputs($("edit-date").value, $("edit-start").value, $("edit-end").value);
  Object.assign(e, { task: $("edit-task").value.trim(), category: $("edit-category").value.trim(), start, end });
  persist();
  render();
});
$("edit-cancel").addEventListener("click", () => $("edit-dialog").close());

$("filter-input").addEventListener("input", renderHistory);
$("export-btn").addEventListener("click", exportCsv);

// Keep tabs in sync if the tracker is open in more than one window.
window.addEventListener("storage", (ev) => {
  if (ev.key === STORAGE_KEY) entries = load(STORAGE_KEY, []);
  if (ev.key === RUNNING_KEY) {
    running = load(RUNNING_KEY, null);
    syncTimerUI();
  }
  render();
});

// ---------- init ----------
$("manual-date").value = toDateInput(Date.now());
syncTimerUI();
render();
