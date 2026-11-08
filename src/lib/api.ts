// Typed wrappers over Tauri commands. The webview never receives API keys:
// key commands only take a value in (paste) and return a masked hint.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { JobStatus } from "@/ui/status-badge";

export interface AppError {
  code: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as AppError).message);
  return String(e);
}
export function errorCode(e: unknown): string | undefined {
  return e && typeof e === "object" && "code" in e ? String((e as AppError).code) : undefined;
}

// ---- registry ----
export interface ModelInput {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
  description: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
}
export interface Model {
  id: string;
  name: string;
  /** image | text-to-video | image-to-video | video-to-video | other */
  category: string;
  description: string;
  inputs: ModelInput[];
  output?: { type: string; format?: string };
  cost?: { usd: number | null; notes?: string };
  source_url?: string;
  verified: boolean;
}
export interface Registry {
  generated_at?: string;
  source?: string;
  models: Model[];
}
export interface RegistryDiff {
  added: string[];
  removed: string[];
  changed: [string, string][];
}
export interface Issue {
  param: string;
  message: string;
}

// ---- jobs ----
export interface Attachment {
  path: string;
  param: string;
  public_url?: string | null;
}
export interface Asset {
  id: string;
  job_id: string;
  project_id: string | null;
  kind: "image" | "video" | "audio" | "file";
  path: string;
  remote_url: string | null;
  favorite: boolean;
  created_at: string;
}
export interface Job {
  id: string;
  project_id: string | null;
  model_id: string;
  model_name: string;
  category: string;
  prompt: string;
  params: Record<string, unknown>;
  attachments: Attachment[];
  status: JobStatus;
  request_id: string | null;
  idempotency_key: string;
  est_usd: number | null;
  cost_usd: number | null;
  error: string | null;
  source: string;
  brief_id: string | null;
  shot_index: number | null;
  retry_of: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  assets: Asset[];
}
export interface JobRequest {
  model_id: string;
  params: Record<string, unknown>;
  attachments: Attachment[];
  project_id?: string | null;
  source?: string;
  brief_id?: string | null;
  shot_index?: number | null;
  retry_of?: string | null;
}
export interface Quote {
  est_usd: number | null;
  estimate_error: string | null;
  needs_confirm: boolean;
  threshold_usd: number;
  issues: Issue[];
}
export interface Project {
  id: string;
  name: string;
  created_at: string;
}
export interface LibraryFilter {
  kind?: string | null;
  project_id?: string | null;
  model_id?: string | null;
  favorites?: boolean;
  search?: string | null;
  since?: string | null;
  limit?: number;
}
export interface LibraryItem {
  asset: Asset;
  job: Job;
}

// ---- briefs ----
export interface Shot {
  title: string;
  model_id: string;
  params: Record<string, unknown>;
  why: string;
  cheaper?: string | null;
  better?: string | null;
  needs: string[];
  notes?: string | null;
  issues: Issue[];
  model_name?: string | null;
}
export interface Brief {
  id: string;
  project_id: string | null;
  title: string;
  session_id: string | null;
  backend: string | null;
  shots: Shot[];
  director_cost_usd: number;
  created_at: string;
  updated_at: string;
}
export interface BriefMessage {
  id: string;
  brief_id: string;
  role: "user" | "assistant" | "system" | "error";
  text: string;
  attachments: string[];
  created_at: string;
}
export type DirectorEvent =
  | { type: "start"; brief_id: string; backend: string }
  | { type: "delta"; brief_id: string; text: string }
  | { type: "tool"; brief_id: string; name: string; detail: string }
  | { type: "done"; brief_id: string; text: string; shots: Shot[]; cost_usd: number }
  | { type: "error"; brief_id: string; message: string };
export interface DirectorStatus {
  cli_installed: boolean;
  cli_path: string | null;
  cli_version: string | null;
  cli_logged_in: boolean;
  cli_auth_method: string | null;
  api_key_present: boolean;
  backend: "claude-cli" | "anthropic-api" | null;
  prompt_path: string;
}

// ---- settings ----
export interface KeyStatus {
  present: boolean;
  hint: string | null;
  anthropic_present: boolean;
}
export interface KeyTest {
  ok: boolean;
  message: string;
}
export interface Spending {
  starting_balance_usd: number | null;
  balance_set_at: string | null;
  usage_spent_usd: number | null;
  usage_synced_at: string | null;
  local_spent_usd: number;
  remaining_est_usd: number | null;
  threshold_usd: number;
  director_spent_usd: number;
}
export type Settings = Record<string, string>;

