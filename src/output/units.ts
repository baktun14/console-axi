const BINARY_UNITS = ["B", "Ki", "Mi", "Gi", "Ti", "Pi"] as const;

/** 536870912 -> "512Mi", 1610612736 -> "1.5Gi". */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${BINARY_UNITS[unit]}`;
}

/** Millicores -> cores: 500 -> "0.5". */
export function cpuCores(millicores: number): string {
  return String(Math.round((millicores / 1000) * 100) / 100);
}

/** 86400000 -> "24h", 90000 -> "1.5m". */
export function humanDuration(ms: number): string {
  const round = (n: number): number => Math.round(n * 100) / 100;
  if (ms >= 3_600_000) return `${round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${round(ms / 60_000)}m`;
  return `${round(ms / 1000)}s`;
}
