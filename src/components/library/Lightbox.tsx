import { useEffect } from "react";
import { Copy, FolderOpen } from "lucide-react";
import { PxArrowUpRight, PxChevronLeft, PxChevronRight } from "@/ui/pixel-icon";
import type { LibraryItem } from "@/lib/api";
import { fileSrc } from "@/lib/media";
import { usd, when } from "@/lib/format";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
import { copyPrompt, openExternal, reuse, reveal, sendAsInput } from "./actions";

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Full-size viewer. ←/→ move between items in the current result set. */
export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LibraryItem[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = index !== null ? items[index] : undefined;

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea")) return;
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndex]);

  const params = item ? Object.entries(item.job.params).filter(([k]) => k !== "prompt") : [];

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid max-h-[90vh] w-[min(1200px,94vw)] max-w-none grid-cols-[minmax(0,1fr)_320px] gap-0 overflow-hidden p-0 sm:max-w-none">
        {item && (
          <>
            <div className="relative flex min-h-0 items-center justify-center bg-black/40">
              {item.asset.kind === "video" ? (
                <video
                  key={item.asset.id}
                  src={fileSrc(item.asset.path)}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-[90vh] w-full object-contain"
                />
              ) : (
                <img
                  key={item.asset.id}
                  src={fileSrc(item.asset.path)}
                  alt={item.job.prompt}
                  className="max-h-[90vh] w-full object-contain"
                />
              )}
              {index !== null && index > 0 && (
                <Button
                  variant="glass"
                  size="icon-lg"
                  aria-label="Previous"
                  className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full"
                  onClick={() => onIndex(index - 1)}
                >
                  <PxChevronLeft />
                </Button>
              )}
              {index !== null && index < items.length - 1 && (
                <Button
                  variant="glass"
                  size="icon-lg"
                  aria-label="Next"
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full"
                  onClick={() => onIndex(index + 1)}
                >
                  <PxChevronRight />
                </Button>
              )}
            </div>
            <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-subtle bg-panel p-5">
              <div>
                <DialogTitle className="text-[15px] font-semibold">{item.job.model_name}</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-text-2">
                  {when(item.asset.created_at)} · {usd(item.job.cost_usd ?? item.job.est_usd)}
                  {item.job.cost_usd === null && item.job.est_usd !== null ? " est." : ""}
                </DialogDescription>
              </div>
              {item.job.prompt && (
                <div>
                  <div className="eyebrow mb-1.5">Prompt</div>
                  <p className="selectable text-[13px] leading-relaxed whitespace-pre-wrap text-text-1">
                    {item.job.prompt}
                  </p>
                </div>
              )}
              {params.length > 0 && (
                <div>
                  <div className="eyebrow mb-1.5">Settings</div>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                    {params.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-text-2">{k}</dt>
                        <dd className="selectable truncate text-text-1" title={formatValue(v)}>
                          {formatValue(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() => {
                    reuse(item);
                    onClose();
                  }}
                >
                  Reuse
                </Button>
                <Button
                  onClick={() => {
                    sendAsInput(item);
                    onClose();
                  }}
                >
                  Use as input
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reveal in Finder"
                  onClick={() => reveal(item)}
                >
                  <FolderOpen />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open in default app"
                  onClick={() => openExternal(item)}
                >
                  <PxArrowUpRight />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Copy prompt" onClick={() => copyPrompt(item)}>
                  <Copy />
                </Button>
              </div>
            </aside>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
