import { toast } from "sonner";
import { api, errorCode, errorMessage, type Job, type JobRequest, type Quote } from "./api";
import { useStore } from "@/store";
import { usd } from "./format";

/**
 * Quote → (confirm) → submit for one or more requests. Shows a single cost dialog for the batch.
 * The backend enforces the same rule, so a job can't be submitted without an approved price.
 */
export async function queueJobs(
  items: { label: string; req: JobRequest }[],
  title = "Start generation?",
): Promise<Job[]> {
  const st = useStore.getState();
  if (!st.key?.present) {
    toast.error("Add your Higgsfield API key in Settings first.");
    st.setRoute("settings");
    return [];
  }
  const quotes: Quote[] = [];
  // Only show a spinner when estimating is slow (uploads); a fast quote would just flash it.
  let toastId: string | number | undefined;
  const timer = setTimeout(() => {
    toastId = toast.loading(items.length > 1 ? `Estimating ${items.length} jobs…` : "Estimating cost…");
  }, 300);
  try {
    for (const it of items) quotes.push(await api.jobQuote(it.req));
  } catch (e) {
    clearTimeout(timer);
    toast.error(errorMessage(e), { id: toastId });
    return [];
  }
  clearTimeout(timer);
  if (toastId !== undefined) toast.dismiss(toastId);

  const bad = quotes.findIndex((q) => q.issues.length > 0);
  if (bad >= 0) {
    const q = quotes[bad];
    toast.error(`${items[bad].label}: ${q.issues.map((i) => `${i.param} ${i.message}`).join("; ")}`);
    return [];
  }

  const needsConfirm = quotes.some((q) => q.needs_confirm);
  if (needsConfirm) {
    const ok = await st.askConfirm({
      title,
      quote: quotes[0],
      lines: items.map((it, i) => ({
        label: it.label,
        usd: quotes[i].est_usd,
        note: quotes[i].estimate_error ? `No estimate: ${quotes[i].estimate_error}` : undefined,
      })),
    });
    if (!ok) return [];
  }

  const jobs: Job[] = [];
  for (const [i, it] of items.entries()) {
    try {
      const j = await api.jobSubmit(it.req, quotes[i].est_usd ?? (needsConfirm ? 0 : null));
      useStore.getState().upsertJob(j);
      jobs.push(j);
    } catch (e) {
      if (errorCode(e) === "needs_confirmation") {
        toast.error(`${it.label}: the price changed since you confirmed. Try again.`);
      } else {
        toast.error(`${it.label}: ${errorMessage(e)}`);
      }
    }
  }
  if (jobs.length) {
    const total = quotes.reduce((s, q) => s + (q.est_usd ?? 0), 0);
    toast.success(
      jobs.length > 1 ? `Queued ${jobs.length} jobs · est. ${usd(total)}` : `Queued · est. ${usd(total)}`,
    );
  }
  return jobs;
}
