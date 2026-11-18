import { create } from "zustand";
import {
  api,
  type Attachment,
  type Job,
  type KeyStatus,
  type Model,
  type Project,
  type Quote,
  type Registry,
  type Spending,
  type Thread,
} from "@/lib/api";

export type Route = "generate" | "brief" | "library" | "settings" | "design";

/** Values pushed into the Generate composer by "Reuse settings" / "Use as input". */
export interface ComposerPreset {
  model_id?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  attachments?: Attachment[];
  /** Files to add as inputs (paths); the composer routes them to matching inputs. */
  inputs?: string[];
  nonce: number;
}

export interface ConfirmRequest {
  title: string;
  lines: { label: string; usd: number | null; note?: string }[];
  quote: Quote;
  resolve: (ok: boolean) => void;
}

interface State {
  route: Route;
  projectId: string | null;
  projects: Project[];
  registry: Registry | null;
  modelsById: Record<string, Model>;
  key: KeyStatus | null;
  spending: Spending | null;
  jobs: Record<string, Job>;
  /** Generate conversations, newest activity first. */
  threads: Thread[];
  /** Open conversation; null shows jobs made outside any conversation. */
  threadId: string | null;
  composer: ComposerPreset | null;
  briefSeed: { text: string; attachments: string[]; nonce: number } | null;
  activeBriefId: string | null;
  confirm: ConfirmRequest | null;

  setRoute: (r: Route) => void;
  setProject: (id: string | null) => void;
  init: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadJobs: () => Promise<void>;
  loadThreads: () => Promise<void>;
  openThread: (id: string | null) => void;
  /** Open an empty conversation, reusing the current one if it has no jobs yet. */
  newThread: () => Promise<string>;
  renameThread: (id: string, title: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  refreshKey: () => Promise<void>;
  refreshSpending: () => Promise<void>;
  upsertJob: (j: Job) => void;
  removeJob: (id: string) => void;
  presetComposer: (p: Omit<ComposerPreset, "nonce">) => void;
  sendToBrief: (text: string, attachments: string[]) => void;
  setActiveBrief: (id: string | null) => void;
  askConfirm: (c: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
}

export const useStore = create<State>((set, get) => ({
  route: "generate",
  projectId: null,
  projects: [],
  registry: null,
  modelsById: {},
  key: null,
  spending: null,
  jobs: {},
  threads: [],
  threadId: null,
  composer: null,
  briefSeed: null,
  activeBriefId: null,
  confirm: null,

  setRoute: (route) => set({ route }),
  setProject: (projectId) => {
    set({ projectId });
    void get()
      .loadThreads()
      .then(() => set({ threadId: get().threads[0]?.id ?? null }))
      .then(() => get().loadJobs());
  },
  init: async () => {
    await Promise.all([
      get().loadModels(),
      get().loadProjects(),
      get().refreshKey(),
      get().refreshSpending(),
    ]);
    await get().loadThreads();
    set({ threadId: get().threads[0]?.id ?? null });
    await get().loadJobs();
  },
  loadProjects: async () => set({ projects: await api.projects() }),
  loadModels: async () => {
    const registry = await api.modelsList();
    set({ registry, modelsById: Object.fromEntries(registry.models.map((m) => [m.id, m])) });
  },
  loadJobs: async () => {
    const { threadId, projectId } = get();
    const list = await api.threadJobs(threadId, projectId, 200);
    if (get().threadId !== threadId) return;
    set({ jobs: Object.fromEntries(list.map((j) => [j.id, j])) });
  },
  loadThreads: async () => set({ threads: await api.threads(get().projectId) }),
  openThread: (threadId) => {
    set({ threadId, jobs: {} });
    void get().loadJobs();
  },
  newThread: async () => {
    const { threadId, threads, jobs } = get();
    const current = threads.find((t) => t.id === threadId);
    if (current && !current.title && Object.keys(jobs).length === 0) return current.id;
    const t = await api.threadCreate(get().projectId);
    set((s) => ({ threads: [t, ...s.threads] }));
    get().openThread(t.id);
    return t.id;
  },
  renameThread: async (id, title) => {
    await api.threadRename(id, title);
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, title } : t)) }));
  },
  deleteThread: async (id) => {
    await api.threadDelete(id);
    const threads = get().threads.filter((t) => t.id !== id);
    set({ threads });
    if (get().threadId === id) get().openThread(threads[0]?.id ?? null);
  },
  refreshKey: async () => set({ key: await api.keyStatus() }),
  refreshSpending: async () => set({ spending: await api.spending() }),
  upsertJob: (j) => {
    const { projectId, threadId, threads } = get();
    if (j.thread_id && !threads.some((t) => t.id === j.thread_id && t.job_count > 0)) {
      // First job of a conversation: refresh so it gets its title and moves to the top.
      void get().loadThreads();
    }
    if (projectId && j.project_id !== projectId) return;
    if ((j.thread_id ?? null) !== threadId) return;
    set((s) => ({ jobs: { ...s.jobs, [j.id]: j } }));
    if (j.status === "completed" || j.status === "failed" || j.status === "canceled" || j.status === "nsfw") {
      void get().refreshSpending();
    }
  },
  removeJob: (id) =>
    set((s) => {
      const jobs = { ...s.jobs };
      delete jobs[id];
      return { jobs };
    }),
  presetComposer: (p) => set({ composer: { ...p, nonce: Date.now() }, route: "generate" }),
  sendToBrief: (text, attachments) =>
    set({ briefSeed: { text, attachments, nonce: Date.now() }, route: "brief" }),
  setActiveBrief: (activeBriefId) => set({ activeBriefId }),
  askConfirm: (c) =>
    new Promise<boolean>((resolve) => {
      set({
        confirm: {
          ...c,
          resolve: (ok) => {
            set({ confirm: null });
            resolve(ok);
          },
        },
      });
    }),
}));
