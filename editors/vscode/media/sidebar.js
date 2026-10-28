// The panel's page: draws the status and findings it's sent, and sends back what's clicked.
const vscode = acquireVsCodeApi();
const app = document.getElementById("app");
const PARTS = [["security", "Security"], ["breaks", "Will break"], ["database", "Database"], ["cleanup", "Clean-up"]];
let status;
let data;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Backticks in plain words become code.
const words = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function pill() {
  if (!status) return `<span class="pill">Starting…</span>`;
  if (status.error) return `<span class="pill err">Scan failed</span>`;
  if (status.scanning) return `<span class="pill">Checking…</span>`;
  return `<span class="pill">Up to date</span>`;
}

function item(f) {
  return `<div class="item" data-open="${esc(f.file)}" data-line="${f.line}" title="${esc([f.does, f.replacedBy, f.why].filter(Boolean).join("\n\n").replace(/`/g, ""))}">
    <i class="dot ${f.severity}"></i>
    <div><div class="title">${esc(f.title)}</div>
      ${f.does ? `<div class="does">${words(f.does)}</div>` : ""}
      ${f.replacedBy ? `<div class="does">${words(f.replacedBy)}</div>` : ""}
      <div class="where"><span>\u200e${esc(f.file)}:${f.line}</span><button data-fix="${esc(f.id)}" title="Copy what an agent needs to fix this">Copy fix</button></div>
    </div></div>`;
}

function render() {
  const show = status?.show ?? data?.show ?? "changes";
  const items = data?.items ?? [];
  const hotspots = items.filter((f) => f.rule === "hotspot");
  const groups = PARTS.map(([part, name]) => {
    const mine = items.filter((f) => f.part === part && f.rule !== "hotspot");
    return `<details ${mine.length && part !== "cleanup" ? "open" : ""}><summary>${name}<span class="n">${mine.length || "nothing found"}</span></summary>
      ${mine.length ? mine.map(item).join("") : ""}</details>`;
  }).join("");
  const older = data?.older ? `${data.older} older finding${data.older === 1 ? "" : "s"} from before your changes are hidden.` : "";
  app.innerHTML = `
    <div class="top"><h2>Detron</h2>${pill()}</div>
    <div class="buttons">
      <button class="primary" data-act="rescan">Scan again</button>
      <button class="secondary" data-act="openReport">Full report</button>
    </div>
    <div class="seg" role="group" aria-label="What to show">
      <button data-act="toggleShow" aria-pressed="${show === "changes"}" ${show === "changes" ? "disabled" : ""}>Your changes</button>
      <button data-act="toggleShow" aria-pressed="${show === "all"}" ${show === "all" ? "disabled" : ""}>Whole repo</button>
    </div>
    ${status?.error ? `<p class="note">${esc(status.error)}</p>` : show === "changes" ? `<p class="note">What this branch or your uncommitted work added. ${older}</p>` : `<p class="note">Everything in the repo.</p>`}
    ${groups}
    ${hotspots.length ? `<details><summary>Hotspots<span class="n">${hotspots.length}</span></summary>${hotspots.map((h) => `<div class="item" data-open="${esc(h.file)}" data-line="1"><i class="dot"></i><div><div class="title">${esc(h.file)}</div><div class="does">${esc(h.title)}. Make small changes here and test after each.</div></div></div>`).join("")}</details>` : ""}
    <label><input type="checkbox" data-act="toggleHints" ${data?.hints ? "checked" : ""}> Show hints (less sure)</label>
    <div class="foot"><a data-act="copyReport">Copy report for agent</a><a data-act="settings">Settings</a></div>`;
}

document.addEventListener("click", (e) => {
  const fix = e.target.closest("[data-fix]");
  if (fix) return vscode.postMessage({ type: "copyFix", id: fix.dataset.fix });
  const act = e.target.closest("[data-act]");
  if (act && act.tagName !== "INPUT") return vscode.postMessage({ type: act.dataset.act });
  const open = e.target.closest("[data-open]");
  if (open) vscode.postMessage({ type: "open", file: open.dataset.open, line: Number(open.dataset.line) });
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
