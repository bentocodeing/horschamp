import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Music } from "lucide-react";
import { PxFilm, PxPlus, PxX } from "@/ui/pixel-icon";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "@/store";
import { api, type Attachment, type Model, type ModelInput } from "@/lib/api";
import {
  carryParams,
  defaultParams,
  fileKind,
  groupOf,
  humanize,
  isArrayInput,
  isMediaInput,
  mediaKind,
  PRIMARY_PARAMS,
  targetInputFor,
  validateParams,
} from "@/lib/params";
import { basename } from "@/lib/shots";
import { queueJobs } from "@/lib/queue";
import { usd } from "@/lib/format";
import { fileSrc } from "@/lib/media";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Kbd } from "@/ui/surface";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { ModelPicker } from "./ModelPicker";
import { MoreParams, ParamPill } from "./ParamControls";

const DEFAULT_MODEL = "higgsfield-ai/soul/v2/standard";
const LAST_MODEL_KEY = "studio.lastModel";

function readLastModel(): string | null {
  try {
    return localStorage.getItem(LAST_MODEL_KEY);
  } catch {
    return null;
  }
}

/** Find a sibling model that accepts the dropped media, e.g. text-to-video → image-to-video. */
function siblingFor(model: Model, kind: "image" | "video", all: Model[]): Model | undefined {
  const swaps: [string, string][] =
    kind === "image"
      ? [
          ["text-to-video", "image-to-video"],
          ["text-to-image", "edit"],
        ]
      : [
          ["text-to-video", "video-edit"],
          ["image-to-video", "video-edit"],
        ];
  for (const [a, b] of swaps) {
    if (model.id.includes(a)) {
      const m = all.find((x) => x.id === model.id.replace(a, b));
      if (m) return m;
    }
  }
  return undefined;
}

