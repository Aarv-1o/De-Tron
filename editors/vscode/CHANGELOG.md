# Changelog

## 0.0.4

- A cleaner sidebar: counts at a glance, file name first, Copy fix on hover, empty groups folded into one line, Scan again / Full report / Copy report in the panel's title bar.
- Says when it can't tell what changed (the open folder isn't a git repo).
- The panel's script nonce comes from crypto, not Math.random() (found by Detron).

## 0.0.3

- Fix: the extension stopped at startup ("command 'detron.toggleShow' already exists"). The server's commands are now detron.server.*.

## 0.0.2

- The Detron sidebar: scan, your changes or the whole repo, findings by part, reports.
- Fix: the server didn't start in VS Code, so the status bar kept spinning.

## 0.0.1

First version: findings in the editor, your changes by default, plain-word cards, safe quick fixes.
