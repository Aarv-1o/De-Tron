// Small, but copied into 3+ files: still a copy worth merging.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export const find = (q) => new RegExp(escapeRegex(q), "i");
