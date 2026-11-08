import { useEffect, useState } from "react";
import { PxDownload, PxX } from "@/ui/pixel-icon";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, errorMessage, type LibraryItem } from "@/lib/api";
import { fileSrc } from "@/lib/media";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { DRAG_MIME, useTimeline } from "./timeline";

const REORDER_MIME = "application/x-studio-timeline-index";

/** Optional stitch strip: drag video cards here, reorder, export one MP4 with ffmpeg. */
export function TimelineStrip({ items }: { items: LibraryItem[] }) {
  const { clips, add, remove, move } = useTimeline();
  const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .ffmpegStatus()
      .then((s) => setFfmpeg(s.available))
      .catch(() => setFfmpeg(false));
  }, []);

  const onDrop = (e: React.DragEvent, at?: number) => {
    e.preventDefault();
    setOver(false);
    const from = e.dataTransfer.getData(REORDER_MIME);
    if (from !== "") {
      move(Number(from), at ?? clips.length - 1);
      return;
    }
    const id = e.dataTransfer.getData(DRAG_MIME);
    const item = items.find((i) => i.asset.id === id);
    if (item) {
      add(item);
      if (at !== undefined) {
        const len = useTimeline.getState().clips.length;
        move(len - 1, at);
      }
    }
  };

  const exportMp4 = async () => {
    const path = await save({ defaultPath: "timeline.mp4", filters: [{ name: "MP4", extensions: ["mp4"] }] });
    if (!path) return;
    setBusy(true);
    const id = toast.loading(`Stitching ${clips.length} clips…`);
    try {
      const out = await api.timelineExport(
        clips.map((c) => c.asset.id),
        path,
      );
      toast.success(`Exported ${out.split("/").pop()}`, {
        id,
        action: { label: "Reveal", onClick: () => void api.revealPath(out) },
      });
    } catch (e) {
      toast.error(errorMessage(e), { id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-subtle px-7 text-text-2">
      <span className="eyebrow text-text-2">Timeline</span>
      <div
        role="list"
        aria-label="Timeline clips"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes(REORDER_MIME)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => onDrop(e)}
        className={cn(
          "flex h-9 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto rounded-lg border border-dashed border-[var(--border-default)] bg-fill-1 px-1.5 text-xs transition-colors",
          over && "border-accent bg-[var(--accent-a10)]",
        )}
      >
        {clips.length === 0 ? (
          <span className="px-1.5">
            Drag video clips here to stitch ·{" "}
            {ffmpeg === null ? "checking ffmpeg…" : ffmpeg ? "ffmpeg detected" : "Install ffmpeg to export"}
          </span>
        ) : (
          clips.map((c, i) => (
            <div
              key={c.asset.id}
              role="listitem"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(REORDER_MIME, String(i));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, i);
              }}
              onDragOver={(e) => e.preventDefault()}
              className="group relative h-7 w-12 shrink-0 cursor-grab overflow-hidden rounded-md bg-surface-3 shadow-[var(--rim)]"
              title={c.job.prompt}
            >
              <video
                src={fileSrc(c.asset.path)}
                muted
                preload="metadata"
                className="size-full object-cover"
              />
              <span className="absolute bottom-0 left-0.5 text-[9px] font-semibold text-white drop-shadow">
                {i + 1}
              </span>
              <button
                type="button"
                aria-label={`Remove clip ${i + 1}`}
                onClick={() => remove(c.asset.id)}
                className="absolute top-0 right-0 grid size-4 place-items-center rounded-bl bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <PxX className="size-2.5" />
              </button>
            </div>
          ))
        )}
      </div>
      {clips.length > 0 && (
        <span className="shrink-0 text-xs">
          {clips.length} clip{clips.length === 1 ? "" : "s"}
          {ffmpeg === false && " · install ffmpeg to export"}
        </span>
      )}
      <Button disabled={!ffmpeg || clips.length < 1 || busy} onClick={exportMp4}>
        <PxDownload /> Export MP4
      </Button>
    </footer>
  );
}
