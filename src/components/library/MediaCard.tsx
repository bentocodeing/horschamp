import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Copy, FolderOpen, MoreHorizontal, Play, Star, Trash2 } from "lucide-react";
import { PxArrowUpRight, PxFilm } from "@/ui/pixel-icon";
import { toast } from "sonner";
import { api, errorMessage, type LibraryItem } from "@/lib/api";
import { fileSrc } from "@/lib/media";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { copyPrompt, metaLine, openExternal, reuse, reveal, sendAsInput } from "./actions";
import { DRAG_MIME, useTimeline } from "./timeline";

/** Plays a muted video while hovered; the poster frame fades out over 0.5s. */
export function HoverVideo({ src, active, className }: { src: string; active: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !reduced) {
      v.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      v.pause();
      v.currentTime = 0;
      setPlaying(false);
    }
  }, [active, reduced]);

  return (
    <div className={cn("relative", className)}>
      <video
        ref={ref}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        className={cn(
          "block size-full object-cover transition-opacity duration-500",
          playing ? "opacity-100" : "opacity-90",
        )}
      />
      {(reduced || !playing) && (
        <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] text-text-1">
          <Play className="size-3 fill-current" /> {reduced ? "video" : ""}
        </span>
      )}
    </div>
  );
}

export function MediaCard({
  item,
  index,
  onOpen,
  onChanged,
}: {
  item: LibraryItem;
  index: number;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { asset, job } = item;
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fav, setFav] = useState(asset.favorite);
  const [seenFav, setSeenFav] = useState(asset.favorite);
  if (seenFav !== asset.favorite) {
    setSeenFav(asset.favorite);
    setFav(asset.favorite);
  }
  const addToTimeline = useTimeline((s) => s.add);
  const showOverlay = hover || menuOpen;

  const toggleFav = async () => {
    const next = !fav;
    setFav(next);
    try {
      await api.assetFavorite(asset.id, next);
      onChanged();
    } catch (e) {
      setFav(!next);
      toast.error(errorMessage(e));
    }
  };

  const del = async () => {
    try {
      await api.assetDelete(asset.id);
      useTimeline.getState().remove(asset.id);
      toast.success("Deleted");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 12) * 0.025, ease: [0.16, 1, 0.3, 1] }}
      className="min-w-0"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open ${job.prompt || job.model_name}`}
        draggable={asset.kind === "video"}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, asset.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHover(false)}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "group relative aspect-[4/5] cursor-pointer overflow-hidden rounded-2xl bg-surface shadow-[var(--rim)] outline-none",
          "focus-visible:shadow-[var(--ring-focus)]",
          fav && "ring-0",
        )}
      >
        {asset.kind === "video" ? (
          <HoverVideo src={fileSrc(asset.path)} active={hover} className="size-full" />
        ) : asset.kind === "image" ? (
          <img
            src={fileSrc(asset.path)}
            alt={job.prompt}
            loading="lazy"
            draggable={false}
            className="block size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-text-3">
            <PxFilm className="size-6" />
            <span className="text-xs">{asset.kind}</span>
          </div>
        )}

        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-200",
            showOverlay ? "opacity-100" : "opacity-0",
          )}
          style={{ background: "var(--media-scrim)" }}
        >
          <div className="absolute top-3 right-3 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="glass"
              size="icon"
              aria-label={fav ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={fav}
              onClick={toggleFav}
            >
              <Star className={cn("size-4", fav && "fill-accent text-accent")} />
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="glass" size="icon" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => openExternal(item)}>
                  <PxArrowUpRight /> Open in default app
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => reveal(item)}>
                  <FolderOpen /> Reveal in Finder
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copyPrompt(item)}>
                  <Copy /> Copy prompt
                </DropdownMenuItem>
                {asset.kind === "video" && (
                  <DropdownMenuItem
                    onSelect={() => {
                      addToTimeline(item);
                      toast.success("Added to timeline");
                    }}
                  >
                    <PxFilm /> Add to timeline
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="absolute inset-x-3.5 bottom-3.5 flex flex-col gap-1.5">
            <span className="truncate text-[11px] text-[var(--text-on-media-2)]">
              {metaLine(item, (v) => usd(v))}
            </span>
            {job.prompt && (
              <span className="line-clamp-2 text-xs leading-snug text-text-1">{job.prompt}</span>
            )}
            <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button size="xs" className="bg-white/15 hover:bg-white/25" onClick={() => reuse(item)}>
                Reuse
              </Button>
              <Button size="xs" className="bg-white/15 hover:bg-white/25" onClick={() => sendAsInput(item)}>
                Use as input
              </Button>
              <Button size="xs" className="bg-white/15 hover:bg-white/25" onClick={() => reveal(item)}>
                Reveal
              </Button>
            </div>
          </div>
        </div>

        {fav && !showOverlay && (
          <Star className="absolute top-3 right-3 size-4 fill-accent text-accent drop-shadow" aria-hidden />
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is removed from your library folder. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={del}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
