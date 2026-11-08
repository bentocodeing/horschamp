#!/usr/bin/env node
// Rebuild models.json from docs.higgsfield.ai (each model page embeds its JSON schema).
// Usage: pnpm refresh-models            → writes models.refreshed.json and prints a diff
//        pnpm refresh-models -- --write → overwrites models.json
// Then import it in the app: Settings → Models → Import refreshed models.json.
import { readFileSync, writeFileSync } from "node:fs";

const DOCS = "https://docs.higgsfield.ai";
const write = process.argv.includes("--write");
const current = JSON.parse(readFileSync(new URL("../models.json", import.meta.url), "utf8"));
const byId = new Map(current.models.map((m) => [m.id, m]));

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": "horschamp/refresh-models" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

const linkRe = /(?:https:\/\/docs\.higgsfield\.ai\/|\]\(\/|\(\.?\/?)?(docs\/models\/[a-z0-9._/-]+\.md)/g;
const links = (md) => [...md.matchAll(linkRe)].map((m) => `${DOCS}/${m[1]}`);

async function discover() {
  const urls = new Set(current.models.map((m) => m.source_url).filter(Boolean));
  const queue = [`${DOCS}/docs/models.md`];
  const seen = new Set();
  while (queue.length) {
    const u = queue.shift();
    if (seen.has(u) || seen.size > 400) continue;
    seen.add(u);
    let md;
    try {
      md = await get(u);
    } catch {
      continue;
    }
    for (const l of links(md)) {
      if (!seen.has(l)) {
        urls.add(l);
        // Category/family index pages link to more models.
        if (!/Endpoint ID/.test(md) || l.split("/").length <= 6) queue.push(l);
      }
    }
  }
  return [...urls];
}

function schemaFrom(md) {
  const i = md.indexOf("Complete JSON schema");
  if (i < 0) return null;
  const tail = md
    .slice(i)
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""));
  const start = tail.findIndex((l) => l.startsWith("```json"));
  if (start < 0) return null;
  const end = tail.findIndex((l, k) => k > start && l.startsWith("```"));
  try {
    return JSON.parse(tail.slice(start + 1, end).join("\n"));
  } catch {
    return null;
  }
}

function typeOf(p) {
  if (p.type) return Array.isArray(p.type) ? p.type.join("/") : p.type;
  const alts = (p.anyOf ?? p.oneOf ?? []).map((a) => a.type).filter(Boolean);
  return alts.length ? alts.join("/") : "string";
}

function inputsFrom(schema) {
  const req = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, p]) => {
    const alt = (p.anyOf ?? []).find((a) => a.type && a.type !== "null") ?? {};
    const src = { ...alt, ...p };
    const out = {
      name,
      type: typeOf(p),
      required: req.has(name),
      default: p.default ?? null,
      description: p.description ?? p.title ?? "",
    };
    if (src.enum) out.enum = src.enum;
    if (src.minimum !== undefined) out.min = src.minimum;
    if (src.maximum !== undefined) out.max = src.maximum;
    if (src.maxLength !== undefined) out.maxLength = src.maxLength;
    if (src.minItems !== undefined) out.minItems = src.minItems;
    if (src.maxItems !== undefined) out.maxItems = src.maxItems;
    if (src.format) out.format = src.format;
    return out;
  });
}

function category(id, prev) {
  if (prev) return prev.category;
  if (/text-to-video|t2v/.test(id)) return "text-to-video";
  if (/image-to-video|reference-to-video|first-last|image-reference|motion-control/.test(id))
    return "image-to-video";
  if (/video-edit|video-extend|video-reference|motion-transfer|restyle|object-swap/.test(id))
    return "video-to-video";
  if (/image|soul|recraft|ideogram|z-image|ads|marketing/.test(id)) return "image";
  return "other";
}

const urls = await discover();
console.log(`Checking ${urls.length} pages…`);
const models = [];
const failed = [];
for (const url of urls) {
  try {
    const md = await get(url);
    const id = md.match(/\*\*Endpoint ID:\*\*\s*`([^`]+)`/)?.[1];
    if (!id) continue;
    const schema = schemaFrom(md);
    const prev = byId.get(id);
    if (!schema) {
      if (prev) models.push(prev);
      failed.push(`${id} (no schema, kept previous)`);
      continue;
    }
    const name = (md.match(/^#\s+(.+?)(?:\s+API)?\s*$/m)?.[1] ?? prev?.name ?? id).trim();
    models.push({
      id,
      name,
      category: category(id, prev),
      endpoint: `POST https://api.higgsfield.ai/${id}`,
      description: prev?.description ?? "",
      inputs: inputsFrom(schema),
      output: prev?.output ?? { type: /video/.test(category(id, prev)) ? "video" : "image" },
      cost: prev?.cost ?? { usd: null, notes: "Use POST /estimate/{id}" },
      source_url: url,
      verified: true,
    });
  } catch (e) {
    failed.push(`${url}: ${e.message}`);
  }
}
// Keep models we couldn't find (e.g. Soul ID uses a different API) so nothing silently disappears.
for (const m of current.models) if (!models.some((x) => x.id === m.id)) models.push(m);
const unique = [...new Map(models.map((m) => [m.id, m])).values()].sort((a, b) => a.id.localeCompare(b.id));
// Compare what matters for validation, ignoring order and description wording.
const shape = (inputs) =>
  JSON.stringify(
    [...inputs]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ description: _d, ...rest }) =>
        Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))),
      ),
  );
const next = {
  generated_at: new Date().toISOString(),
  source: `${DOCS}/docs/models.md (crawled)`,
  models: unique,
};

const added = unique.filter((m) => !byId.has(m.id)).map((m) => m.id);
const removed = current.models
  .filter((m) => !models.some((u) => u.id === m.id && u.source_url))
  .map((m) => m.id);
const changed = unique
  .filter((m) => byId.has(m.id) && shape(byId.get(m.id).inputs) !== shape(m.inputs))
  .map((m) => m.id);
console.log(
  `\n${unique.length} models · +${added.length} added · -${removed.length} missing · ~${changed.length} changed`,
);
for (const a of added) console.log(`  + ${a}`);
for (const r of removed) console.log(`  ? ${r} (not found on the docs; kept as is)`);
for (const c of changed) console.log(`  ~ ${c}`);
if (failed.length) console.log(`\nWarnings:\n  ${failed.join("\n  ")}`);

if (unique.length < current.models.length * 0.8) {
  console.error("\nFound far fewer models than before; not writing. The docs layout may have changed.");
  process.exit(1);
}
const out = write ? "models.json" : "models.refreshed.json";
writeFileSync(new URL(`../${out}`, import.meta.url), JSON.stringify(next, null, 1) + "\n");
console.log(
  `\nWrote ${out}${write ? "" : ". Re-run with --write to replace models.json, or import it in Settings."}`,
);
