// A function and the helper inside it share code by nature.
export function extractAttachments(payload) {
  const found = [];
  function walk(part) {
    if (part.filename && part.body && part.body.attachmentId) {
      found.push({ name: part.filename, id: part.body.attachmentId, type: part.mimeType || "application/octet-stream" });
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  return found;
}

// Two small copies in two files are below the bar for small bodies.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export const find = (q) => new RegExp(escapeRegex(q), "i");
