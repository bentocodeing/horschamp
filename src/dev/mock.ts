// Dev-only fake backend for checking the UI in a plain browser (`pnpm dev`, then open
// http://localhost:1430). Never bundled into the app: main.tsx only imports it when
// import.meta.env.DEV is true and the page is not running inside Tauri.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import registry from "../../models.json";
import type { Asset, Brief, BriefMessage, Job, LibraryItem, Project } from "@/lib/api";

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

/** A soft gradient as an image, so cards have something to show. */
function swatch(a: string, b: string, w = 768, h = 1024): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Starts missing so the "Install ffmpeg" button in Settings can be tried.
const FFMPEG_PATH = "/opt/homebrew/bin/ffmpeg";
let ffmpegInstalled = false;

const projects: Project[] = [
  { id: "p1", name: "Granola promo", created_at: iso(5000) },
  { id: "p2", name: "Moodboards", created_at: iso(9000) },
];

function job(over: Partial<Job> & Pick<Job, "id" | "model_id" | "prompt" | "status">): Job {
  const model = registry.models.find((m) => m.id === over.model_id);
  return {
    project_id: "p1",
    model_name: model?.name ?? over.model_id,
    category: model?.category ?? "image",
    params: { prompt: over.prompt },
    attachments: [],
    request_id: "req_" + over.id,
    idempotency_key: "idem_" + over.id,
    est_usd: 0.12,
    cost_usd: null,
    error: null,
    source: "generate",
    brief_id: null,
    shot_index: null,
    retry_of: null,
    created_at: iso(30),
    updated_at: iso(29),
    finished_at: null,
    assets: [],
    ...over,
  };
}

function asset(id: string, jobId: string, path: string, minAgo: number, favorite = false): Asset {
  return {
    id,
    job_id: jobId,
    project_id: "p1",
    kind: "image",
    path,
    remote_url: null,
    favorite,
    created_at: iso(minAgo),
  };
}

const colors = [
  ["#3b2f2a", "#c49a6c"],
  ["#1e2a33", "#6d8fa6"],
  ["#2a2233", "#a47cc2"],
  ["#22301f", "#9fbf6a"],
  ["#33241e", "#e0875a"],
  ["#1f2b2b", "#5fb3a8"],
];

const jobs: Job[] = [
  job({
    id: "j3",
    model_id: "kling-video/v3.0/pro/image-to-video",
    prompt:
      "Slow push-in on a ceramic coffee cup on a wooden table, morning light through linen curtains, steam rising",
    status: "running",
    params: { prompt: "", duration: 5, aspect_ratio: "16:9" },
    est_usd: 0.84,
    created_at: iso(1),
  }),
  job({
    id: "j2",
    model_id: "higgsfield-ai/soul/v2/standard",
    prompt: "Granola pack on linen, top-down, soft window light, crumbs scattered",
    status: "completed",
    params: { prompt: "", aspect_ratio: "3:4", batch_size: 4 },
    est_usd: 0.09,
    cost_usd: 0.09,
    finished_at: iso(12),
    created_at: iso(14),
  }),
  job({
    id: "j1",
    model_id: "higgsfield-ai/soul/v2/standard",
    prompt: "Editorial portrait in a neon-lit noodle bar, rain on the window",
    status: "failed",
    error: "Generation failed upstream. Credits were refunded.",
    cost_usd: 0,
    finished_at: iso(40),
    created_at: iso(42),
  }),
];
jobs[1].assets = colors.slice(0, 4).map(([a, b], i) => asset(`a${i}`, "j2", swatch(a, b), 12, i === 1));

const extra: LibraryItem[] = colors.slice(4).map(([c1, c2], i) => {
  const j = job({
    id: `jx${i}`,
    model_id: "higgsfield-ai/soul/cinema",
    prompt: i
      ? "Aerial shot over terraced rice fields at sunrise"
      : "Hands pouring milk into a stoneware bowl",
    status: "completed",
    cost_usd: 0.06,
    finished_at: iso(300 + i),
  });
  const a = asset(`ax${i}`, j.id, swatch(c1, c2, 1024, 576), 300 + i);
  j.assets = [a];
  return { asset: a, job: j };
});

