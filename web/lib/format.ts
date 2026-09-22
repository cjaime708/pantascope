/** Small formatting helpers shared by pages. */

export function formatUsdc(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "--";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "--";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function impliedPct(price: string | null): string {
  if (price === null || price === "") return "--";
  const n = parseFloat(price);
  if (Number.isNaN(n)) return "--";
  return `${(n * 100).toFixed(1)}%`;
}

export function shortWallet(w: string): string {
  if (w.length <= 12) return w;
  return `${w.slice(0, 6)}...${w.slice(-4)}`;
}

export function formatDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
