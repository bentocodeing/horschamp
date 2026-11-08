import { create } from "zustand";
import type { LibraryItem } from "@/lib/api";

/** Clips queued for the optional ffmpeg stitch. Lives outside Library so it survives filter changes. */
interface TimelineState {
  clips: LibraryItem[];
  add: (item: LibraryItem) => void;
  remove: (assetId: string) => void;
  move: (from: number, to: number) => void;
  clear: () => void;
}

export const useTimeline = create<TimelineState>((set) => ({
  clips: [],
  add: (item) =>
    set((s) =>
      item.asset.kind !== "video" || s.clips.some((c) => c.asset.id === item.asset.id)
        ? s
        : { clips: [...s.clips, item] },
    ),
  remove: (assetId) => set((s) => ({ clips: s.clips.filter((c) => c.asset.id !== assetId) })),
  move: (from, to) =>
    set((s) => {
      const clips = [...s.clips];
      const [c] = clips.splice(from, 1);
      clips.splice(Math.max(0, Math.min(clips.length, to)), 0, c);
      return { clips };
    }),
  clear: () => set({ clips: [] }),
}));

/** MIME type used when dragging a library card onto the timeline strip. */
export const DRAG_MIME = "application/x-studio-asset";