export function PromptBar() {
  const registry = useStore((s) => s.registry);
  const modelsById = useStore((s) => s.modelsById);
  const projectId = useStore((s) => s.projectId);
  const keyPresent = useStore((s) => !!s.key?.present);
  const composer = useStore((s) => s.composer);
  const models = useMemo(() => registry?.models ?? [], [registry]);

  const [modelId, setModelId] = useState<string>(() => readLastModel() ?? DEFAULT_MODEL);
  const model: Model | undefined = modelsById[modelId] ?? modelsById[DEFAULT_MODEL] ?? models[0];
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [estimate, setEstimate] = useState<{ usd: number | null; loading: boolean; note?: string }>({
    usd: null,
    loading: false,
  });
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Defaults when the registry loads or the model changes.
  const initialised = useRef<string | null>(null);
  useEffect(() => {
    if (!model || initialised.current === model.id) return;
    setParams((prev) => (initialised.current ? carryParams(prev, model) : defaultParams(model)));
    setAttachments((prev) => prev.filter((a) => model.inputs.some((i) => i.name === a.param)));
    initialised.current = model.id;
    try {
      localStorage.setItem(LAST_MODEL_KEY, model.id);
    } catch {
      /* storage unavailable */
    }
  }, [model]);

  const mediaFilled = useMemo(() => new Set(attachments.map((a) => a.param)), [attachments]);
  const promptInput = model?.inputs.find((i) => i.name === "prompt");
  const allParams = useMemo(() => (prompt ? { ...params, prompt } : params), [params, prompt]);
  const errors = useMemo(
    () => (model ? validateParams(model, allParams, mediaFilled) : {}),
    [model, allParams, mediaFilled],
  );
  const valid = Object.keys(errors).length === 0;

  const setParam = useCallback((name: string, value: unknown) => {
    setParams((p) => {
      const next = { ...p };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  }, []);

  const addFiles = useCallback(
    async (paths: string[], forced?: ModelInput) => {
      if (!model) return;
      let current = model;
      const added: Attachment[] = [];
      for (const path of paths) {
        const kind = fileKind(path);
        if (!kind) {
          toast.error(`${basename(path)}: unsupported file type`);
          continue;
        }
        const filled = new Set([...attachments, ...added].map((a) => a.param));
        let target = forced ?? targetInputFor(current, kind, filled);
        if (!target && kind !== "audio") {
          const sib = siblingFor(current, kind, models);
          if (sib) {
            current = sib;
            target = targetInputFor(sib, kind, filled);
            setModelId(sib.id);
            toast.info(`Switched to ${sib.name} to use this ${kind}.`);
          }
        }
        if (!target) {
          toast.error(`${current.name} doesn't take ${kind} input. Pick a model that does.`);
          continue;
        }
        added.push({ path, param: target.name });
      }
      if (!added.length) return;
      await api.previewAllow(added.map((a) => a.path)).catch(() => undefined);
      setAttachments((prev) => {
        // Single-value inputs get replaced; array inputs accumulate.
        const singles = new Set(
          added
            .filter((a) => !isArrayInput(current.inputs.find((i) => i.name === a.param)!))
            .map((a) => a.param),
        );
        return [...prev.filter((a) => !singles.has(a.param)), ...added];
      });
    },
    [model, models, attachments],
  );

  // Presets from "Reuse settings" / "Use as input".
  useEffect(() => {
    if (!composer) return;
    if (composer.model_id && modelsById[composer.model_id]) {
      initialised.current = composer.model_id;
      setModelId(composer.model_id);
    }
    if (composer.prompt !== undefined) setPrompt(composer.prompt);
    if (composer.params) {
      const { prompt: p, ...rest } = composer.params as Record<string, unknown> & { prompt?: string };
      setParams(rest);
      if (typeof p === "string" && composer.prompt === undefined) setPrompt(p);
    }
    if (composer.attachments) {
      setAttachments(composer.attachments);
      void api.previewAllow(composer.attachments.map((a) => a.path)).catch(() => undefined);
    }
    if (composer.inputs?.length) void addFiles(composer.inputs);
    textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer?.nonce]);

  // Drag & drop from Finder.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (useStore.getState().route !== "generate") return;
      if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        void addFiles(e.payload.paths);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [addFiles]);

  // Live estimate (free endpoint) when nothing needs uploading.
  useEffect(() => {
    if (!model || !keyPresent) return;
    if (!valid) return setEstimate({ usd: null, loading: false });
    if (attachments.length) return setEstimate({ usd: null, loading: false, note: "on generate" });
    setEstimate((e) => ({ ...e, loading: true }));
    const t = setTimeout(() => {
      api
        .jobQuote({ model_id: model.id, params: allParams, attachments: [], project_id: projectId })
        .then((q) =>
          setEstimate({ usd: q.est_usd, loading: false, note: q.estimate_error ? "unavailable" : undefined }),
        )
        .catch(() => setEstimate({ usd: null, loading: false, note: "unavailable" }));
    }, 700);
    return () => clearTimeout(t);
  }, [model, allParams, attachments.length, valid, keyPresent, projectId]);

  const pickFiles = async (forced?: ModelInput) => {
    const kind = forced ? mediaKind(forced) : undefined;
    const exts =
      kind === "video"
        ? ["mp4"]
        : kind === "audio"
          ? ["wav"]
          : ["png", "jpg", "jpeg", "webp", "gif", "mp4", "wav"];
    const sel = await open({
      multiple: !forced || isArrayInput(forced),
      filters: [{ name: "Media", extensions: exts }],
    });
    if (!sel) return;
    await addFiles(Array.isArray(sel) ? sel : [sel], forced);
  };

  const generate = async () => {
    if (!model || busy) return;
    if (!valid) {
      const [k, v] = Object.entries(errors)[0];
      toast.error(`${humanize(k)} ${v}`);
      return;
    }
    setBusy(true);
    try {
      await queueJobs([
        {
          label: `${model.name}${prompt ? ` · ${prompt.slice(0, 60)}` : ""}`,
          req: { model_id: model.id, params: allParams, attachments, project_id: projectId },
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!model) return null;
  const primary = model.inputs
    .filter((i) => groupOf(i) === "primary")
    .sort((a, b) => PRIMARY_PARAMS.indexOf(a.name) - PRIMARY_PARAMS.indexOf(b.name));
  const needsMedia = model.inputs.filter((i) => isMediaInput(i) && i.required && !mediaFilled.has(i.name));

  return (
    <div className="relative z-10 flex justify-center px-6 pb-6">
      <motion.div
        layout
        className={cn(
          "glass relative flex w-full max-w-[860px] flex-col gap-3 rounded-3xl p-3.5 transition-shadow duration-200",
          dragging && "shadow-[var(--sh-popover),inset_0_0_0_2px_var(--accent),var(--glow-accent)]",
        )}
      >
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-3xl bg-[rgba(15,17,19,.7)] font-display font-bold uppercase text-accent"
            >
              Drop to attach
            </motion.div>
          )}
        </AnimatePresence>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {attachments.map((a, idx) => (
                <motion.div
                  key={`${a.param}-${a.path}-${idx}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  className="group flex h-[52px] items-center gap-2 rounded-md bg-fill-1 pr-2 shadow-[var(--rim)]"
                >
                  <Thumb path={a.path} />
                  <div className="flex min-w-0 flex-col">
                    <span className="max-w-[140px] truncate text-xs text-text-1">{basename(a.path)}</span>
                    <span className="text-[11px] text-text-3">{humanize(a.param)}</span>
                  </div>
                  <button
                    aria-label={`Remove ${basename(a.path)}`}
                    className="grid size-5 place-items-center rounded text-text-3 hover:bg-fill-2 hover:text-text-1"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <PxX className="size-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        <label htmlFor="prompt" className="sr-only">
          Prompt
        </label>
        <textarea
          id="prompt"
          ref={textRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void generate();
            }
          }}
          maxLength={promptInput?.maxLength}
          rows={2}
          disabled={!promptInput}
          placeholder={
            promptInput
              ? needsMedia.length
                ? `Describe the shot… and drop ${needsMedia.map((i) => humanize(i.name).toLowerCase()).join(", ")}`
                : "Describe the shot… drop images or videos here"
              : "This model takes no prompt. Attach inputs and set parameters."
          }
          className="field-sizing-content max-h-48 min-h-11 resize-none bg-transparent px-1 text-[15px] leading-6 text-text-1 outline-none placeholder:text-text-3 focus-visible:shadow-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Attach file"
                onClick={() => void pickFiles()}
              >
                <PxPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach image, video or audio</TooltipContent>
          </Tooltip>
          <ModelPicker models={models} value={model.id} onChange={setModelId} />
          {primary.map((i) => (
            <ParamPill key={`${model.id}-${i.name}`} input={i} value={params[i.name]} onChange={setParam} />
          ))}
          <MoreParams
            model={model}
            params={params}
            onChange={setParam}
            errors={errors}
            onAttach={(i) => void pickFiles(i)}
            mediaFilled={mediaFilled}
          />
          <span className="ml-auto text-xs tabular-nums text-text-2" aria-live="polite">
            {!keyPresent
              ? "add API key"
              : estimate.loading
                ? "estimating…"
                : estimate.usd !== null
                  ? `est. ${usd(estimate.usd)}`
                  : estimate.note
                    ? `est. ${estimate.note}`
                    : ""}
          </span>
          <Button
            variant="default"
            size="lg"
            onClick={() => void generate()}
            disabled={busy || !valid}
            className="gap-2.5"
          >
            Generate <Kbd>⌘↵</Kbd>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function Thumb({ path }: { path: string }) {
  const kind = fileKind(path);
  if (kind === "image")
    return <img src={fileSrc(path)} alt="" className="size-[52px] rounded-md object-cover" />;
  return (
    <div className="grid size-[52px] place-items-center rounded-md bg-surface-3 text-text-2">
      {kind === "video" ? <PxFilm className="size-5" /> : <Music className="size-5" />}
    </div>
  );
}
