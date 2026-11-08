import type { SVGProps } from "react";

/**
 * Pixel icons: each icon is a small grid of square cells ("#" = filled).
 * Touching cells are merged into one outline, then every corner (outer and
 * inner) gets a slight rounding, so shapes read as pixel art with soft edges.
 */

type Pt = [number, number];
const RADIUS = 0.28; // in cells; keep small so the pixel look stays crisp

const key = (p: Pt) => `${p[0]},${p[1]}`;

/** Trace the outline loops of the filled cells, clockwise (filled side on the right). */
function traceLoops(rows: string[]): Pt[][] {
  const filled = (x: number, y: number) => rows[y]?.[x] === "#";
  const edges = new Map<string, Pt[]>(); // start vertex -> end vertices
  const add = (a: Pt, b: Pt) => {
    const k = key(a);
    edges.set(k, [...(edges.get(k) ?? []), b]);
  };

  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add([x, y], [x + 1, y]);
      if (!filled(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!filled(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!filled(x - 1, y)) add([x, y + 1], [x, y]);
    }
  });

  const loops: Pt[][] = [];
  for (const [startKey, ends] of edges) {
    while (ends.length) {
      const start = startKey.split(",").map(Number) as Pt;
      const loop: Pt[] = [start];
      let prev = start;
      let cur = ends.shift()!;
      while (key(cur) !== startKey) {
        loop.push(cur);
        const options = edges.get(key(cur))!;
        // Where two cells touch only at a corner, turn right to keep them apart.
        const dir: Pt = [cur[0] - prev[0], cur[1] - prev[1]];
        const right: Pt = [-dir[1], dir[0]];
        const pick = options.findIndex((o) => o[0] - cur[0] === right[0] && o[1] - cur[1] === right[1]);
        const [next] = options.splice(Math.max(0, pick), 1);
        prev = cur;
        cur = next;
      }
      loops.push(loop.filter((_, i) => !isCollinear(loop, i)));
    }
  }
  return loops;
}

function isCollinear(loop: Pt[], i: number) {
  const a = loop[(i - 1 + loop.length) % loop.length];
  const b = loop[i];
  const c = loop[(i + 1) % loop.length];
  return (b[0] - a[0]) * (c[1] - b[1]) === (b[1] - a[1]) * (c[0] - b[0]);
}

const fmt = (n: number) => +n.toFixed(3);

/** Build an SVG path with every corner softened by a small curve. */
export function pixelPath(rows: string[], radius = RADIUS): string {
  const filled = (x: number, y: number) => rows[y]?.[x] === "#";
  // Where two cells meet only at a corner (a diagonal step), keep that corner
  // sharp so the steps stay joined instead of being rounded apart.
  const isDiagonalJoin = ([x, y]: Pt) => {
    const tl = filled(x - 1, y - 1);
    const tr = filled(x, y - 1);
    const bl = filled(x - 1, y);
    const br = filled(x, y);
    return (tl && br && !tr && !bl) || (tr && bl && !tl && !br);
  };
  return traceLoops(rows)
    .map((loop) => {
      const n = loop.length;
      const parts = loop.map((v, i) => {
        if (isDiagonalJoin(v)) return `${i === 0 ? "M" : "L"}${v[0]} ${v[1]}`;
        const p = loop[(i - 1 + n) % n];
        const q = loop[(i + 1) % n];
        const toward = (o: Pt): Pt => {
          const dx = o[0] - v[0];
          const dy = o[1] - v[1];
          const len = Math.hypot(dx, dy);
          const r = Math.min(radius, len / 2);
          return [v[0] + (dx / len) * r, v[1] + (dy / len) * r];
        };
        const a = toward(p);
        const b = toward(q);
        return `${i === 0 ? "M" : "L"}${fmt(a[0])} ${fmt(a[1])}Q${v[0]} ${v[1]} ${fmt(b[0])} ${fmt(b[1])}`;
      });
      return `${parts.join("")}Z`;
    })
    .join("");
}

export type PixelIconProps = SVGProps<SVGSVGElement>;
export type PixelIcon = ((props: PixelIconProps) => React.JSX.Element) & { displayName?: string };

