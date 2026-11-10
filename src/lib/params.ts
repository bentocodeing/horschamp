import type { Model, ModelInput } from "./api";

/** Inputs that take uploaded media (files the user attaches). */
export function isMediaInput(i: ModelInput): boolean {
  if (i.name === "link_url") return false;
  if (i.format === "uri") return true;
  return ["image_urls", "video_urls", "audio_urls", "input_images", "image_reference_url"].includes(i.name);
}

export function mediaKind(i: ModelInput): "image" | "video" | "audio" {
  if (i.name.includes("video")) return "video";
  if (i.name.includes("audio")) return "audio";
  return "image";
}

export function isArrayInput(i: ModelInput): boolean {
  return i.type.startsWith("array");
}

/** Params that get a pill in the prompt bar, in display order. Everything else goes in "More". */
export const PRIMARY_PARAMS = [
  "aspect_ratio",
  "duration",
  "resolution",
  "quality",
  "batch_size",
  "num_images",
  "sound",
  "generate_audio",
];

export type ParamGroup = "prompt" | "media" | "primary" | "more";

export function groupOf(i: ModelInput): ParamGroup {
  if (i.name === "prompt") return "prompt";
  if (isMediaInput(i)) return "media";
  if (PRIMARY_PARAMS.includes(i.name) && (i.enum || i.type.startsWith("integer") || i.type === "boolean"))
    return "primary";
  return "more";
}

/** Initial param values: model defaults, skipping nulls/empties and media fields. */
export function defaultParams(model: Model): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of model.inputs) {
    if (isMediaInput(i) || i.name === "prompt") continue;
    const d = i.default;
    if (d === null || d === undefined || d === "") continue;
    if (Array.isArray(d) && d.length === 0) continue;
    out[i.name] = d;
  }
  return out;
}

/** Carry compatible values over when switching models (e.g. aspect ratio, duration). */
export function carryParams(prev: Record<string, unknown>, next: Model): Record<string, unknown> {
  const out = defaultParams(next);
  for (const i of next.inputs) {
    if (!(i.name in prev) || isMediaInput(i)) continue;
    const v = prev[i.name];
    if (i.enum && !i.enum.includes(v as never)) continue;
    if (typeof v === "number" && ((i.min !== undefined && v < i.min) || (i.max !== undefined && v > i.max)))
      continue;
    out[i.name] = v;
  }
  return out;
}

/** Client-side check mirroring the Rust validator, for instant feedback. Rust re-validates. */
export function validateParams(
  model: Model,
  params: Record<string, unknown>,
  mediaFilled: Set<string>,
): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const i of model.inputs) {
    const v = params[i.name];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (isMediaInput(i)) {
      if (i.required && !mediaFilled.has(i.name)) errs[i.name] = "needs a file";
      continue;
    }
    if (empty) {
      if (i.required) errs[i.name] = "is required";
      continue;
    }
    if (i.enum && !i.enum.includes(v as never)) errs[i.name] = `must be one of ${i.enum.join(", ")}`;
    if (typeof v === "number") {
      if (i.type.startsWith("integer") && !Number.isInteger(v)) errs[i.name] = "must be a whole number";
      if (i.min !== undefined && v < i.min) errs[i.name] = `must be ≥ ${i.min}`;
      if (i.max !== undefined && v > i.max) errs[i.name] = `must be ≤ ${i.max}`;
    }
    if (typeof v === "string" && i.maxLength && v.length > i.maxLength)
      errs[i.name] = `max ${i.maxLength} characters`;
  }
  return errs;
}

/** Pick which media input a dropped file should fill. */
export function targetInputFor(
  model: Model,
  kind: "image" | "video" | "audio",
  filled: Set<string>,
): ModelInput | undefined {
  const media = model.inputs.filter((i) => isMediaInput(i) && mediaKind(i) === kind);
  // Prefer required empty single inputs, then arrays, then any empty single input.
  return (
    media.find((i) => i.required && !isArrayInput(i) && !filled.has(i.name)) ??
    media.find((i) => isArrayInput(i)) ??
    media.find((i) => !filled.has(i.name))
  );
}

export function fileKind(path: string): "image" | "video" | "audio" | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  if (["wav", "mp3"].includes(ext)) return "audio";
  return null;
}

export function humanize(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\burl(s)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export const CATEGORY_LABEL: Record<string, string> = {
  image: "Image",
  "text-to-video": "Text to video",
  "image-to-video": "Image to video",
  "video-to-video": "Video to video",
  other: "Other",
};
