import { useState } from "react";

export const COLOR_GROUPS: { title: string; vars: string[] }[] = [
  {
    title: "Surfaces",
    vars: ["--bg-app", "--bg-panel", "--bg-surface", "--bg-surface-2", "--bg-surface-3", "--bg-glass"],
  },
  { title: "Fills", vars: ["--fill-1", "--fill-2", "--fill-3", "--scrim"] },
  { title: "Borders", vars: ["--border-subtle", "--border-default", "--border-strong", "--border-control"] },
  {
    title: "Text",
    vars: ["--text-1", "--text-2", "--text-3", "--text-disabled", "--text-on-media-2", "--text-inverse"],
  },
  {
    title: "Accent",
    vars: [
      "--accent",
      "--accent-hi",
      "--accent-600",
      "--accent-a10",
      "--accent-a15",
      "--accent-a30",
      "--accent-a48",
      "--accent-2",
    ],
  },
  { title: "Semantic", vars: ["--success", "--warning", "--danger", "--info", "--purple", "--cyan"] },
];

/** Reads a CSS custom property from :root so the page always shows live token values. */
export function useCssVar(name: string): string {
  const [v] = useState(() => getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  return v;
}

function Swatch({ name }: { name: string }) {
  const value = useCssVar(name);
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-xl shadow-[var(--rim-strong)]"
        style={{
          background: `var(${name}), repeating-conic-gradient(#2a2d32 0 25%, #1c1e21 0 50%) 0 0 / 12px 12px`,
          backgroundColor: `var(${name})`,
        }}
      />
      <div className="min-w-0">
        <div className="truncate font-mono text-[11px] text-text-1">{name}</div>
        <div className="selectable truncate font-mono text-[11px] text-text-3">{value}</div>
      </div>
    </div>
  );
}

export function Swatches() {
  return (
    <div className="flex flex-col gap-6">
      {COLOR_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-2 text-xs font-medium text-text-2">{g.title}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {g.vars.map((v) => (
              <Swatch key={v} name={v} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TokenValue({ name }: { name: string }) {
  const v = useCssVar(name);
  return <span className="selectable font-mono text-[11px] text-text-3">{v}</span>;
}
