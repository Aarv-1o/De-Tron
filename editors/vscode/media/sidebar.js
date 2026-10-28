// The panel's page: draws the status and findings it's sent, and sends back what's clicked.
const vscode = acquireVsCodeApi();
const app = document.getElementById("app");
const PARTS = [["security", "Security", "error"], ["breaks", "Will break", "warning"], ["database", "Database", "warning"], ["cleanup", "Clean-up", "info"]];
let status;
let data;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Backticks in plain words become code (after escaping, so nothing in them is HTML).
const words = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summary(items) {
  const busy = !status || status.scanning;
  const chips = PARTS.map(([part, name, tone]) => {
    const n = items.filter((f) => f.part === part && f.rule !== "hotspot").length;
    return `<button class="chip ${n ? tone : "zero"}" data-jump="${part}" title="${esc(name)}"><b>${n}</b> ${esc(name)}</button>`;
  }).join("");
  return `<div class="summary ${busy ? "busy" : ""}">${chips}</div>
    <div class="state">${status?.error ? `<span class="bad">Scan failed: ${esc(status.error)}</span>` : busy ? `<span class="spin"></span> Checking…` : "Up to date"}</div>`;
}

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

function render() {
  const show = status?.show ?? data?.show ?? "changes";
  const items = data?.items ?? [];
  const hotspots = items.filter((f) => f.rule === "hotspot");
  const found = PARTS.filter(([part]) => items.some((f) => f.part === part && f.rule !== "hotspot"));
  const empty = PARTS.filter((p) => !found.includes(p)).map(([, name]) => name.toLowerCase());
  const groups = found.map(([part, name]) => {
    const mine = items.filter((f) => f.part === part && f.rule !== "hotspot");
    return `<details id="${part}" ${part !== "cleanup" || found.length === 1 ? "open" : ""}><summary>${esc(name)}<span class="n">${mine.length}</span></summary>${mine.map(item).join("")}</details>`;
  }).join("");
  const done = data && !status?.scanning;
  // detron-ignore xss: every value is escaped by esc() or words() above, and the panel's CSP runs only Detron's own script
  app.innerHTML = `
    ${summary(items)}
    <div class="seg" role="group" aria-label="What to show">
      <button data-act="toggleShow" aria-pressed="${show === "changes"}" ${show === "changes" ? "disabled" : ""}>Your changes</button>
      <button data-act="toggleShow" aria-pressed="${show === "all"}" ${show === "all" ? "disabled" : ""}>Whole repo</button>
    </div>
    <p class="note">${note()}</p>
    ${done && !found.length ? `<div class="clear"><div class="big">Nothing to fix here</div>${show === "changes" && data.older ? `<a data-act="toggleShow">See ${plural(data.older, "older finding")} in the whole repo</a>` : ""}</div>` : groups}
    ${found.length && empty.length ? `<p class="quiet">No ${empty.join(", ").replace(/, ([^,]*)$/, " or $1")} issues.</p>` : ""}
    ${hotspots.length ? `<details id="hotspots"><summary>Hotspots<span class="n">${hotspots.length}</span></summary><p class="quiet">Files that change often and are complex: make small changes there and test after each.</p>${hotspots.map((h) => `<div class="item" tabindex="0" data-open="${esc(h.file)}" data-line="1"><i class="dot"></i><div class="body"><div class="where">${place({ ...h, line: 1 }).replace(":1<", "<")}</div><div class="does">${esc(h.title)}</div></div></div>`).join("")}</details>` : ""}
    <div class="foot">
      <label><input type="checkbox" data-act="toggleHints" ${data?.hints ? "checked" : ""}> Show hints</label>
      <a data-act="copyReport">Copy report for agent</a>
    </div>`;
}

document.addEventListener("click", (e) => {
  const fix = e.target.closest("[data-fix]");
  if (fix) return vscode.postMessage({ type: "copyFix", id: fix.dataset.fix });
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
  if (e.target.dataset.act === "toggleHints") vscode.postMessage({ type: "toggleHints" });
});
window.addEventListener("message", ({ data: m }) => {
  if (m.type === "status") status = m.status;
  if (m.type === "findings") data = m.data;
  render();
});
render();
vscode.postMessage({ type: "ready" });
