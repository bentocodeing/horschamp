import { motion } from "motion/react";
import { Pencil } from "lucide-react";
import { PxSend } from "@/ui/pixel-icon";
import type { Shot } from "@/lib/api";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";

export function ShotCard({
  shot,
  index,
  missing,
  onEdit,
  onQueue,
  busy,
}: {
  shot: Shot;
  index: number;
  missing: string[];
  onEdit: () => void;
  onQueue: () => void;
  busy: boolean;
}) {
  const modelsById = useStore((s) => s.modelsById);
  const model = modelsById[shot.model_id];
  const name = (id?: string | null) => (id ? (modelsById[id]?.name ?? id) : null);
  const p = shot.params ?? {};
  const meta = [
    typeof p.duration === "number" || typeof p.duration === "string" ? `${p.duration}s` : null,
    typeof p.aspect_ratio === "string" ? p.aspect_ratio : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const prompt = typeof p.prompt === "string" ? p.prompt : "";
  const ok = shot.issues.length === 0 && missing.length === 0;
  const alts = [
    shot.cheaper && `Cheaper: ${name(shot.cheaper)}`,
    shot.better && `Higher quality: ${name(shot.better)}`,
  ].filter(Boolean);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className={cn(
        "flex flex-col gap-2 rounded-2xl bg-surface p-3.5 shadow-[var(--rim)]",
        shot.needs.length > 0 && ok && "shadow-[inset_0_0_0_1px_var(--accent-a30)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold">{shot.title || `Shot ${index + 1}`}</span>
        {meta && <span className="shrink-0 text-text-2">{meta}</span>}
      </div>
      <div className="text-xs text-accent">{shot.model_name ?? model?.name ?? shot.model_id}</div>
      {prompt && <div className="line-clamp-3 text-xs leading-relaxed text-[#c9cacc]">{prompt}</div>}
      {(shot.why || alts.length > 0) && (
        <div className="text-[11px] leading-relaxed text-text-3">
          {shot.why && <>Why: {shot.why} </>}
          {alts.join(". ")}
          {alts.length > 0 && "."}
        </div>
      )}
      {shot.notes && <div className="text-[11px] leading-relaxed text-text-2">Tip: {shot.notes}</div>}
      <div className="flex flex-wrap gap-1.5">
        {shot.needs.map((n) => (
          <Chip key={n} tone={missing.includes(n) ? "danger" : "default"}>
            {missing.includes(n) ? `missing: ${n}` : `needs: ${n}`}
          </Chip>
        ))}
        {shot.issues.length === 0 ? <Chip tone="accent">✓ valid params</Chip> : null}
      </div>
      {shot.issues.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-lg bg-[rgba(250,0,25,.08)] px-2.5 py-2 text-[11px] text-[#ff8a8a]">
          {shot.issues.map((i, k) => (
            <li key={k}>
              <span className="font-semibold">{i.param}</span> {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-0.5">
        <Button size="sm" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        <Button size="sm" onClick={onQueue} disabled={!ok || busy}>
          <PxSend /> Send to queue
        </Button>
      </div>
    </motion.article>
  );
}
