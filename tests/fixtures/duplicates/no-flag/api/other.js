function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export const match = (q, text) => new RegExp(escapeRegex(q)).test(text);
