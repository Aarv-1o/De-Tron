export const hiddenNote = (count: number) =>
  `${count} more hint${count === 1 ? "" : "s"} hidden. Run with --all to see them.`;

// "No dead code found." or, when only hints exist, "No dead code found (2 more hints hidden. …)."
export const nothingFound = (what: string, hidden: number) =>
  hidden ? `No ${what} found (${hiddenNote(hidden).replace(/\.$/, "")}).\n` : `No ${what} found.\n`;
