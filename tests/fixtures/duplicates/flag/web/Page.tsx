// Exact copies of web/time.ts, renamed: must be "sure".
const fileTimeAgo = (d: string) => {
  const delta = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

function formatFileSize(n: number): string {
  if (n === 0) return "0 B";
  const base = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.floor(Math.log(n) / Math.log(base));
  return parseFloat((n / Math.pow(base, idx)).toFixed(1)) + " " + units[idx];
}

export const Page = ({ at, size }: { at: string; size: number }) => (
  <p>{fileTimeAgo(at)} · {formatFileSize(size)}</p>
);
