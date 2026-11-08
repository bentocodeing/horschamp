import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { FolderSearch, MoreHorizontal, RotateCcw, Trash2, Wand2, ImagePlus } from "lucide-react";
import { PxChat } from "@/ui/pixel-icon";
import { toast } from "sonner";
import { api, errorMessage, type Job } from "@/lib/api";
import { useStore } from "@/store";
import { elapsed, str, usd } from "@/lib/format";
import { fileSrc } from "@/lib/media";
import { basename, retryRequest } from "@/lib/shots";
import { queueJobs } from "@/lib/queue";
import { StatusBadge } from "@/ui/status-badge";
import { Chip } from "@/ui/chip";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

const ACTIVE = new Set(["submitting", "queued", "running", "downloading"]);

function aspect(params: Record<string, unknown>, fallback: string): string {
  const a = typeof params.aspect_ratio === "string" ? params.aspect_ratio : fallback;
  const [w, h] = a.split(":").map(Number);
  return w && h ? `${w} / ${h}` : "16 / 9";
}

function useTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function JobCard({ job }: { job: Job }) {
  const { presetComposer, sendToBrief, removeJob } = useStore();
  const active = ACTIVE.has(job.status);
  useTick(active);
  const isVideo = job.category.includes("video");
  const count = Number(job.params.batch_size ?? job.params.num_images ?? 1) || 1;
  const summary = [
    job.params.duration != null && `${str(job.params.duration)}s`,
    str(job.params.aspect_ratio),
    str(job.params.resolution),
    count > 1 && `${count} images`,
  ]
    .filter(Boolean)
    .join(" · ");

  const cancel = async () => {
    try {
      toast.message(await api.jobCancel(job.id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const del = async () => {
    try {
      await api.jobDelete(job.id);
      removeJob(job.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const reuse = () =>
    presetComposer({
      model_id: job.model_id,
      params: job.params,
      prompt: job.prompt,
      attachments: job.attachments.map((a) => ({ path: a.path, param: a.param })),
    });

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-full max-w-[820px] flex-col gap-4"
    >
      {(job.prompt || job.attachments.length > 0) && (
        <div className="flex justify-end">
          <div className="selectable max-w-[560px] rounded-[16px_16px_4px_16px] bg-surface-2 px-4 py-3 leading-relaxed">
            {job.prompt || <span className="text-text-2">No prompt</span>}
            {job.attachments.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {job.attachments.map((a, i) => (
                  <Chip key={i}>{basename(a.path)}</Chip>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs text-text-2">
          <span className="font-semibold text-text-1">{job.model_name}</span>
          {summary && <span>· {summary}</span>}
          <span>
            · {job.status === "completed" ? usd(job.cost_usd ?? job.est_usd) : `est. ${usd(job.est_usd)}`}
          </span>
          {job.source === "brief" && <Chip tone="accent">Brief</Chip>}
          <span className="ml-auto" />
          <StatusBadge status={job.status} elapsed={active ? elapsed(job.created_at) : undefined} />
          {(job.status === "queued" || job.status === "submitting") && (
            <Button size="xs" variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Job actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={reuse}>
                <Wand2 /> Reuse settings
              </DropdownMenuItem>
              {!active && (
                <DropdownMenuItem
                  onSelect={() =>
                    void queueJobs([{ label: job.model_name, req: retryRequest(job) }], "Run again?")
                  }
                >
                  <RotateCcw /> Run again
                </DropdownMenuItem>
              )}
              {job.request_id && (
                <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(job.request_id!)}>
                  Copy request ID
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={active && !!job.request_id}
                onSelect={() => void del()}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {active && (
          <div className={count > 1 ? "grid grid-cols-4 gap-2" : ""}>
            {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
              <div
                key={i}
                className="shimmer w-full rounded-2xl"
                style={{ aspectRatio: aspect(job.params, isVideo ? "16:9" : "3:4") }}
              />
            ))}
            {job.error && <p className="mt-2 text-xs text-text-2">{job.error}</p>}
          </div>
        )}

        {job.status === "completed" && job.assets.length > 0 && (
          <div className={job.assets.length > 1 ? "grid grid-cols-2 gap-2 md:grid-cols-4" : ""}>
            {job.assets.map((a) =>
              a.kind === "video" ? (
                <div
                  key={a.id}
                  className="group relative overflow-hidden rounded-2xl bg-surface shadow-[var(--rim)]"
                >
                  <video
                    src={fileSrc(a.path)}
                    controls
                    loop
                    playsInline
                    preload="metadata"
                    className="block w-full"
                    style={{ aspectRatio: aspect(job.params, "16:9") }}
                  />
                </div>
              ) : a.kind === "image" ? (
                <button
                  key={a.id}
                  onClick={() => void api.assetOpen(a.id)}
                  className="overflow-hidden rounded-2xl bg-surface shadow-[var(--rim)] transition-transform duration-300 hover:scale-[1.01]"
                >
                  <img
                    src={fileSrc(a.path)}
                    alt={job.prompt}
                    className="block w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ) : (
                <Chip key={a.id}>{basename(a.path)}</Chip>
              ),
            )}
          </div>
        )}

        {(job.status === "failed" || job.status === "nsfw" || job.status === "canceled") && (
          <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-[13px] shadow-[var(--rim)]">
            <span className="flex-1 text-text-2">
              {job.error || (job.status === "canceled" ? "Canceled." : "Failed.")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void queueJobs([{ label: job.model_name, req: retryRequest(job) }], "Retry this job?")
              }
            >
              <RotateCcw /> Retry
            </Button>
          </div>
        )}

        {job.status === "completed" && job.assets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={reuse}>
              <Wand2 /> Reuse settings
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => presetComposer({ inputs: [job.assets[0].path] })}
            >
              <ImagePlus /> Use as input
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                sendToBrief(
                  `Feedback on this result (${job.model_name}): `,
                  job.assets.map((a) => a.path),
                )
              }
            >
              <PxChat /> Send to Brief
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void api.assetReveal(job.assets[0].id)}>
              <FolderSearch /> Reveal
            </Button>
          </div>
        )}
      </div>
    </motion.article>
  );
}
