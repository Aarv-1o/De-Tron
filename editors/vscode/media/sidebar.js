// The panel's page: draws what it's sent (status, findings, agent) and sends back what's clicked.
const vscode = acquireVsCodeApi();
const app = document.getElementById("app");
const PARTS = [["security", "Security", "error"], ["breaks", "Will break", "warning"], ["database", "Database", "warning"], ["cleanup", "Clean-up", "info"]];
const LIVE_MS = 90_000; // an agent that edited within this is "working now"
let status;
let data;
let agent;
let lastDone; // edits since the check-in at the last draw: the newest tick animates only when it changes
const opened = new Map(); // groups the person opened or closed: kept across refreshes

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Backticks in plain words become code (after escaping, so nothing in them is HTML).
const words = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ago(time) {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${plural(m, "minute")} ago` : `${plural(Math.round(m / 60), "hour")} ago`;
}

// ---- Findings ----

function place(f) {
  const i = f.file.lastIndexOf("/");
  return `<span class="file">${esc(f.file.slice(i + 1))}:${f.line}</span>${i > 0 ? `<span class="dir">${esc(f.file.slice(0, i))}</span>` : ""}`;
}

function item(f) {
  const more = [f.does, f.replacedBy].filter(Boolean);
  return `<div class="item" tabindex="0" data-open="${esc(f.file)}" data-line="${f.line}" title="${esc(f.why)}">
    <i class="dot ${f.severity}"></i>
    <div class="body">
      <div class="title">${esc(f.title)}</div>
      ${more.length ? `<div class="does">${more.map(words).join(" ")}</div>` : ""}
      <div class="where">${place(f)}<button class="fix" data-fix="${esc(f.id)}" title="Copy what an agent needs to fix this">Copy fix</button></div>
    </div>
  </div>`;
}

function note() {
  if (!data) return "";
  if ((status?.show ?? data.show) === "all") return "Everything in the repo.";
  if (data.noChanges) return `Can't tell what changed (${esc(data.noChanges)}), so this is everything. Open the repo's own folder to see only your changes.`;
  return `What this branch or your uncommitted work added.${data.older ? ` ${plural(data.older, "older finding")} hidden.` : ""}`;
}

function findings() {
  const show = status?.show ?? data?.show ?? "changes";
  const items = data?.items ?? [];
  const hotspots = items.filter((f) => f.rule === "hotspot");
  const of = (part) => items.filter((f) => f.part === part && f.rule !== "hotspot");
  const found = PARTS.filter(([part]) => of(part).length);
  const empty = PARTS.filter((p) => !found.includes(p)).map(([, name]) => name.toLowerCase());
  const counts = PARTS.map(([part, name, tone]) => `<button class="count ${of(part).length ? tone : "zero"}" data-jump="${part}"><b>${of(part).length}</b><span>${esc(name)}</span></button>`).join("");
  const groups = found.map(([part, name]) => `<details id="${part}" ${part !== "cleanup" || found.length === 1 ? "open" : ""}><summary>${esc(name)}<span class="n">${of(part).length}</span></summary>${of(part).map(item).join("")}</details>`).join("");
  const done = data && !status?.scanning;
  return `<section class="findings">
    <header><h2>Findings</h2>
      <div class="seg" role="group" aria-label="What to show">
        <button data-act="toggleShow" aria-pressed="${show === "changes"}" ${show === "changes" ? "disabled" : ""}>Your changes</button>
        <button data-act="toggleShow" aria-pressed="${show === "all"}" ${show === "all" ? "disabled" : ""}>Whole repo</button>
      </div>
    </header>
    <div class="counts ${status?.scanning ? "busy" : ""}">${counts}</div>
    <p class="note">${note()}</p>
    ${done && !found.length ? `<div class="clear">Nothing to fix here.${show === "changes" && data.older ? ` <a data-act="toggleShow">See ${plural(data.older, "older finding")}</a>` : ""}</div>` : groups}
    ${found.length && empty.length ? `<p class="quiet">No ${empty.join(", ").replace(/, ([^,]*)$/, " or $1")} issues.</p>` : ""}
    ${hotspots.length ? `<details id="hotspots"><summary>Hotspots<span class="n">${hotspots.length}</span></summary><p class="quiet">Files that change often and are complex: change them in small steps and test after each.</p>${hotspots.map((h) => `<div class="item" tabindex="0" data-open="${esc(h.file)}" data-line="1"><i class="dot"></i><div class="body"><div class="where">${place({ ...h, line: 1 }).replace(":1<", "<")}</div><div class="does">${esc(h.title)}</div></div></div>`).join("")}</details>` : ""}
    <div class="row-links">
      <label><input type="checkbox" data-act="toggleHints" ${data?.hints ? "checked" : ""}> Show hints</label>
      <a data-act="copyReport">Copy report for agent</a>
    </div>
  </section>`;
}

// ---- Scanning ----

// Ten ticks for ten edits: filled ones are edits since the last check-in.
function checkInMeter() {
  if (!agent || agent.hooks !== "connected") return `<p class="quiet">Connect your agent below to see when it checks in.</p>`;
  if (!agent.live) return `<p class="quiet">Your agent checks in every 10 edits. Waiting for its first edit.</p>`;
  const { untilCheckIn, checkInEvery } = agent.live;
  const done = checkInEvery - untilCheckIn;
  const fresh = lastDone !== undefined && done !== lastDone;
  lastDone = done;
  const ticks = Array.from({ length: checkInEvery }, (_, i) => `<i class="${i < done ? "on" : ""}${i === done - 1 && fresh ? " new" : ""}"></i>`).join("");
  return `<div class="meter" role="img" aria-label="${done} of ${checkInEvery} edits until the agent's next check-in"><div class="ticks">${ticks}</div>
    <p>Agent check-in in <b>${plural(untilCheckIn, "edit")}</b></p></div>`;
}

function scanning() {
  const busy = !status || status.scanning;
  const line = status?.error
    ? `<span class="bad">Scan failed: ${esc(status.error)}</span>`
    : busy ? "Checking your code…" : `Up to date, checked ${status.lastScanAt ? ago(status.lastScanAt) : "just now"}`;
  return `<section class="scanning ${busy ? "busy" : ""}">
    <h2>Scanning</h2>
    <p class="state"><i class="dot ${status?.error ? "error" : busy ? "busy" : "ok"}"></i>${line}</p>
    <button class="primary wide" data-act="rescan" ${busy ? "disabled" : ""}>${busy ? "Scanning…" : "Scan your repo"}</button>
    <label class="switch"><input type="checkbox" role="switch" data-act="toggleAuto" ${status?.autoScan !== false ? "checked" : ""}><span class="track"></span>
      <span>Check automatically when files change</span></label>
    ${checkInMeter()}
  </section>`;
}

// ---- Your agent ----

function yourAgent() {
  if (!agent) return `<section class="agent"><h2>Your agent</h2><p class="quiet">Looking…</p></section>`;
  const working = agent.live && Date.now() - agent.live.lastEditAt < LIVE_MS;
  const state = agent.hooks === "connected" ? (working ? ["live", "Working now"] : ["ok", "Connected"]) : agent.hooks === "stale" ? ["warn", "Needs reconnecting"] : ["off", "Not connected"];
  const task = agent.live ? `<p class="task">${working ? "This task" : "Last task"}: ${plural(agent.live.edits, "edit")}, ${agent.live.added ? `<b>${plural(agent.live.added, "problem")} added</b>` : "no problems added"}${working ? "" : `, ${ago(agent.live.lastEditAt)}`}.</p>` : "";
  const mode = agent.mode;
  return `<section class="agent">
    <h2>Your agent</h2>
    <div class="who"><span class="name">Claude Code</span><span class="pill ${state[0]}"><i></i>${state[1]}</span></div>
    ${agent.hooks === "connected" ? task : `<p class="quiet">${agent.hooks === "stale" ? "The agent's hooks point to an old copy of Detron, which moves when the extension updates." : "Detron tells your agent about problems right after each edit, and checks in every 10 edits."}</p>
      <button class="primary wide" data-act="connectAgent">${agent.hooks === "stale" ? "Reconnect Claude Code" : "Connect Claude Code"}</button>`}
    <div class="mode">
      <div class="seg" role="group" aria-label="How strict">
        <button data-mode="suggest" aria-pressed="${mode === "suggest"}" ${mode === "suggest" ? "disabled" : ""}>Suggest</button>
        <button data-mode="block" aria-pressed="${mode === "block"}" ${mode === "block" ? "disabled" : ""}>Block</button>
      </div>
      <p class="quiet">${mode === "block" ? "Problems are sent back as errors, and a task can't finish while it has added security or crash problems." : "Detron tells the agent, and never stops it."}</p>
    </div>
    <p class="quiet small">Cursor and Copilot CLI use the same connection.</p>
  </section>`;
}

function render() {
  const scroll = window.scrollY;
  // detron-ignore xss: every value is escaped by esc() or words() above, and the panel's CSP runs only Detron's own script
  app.innerHTML = findings() + scanning() + yourAgent();
  for (const [id, open] of opened) {
    const group = document.getElementById(id);
    if (group) group.open = open;
  }
  window.scrollTo(0, scroll);
}
document.addEventListener("toggle", (e) => {
  if (e.target.id) opened.set(e.target.id, e.target.open);
}, true);

document.addEventListener("click", (e) => {
  const fix = e.target.closest("[data-fix]");
  if (fix) return vscode.postMessage({ type: "copyFix", id: fix.dataset.fix });
  const mode = e.target.closest("[data-mode]");
  if (mode) return vscode.postMessage({ type: "setMode", mode: mode.dataset.mode });
  const jump = e.target.closest("[data-jump]");
  if (jump) {
    const group = document.getElementById(jump.dataset.jump);
    if (group) (group.open = true), group.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act && act.tagName !== "INPUT") return vscode.postMessage({ type: act.dataset.act });
  const open = e.target.closest("[data-open]");
  if (open) vscode.postMessage({ type: "open", file: open.dataset.open, line: Number(open.dataset.line) });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches(".item")) e.target.click();
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.act === "toggleHints" || e.target.dataset.act === "toggleAuto") vscode.postMessage({ type: e.target.dataset.act });
});
window.addEventListener("message", ({ data: m }) => {
  if (m.type === "status") status = m.status;
  if (m.type === "findings") data = m.data;
  if (m.type === "agent") agent = m.info;
  render();
});
render();
vscode.postMessage({ type: "ready" });