export function makePixelIcon(name: string, rows: string[]): PixelIcon {
  const d = pixelPath(rows);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  // Half a cell of padding so icons sit like stroke icons do.
  const viewBox = `-0.5 -0.5 ${w + 1} ${h + 1}`;
  const Icon = ({ width = 24, height = 24, ...props }: PixelIconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d={d} />
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

// ---- Grid helpers -------------------------------------------------------

/** Rotate a grid 90° clockwise. */
function rotate(rows: string[]): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return Array.from({ length: w }, (_, x) =>
    rows
      .map((r) => r[x] ?? ".")
      .reverse()
      .join(""),
  );
}
const turn = (rows: string[], times: number) =>
  Array.from({ length: times }).reduce<string[]>((g) => rotate(g), rows);

// ---- Icons ------------------------------------------------------------
// Diagonals are one block wide, with blocks touching at their corners,
// like classic pixel art.

/** Same shape as the brand reference: a one-block diagonal with a square head. */
const ARROW_UP_RIGHT = [
  ".###", //
  "..##",
  ".#.#",
  "#...",
];

const CHEVRON_RIGHT = [
  ".#...", //
  "..#..",
  "...#.",
  "..#..",
  ".#...",
];

const ARROW_LEFT = [
  "..#..", //
  ".#...",
  "#####",
  ".#...",
  "..#..",
];

export const PxLogoArrow = makePixelIcon("PxLogoArrow", ARROW_UP_RIGHT);
export const PxArrowUpRight = makePixelIcon("PxArrowUpRight", ARROW_UP_RIGHT);
export const PxArrowLeft = makePixelIcon("PxArrowLeft", ARROW_LEFT);
export const PxArrowRight = makePixelIcon("PxArrowRight", turn(ARROW_LEFT, 2));
export const PxArrowUp = makePixelIcon("PxArrowUp", turn(ARROW_LEFT, 1));
export const PxSend = makePixelIcon("PxSend", turn(ARROW_LEFT, 1));
export const PxChevronRight = makePixelIcon("PxChevronRight", CHEVRON_RIGHT);
export const PxChevronDown = makePixelIcon("PxChevronDown", turn(CHEVRON_RIGHT, 1));
export const PxChevronLeft = makePixelIcon("PxChevronLeft", turn(CHEVRON_RIGHT, 2));
export const PxChevronUp = makePixelIcon("PxChevronUp", turn(CHEVRON_RIGHT, 3));

export const PxPlus = makePixelIcon("PxPlus", [
  "..#..", //
  "..#..",
  "#####",
  "..#..",
  "..#..",
]);

export const PxX = makePixelIcon("PxX", [
  "#...#", //
  ".#.#.",
  "..#..",
  ".#.#.",
  "#...#",
]);

export const PxCheck = makePixelIcon("PxCheck", [
  "....#", //
  "...#.",
  "#.#..",
  ".#...",
]);

export const PxDownload = makePixelIcon("PxDownload", [
  "..#..", //
  "#.#.#",
  ".###.",
  "..#..",
  ".....",
  "#####",
]);

export const PxSparkle = makePixelIcon("PxSparkle", [
  "...#...", //
  "...#...",
  "..###..",
  "#######",
  "..###..",
  "...#...",
  "...#...",
]);

export const PxChat = makePixelIcon("PxChat", [
  ".......", //
  "#######",
  "#.....#",
  "#.....#",
  "#######",
  ".##....",
  ".#.....",
]);

export const PxGrid = makePixelIcon("PxGrid", [
  "###.###", //
  "###.###",
  "###.###",
  ".......",
  "###.###",
  "###.###",
  "###.###",
]);

export const PxSliders = makePixelIcon("PxSliders", [
  "..#....", //
  "#######",
  "..#....",
  ".......",
  "....#..",
  "#######",
  "....#..",
]);

export const PxFolder = makePixelIcon("PxFolder", [
  ".......", //
  "###....",
  "#######",
  "#.....#",
  "#.....#",
  "#######",
  ".......",
]);

export const PxFilm = makePixelIcon("PxFilm", [
  "#######", //
  "#.#.#.#",
  "#######",
  "#.....#",
  "#######",
  "#.#.#.#",
  "#######",
]);

export const PIXEL_ICONS = {
  PxLogoArrow,
  PxArrowUpRight,
  PxArrowLeft,
  PxArrowRight,
  PxArrowUp,
  PxChevronRight,
  PxChevronDown,
  PxChevronLeft,
  PxChevronUp,
  PxPlus,
  PxX,
  PxCheck,
  PxDownload,
  PxSparkle,
  PxChat,
  PxGrid,
  PxSliders,
  PxFolder,
  PxFilm,
};
