import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

// The Detron panel in the activity bar: scan, switch between your changes and the whole repo,
// findings by part (each opens its line), and the report for a person or an agent.

export interface Status {
  scanning: boolean;
  show: "changes" | "all";
  counts: { security: number; breaks: number; database: number; cleanup: number };
  older: number;
  error?: string;
}

type FromPanel =
  | { type: "ready" | "rescan" | "toggleShow" | "toggleHints" | "copyReport" | "openReport" | "settings" }
  | { type: "open"; file: string; line: number }
  | { type: "copyFix"; id: string };

export class Sidebar implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private status: Status | undefined;

  constructor(private readonly extension: vscode.Uri, private readonly client: () => LanguageClient | undefined) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extension, "media")] };
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extension, "media", "sidebar.js"));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(this.extension, "media", "sidebar.css"));
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}"></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m: FromPanel) => this.handle(m));
  }

  async update(status: Status): Promise<void> {
    this.status = status;
    if (!this.view) return;
    void this.view.webview.postMessage({ type: "status", status });
    if (!status.scanning && !status.error) void this.view.webview.postMessage({ type: "findings", data: await this.client()?.sendRequest("detron/findings", {}) });
  }

  private async handle(m: FromPanel): Promise<void> {
    const client = this.client();
    if (!client) return;
    const command = (name: string) => client.sendRequest("workspace/executeCommand", { command: name, arguments: [] });
    if (m.type === "ready" && this.status) return this.update(this.status);
    if (m.type === "rescan") await command("detron.server.rescan");
    if (m.type === "toggleShow") await command("detron.server.toggleShow");
    if (m.type === "toggleHints") await command("detron.server.toggleHints");
    if (m.type === "settings") await vscode.commands.executeCommand("workbench.action.openSettings", "detron");
    if (m.type === "open") {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, m.file));
      const at = new vscode.Position(m.line - 1, 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, at) });
    }
    if (m.type === "copyFix") {
      await vscode.env.clipboard.writeText(await client.sendRequest<string>("detron/explain", { id: m.id }));
      void vscode.window.showInformationMessage("Detron: fix copied. Paste it into your agent's chat.");
    }
    if (m.type === "copyReport") {
      await vscode.env.clipboard.writeText(await client.sendRequest<string>("detron/report", { format: "agent" }));
      void vscode.window.showInformationMessage("Detron: report copied. Paste it into your agent's chat.");
    }
    if (m.type === "openReport") {
      const content = await client.sendRequest<string>("detron/report", { format: "person" });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: "markdown" }), { preview: false });
    }
  }
}