const briefs: Brief[] = [
  {
    id: "b1",
    project_id: "p1",
    title: "Launch teaser 15s",
    session_id: "s1",
    backend: "claude-cli",
    director_cost_usd: 0,
    created_at: iso(200),
    updated_at: iso(20),
    shots: [
      {
        title: "Oats pour, macro",
        model_id: "kling-video/v3.0/pro/text-to-video",
        params: {
          prompt:
            "Macro shot, golden oats and almonds pouring into a stoneware bowl, warm window light, slow motion",
          duration: 5,
          aspect_ratio: "9:16",
        },
        why: "Strong with fluid, physical motion.",
        cheaper: "kling-video/v3.0/std/text-to-video",
        better: null,
        needs: [],
        issues: [],
      },
      {
        title: "Pack reveal",
        model_id: "kling-video/v3.0/pro/image-to-video",
        params: {
          prompt: "The pack rotates slowly on linen, soft light",
          duration: 5,
          image_url: "@pack.png",
        },
        why: "Starts from your pack still so the label stays consistent.",
        needs: ["pack.png"],
        issues: [],
      },
    ],
  },
];
const messages: BriefMessage[] = [
  {
    id: "m1",
    brief_id: "b1",
    role: "user",
    text: "15s teaser for our new granola. Cozy, warm, Instagram Reels.",
    attachments: [],
    created_at: iso(200),
  },
  {
    id: "m2",
    brief_id: "b1",
    role: "assistant",
    text: "A few questions first so I don't waste credits:\n\n1. Should the pack be the hero of every shot, or only the last one?\n2. Any on-screen text? I'd add it in the edit.\n3. Real people in frame, or hands only?",
    attachments: [],
    created_at: iso(199),
  },
  {
    id: "m3",
    brief_id: "b1",
    role: "user",
    text: "Pack only at the end, text in the edit, hands only.",
    attachments: [],
    created_at: iso(30),
  },
  {
    id: "m4",
    brief_id: "b1",
    role: "assistant",
    text: "Here's a 2-shot list. Shot 2 starts from your pack still so the label stays consistent.",
    attachments: [],
    created_at: iso(29),
  },
];

const settings: Record<string, string> = {
  confirm_over_usd: "0",
  starting_balance_usd: "1000",
  library_dir: "~/Movies/Horschamp Library",
};

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  key_status: () => ({ present: true, hint: "••••a1b2", anthropic_present: false }),
  key_test: () => ({ ok: true, message: "Key works." }),
  key_set: ({ value }) =>
    /^[^:\s]+:\S+$/.test(String(value))
      ? { ok: true, message: "Key accepted by Higgsfield." }
      : { ok: false, message: "Higgsfield rejected this key (401)." },
  models_list: () => registry,
  projects_list: () => projects,
  jobs_list: () => jobs,
  job_quote: () => ({
    est_usd: 0.12,
    estimate_error: null,
    needs_confirm: true,
    threshold_usd: 0,
    issues: [],
  }),
  library_list: () => [...jobs.flatMap((j) => j.assets.map((a) => ({ asset: a, job: j }))), ...extra],
  settings_get: () => settings,
  settings_set: ({ key, value }) => void (settings[key as string] = value as string),
  spending_summary: () => ({
    starting_balance_usd: 1000,
    balance_set_at: iso(10000),
    usage_spent_usd: 41.37,
    usage_synced_at: iso(60),
    local_spent_usd: 38.9,
    remaining_est_usd: 958.63,
    threshold_usd: 0,
    director_spent_usd: 0,
  }),
  director_status: () => ({
    cli_installed: true,
    cli_path: "/usr/local/bin/claude",
    cli_version: "2.1.0",
    cli_logged_in: true,
    cli_auth_method: "subscription",
    api_key_present: false,
    backend: "claude-cli",
    prompt_path: "~/Library/Application Support/app.horschamp.desktop/director.md",
  }),
  briefs_list: () => briefs,
  brief_get: ({ id }) => ({ brief: briefs.find((b) => b.id === id) ?? briefs[0], messages, busy: false }),
  ffmpeg_status: () => ({ available: ffmpegInstalled, path: ffmpegInstalled ? FFMPEG_PATH : null }),
  ffmpeg_install: async () => {
    await new Promise((r) => setTimeout(r, 2500));
    ffmpegInstalled = true;
    return { available: true, path: FFMPEG_PATH };
  },
  "plugin:event|listen": () => 0,
  "plugin:event|unlisten": () => undefined,
};

export function installMock() {
  mockWindows("main");
  mockIPC((cmd, args) => {
    const h = handlers[cmd];
    if (h) return h((args ?? {}) as Record<string, unknown>);
    console.warn("[mock] unhandled command", cmd, args);
    return null;
  });
  console.warn("[mock] fake backend installed — no real API calls are made");
}