export const api = {
  keyStatus: () => invoke<KeyStatus>("key_status"),
  keySet: (value: string) => invoke<KeyTest>("key_set", { value }),
  keyTest: () => invoke<KeyTest>("key_test"),
  keyDelete: () => invoke<void>("key_delete"),
  anthropicKeySet: (value: string) => invoke<void>("anthropic_key_set", { value }),
  anthropicKeyDelete: () => invoke<void>("anthropic_key_delete"),

  modelsList: () => invoke<Registry>("models_list"),
  modelsPreviewImport: (path: string) => invoke<RegistryDiff>("models_preview_import", { path }),
  modelsApplyImport: (path: string) => invoke<RegistryDiff>("models_apply_import", { path }),
  modelsReset: () => invoke<void>("models_reset"),

  projects: () => invoke<Project[]>("projects_list"),
  projectCreate: (name: string) => invoke<Project>("project_create", { name }),
  projectRename: (id: string, name: string) => invoke<void>("project_rename", { id, name }),
  projectDelete: (id: string) => invoke<void>("project_delete", { id }),

  jobQuote: (req: JobRequest) => invoke<Quote>("job_quote", { req }),
  jobSubmit: (req: JobRequest, confirmedUsd: number | null) =>
    invoke<Job>("job_submit", { req, confirmedUsd }),
  jobs: (projectId: string | null, limit = 100) => invoke<Job[]>("jobs_list", { projectId, limit }),
  job: (id: string) => invoke<Job>("job_get", { id }),
  jobCancel: (id: string) => invoke<string>("job_cancel", { id }),
  jobDelete: (id: string) => invoke<void>("job_delete", { id }),

  library: (filter: LibraryFilter) => invoke<LibraryItem[]>("library_list", { filter }),
  assetFavorite: (id: string, favorite: boolean) => invoke<void>("asset_favorite", { id, favorite }),
  assetDelete: (id: string) => invoke<void>("asset_delete", { id }),
  assetReveal: (id: string) => invoke<void>("asset_reveal", { id }),
  assetOpen: (id: string) => invoke<void>("asset_open", { id }),
  previewAllow: (paths: string[]) => invoke<void>("preview_allow", { paths }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),

  settings: () => invoke<Settings>("settings_get"),
  settingSet: (key: string, value: string) => invoke<void>("settings_set", { key, value }),
  spending: () => invoke<Spending>("spending_summary"),
  usageSync: () => invoke<{ total_usd: number; by_model: Record<string, number> }>("usage_sync"),
  /** Writes all jobs to a CSV file; returns how many were written. */
  spendingExportCsv: (outPath: string) => invoke<number>("spending_export_csv", { outPath }),
  backupsReveal: () => invoke<void>("backups_reveal"),

  directorStatus: () => invoke<DirectorStatus>("director_status"),
  directorPromptOpen: () => invoke<void>("director_prompt_open"),
  directorPromptReset: () => invoke<void>("director_prompt_reset"),
  briefs: (projectId: string | null) => invoke<Brief[]>("briefs_list", { projectId }),
  briefCreate: (projectId: string | null, title: string) =>
    invoke<Brief>("brief_create", { projectId, title }),
  brief: (id: string) =>
    invoke<{ brief: Brief; messages: BriefMessage[]; busy: boolean }>("brief_get", { id }),
  briefSend: (id: string, text: string, attachments: string[]) =>
    invoke<void>("brief_send", { id, text, attachments }),
  briefCancel: (id: string) => invoke<void>("brief_cancel", { id }),
  briefRename: (id: string, title: string) => invoke<void>("brief_rename", { id, title }),
  briefDelete: (id: string) => invoke<void>("brief_delete", { id }),
  briefSetShots: (id: string, shots: Shot[]) => invoke<Shot[]>("brief_set_shots", { id, shots }),

  ffmpegStatus: () => invoke<{ available: boolean; path: string | null }>("ffmpeg_status"),
  ffmpegInstall: () => invoke<{ available: boolean; path: string | null }>("ffmpeg_install"),
  timelineExport: (assetIds: string[], outPath: string) =>
    invoke<string>("timeline_export", { assetIds, outPath }),
};

export const events = {
  onJob: (cb: (j: Job) => void): Promise<UnlistenFn> => listen<Job>("job://update", (e) => cb(e.payload)),
  onDirector: (cb: (e: DirectorEvent) => void): Promise<UnlistenFn> =>
    listen<DirectorEvent>("director://event", (e) => cb(e.payload)),
};
