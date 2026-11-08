export function usd(v: number | null | undefined, opts: { unknown?: string } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return opts.unknown ?? "—";
  // Small prices keep a third decimal only when it carries information ($0.094, but $0.12).
  let text = v.toFixed(Math.abs(v) < 1 ? 3 : 2);
  if (Math.abs(v) < 1 && text.endsWith("0")) text = text.slice(0, -1);
  return `$${text}`;
}

export function elapsed(fromIso: string, toIso?: string | null): string {
  const s = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Display any param value as text (objects/arrays as JSON). */
export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v as string | number | boolean);
}
