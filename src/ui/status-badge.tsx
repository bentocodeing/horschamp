import { cn } from "@/lib/utils";

export type JobStatus =
  | "submitting"
  | "queued"
  | "running"
  | "downloading"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

const LABEL: Record<JobStatus, string> = {
  submitting: "Sending",
  queued: "Queued",
  running: "Running",
  downloading: "Saving",
  completed: "Done",
  failed: "Failed",
  nsfw: "Blocked",
  canceled: "Canceled",
};

/** Job status pill. Active states pulse a dot; done uses the accent. */
export function StatusBadge({
  status,
  elapsed,
  className,
}: {
  status: JobStatus;
  elapsed?: string;
  className?: string;
}) {
  const active =
    status === "submitting" || status === "queued" || status === "running" || status === "downloading";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-semibold",
        status === "completed" && "bg-[var(--accent-a15)] text-accent",
        active && "bg-fill-2 text-text-1",
        (status === "failed" || status === "nsfw") && "bg-[rgba(250,0,25,.12)] text-[#ff8a8a]",
        status === "canceled" && "bg-fill-1 text-text-2",
        className,
      )}
    >
      {active && <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden />}
      {LABEL[status] ?? status}
      {elapsed && <span className="font-normal tabular-nums text-text-2">· {elapsed}</span>}
    </span>
  );
}
