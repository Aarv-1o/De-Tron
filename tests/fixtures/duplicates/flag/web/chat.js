// A drifted copy of timeAgo: different wording and thresholds. Must be "likely".
export function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hours ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

export function stripJsonState(text) {
  const stateKeys = ['"user_request"', '"chatbot_reply"', '"need_clarification"'];
  let result = [];
  for (const line of text.split("\n")) {
    if (!stateKeys.some((k) => line.includes(k))) result.push(line);
  }
  return result.join("\n");
}
