import { create } from "zustand";
import { api, type Brief } from "@/lib/api";

/** Brief list shared by the sidebar list and the Brief screen. */
export const useBriefs = create<{
  list: Brief[];
  loaded: boolean;
  load: (projectId: string | null) => Promise<Brief[]>;
}>((set) => ({
  list: [],
  loaded: false,
  load: async (projectId) => {
    const list = await api.briefs(projectId);
    set({ list, loaded: true });
    return list;
  },
}));
