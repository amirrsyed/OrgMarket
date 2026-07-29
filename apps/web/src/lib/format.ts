/** Display clamp per D17: an open market never shows 0% or 100%. */
export function clampProb(p: number): number {
  return Math.min(0.999, Math.max(0.001, p));
}

export function formatPct(p: number): string {
  return `${(clampProb(p) * 100).toFixed(1)}%`;
}

export function formatMoney(micro: number): string {
  const credits = micro / 1_000_000;
  return `₥${credits.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatShares(microShares: number): string {
  return (microShares / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
