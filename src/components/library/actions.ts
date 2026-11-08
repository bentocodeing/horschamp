import { toast } from "sonner";
import { api, errorMessage, type LibraryItem } from "@/lib/api";
import { useStore } from "@/store";

/** Shared asset actions for cards and the lightbox. */
export function reuse(item: LibraryItem) {
  const { job } = item;
  useStore.getState().presetComposer({
    model_id: job.model_id,
    params: job.params,
    prompt: job.prompt,
    attachments: job.attachments.map((a) => ({ path: a.path, param: a.param })),
  });
}

export function sendAsInput(item: LibraryItem) {
  useStore.getState().presetComposer({ inputs: [item.asset.path] });
}

export async function reveal(item: LibraryItem) {
  try {
    await api.assetReveal(item.asset.id);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function openExternal(item: LibraryItem) {
  try {
    await api.assetOpen(item.asset.id);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function copyPrompt(item: LibraryItem) {
  try {
    await navigator.clipboard.writeText(item.job.prompt);
    toast.success("Prompt copied");
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export function metaLine(item: LibraryItem, cost: (v: number | null) => string): string {
  const { job } = item;
  const parts = [job.model_name];
  const d = job.params.duration;
  if (item.asset.kind === "video" && (typeof d === "number" || typeof d === "string")) parts.push(`${d}s`);
  parts.push(cost(job.cost_usd ?? job.est_usd));
  return parts.join(" · ");
}
