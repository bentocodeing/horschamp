import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Globe, Loader2, Trash2, Wand2 } from "lucide-react";
import { PxChat, PxPlus, PxSparkle } from "@/ui/pixel-icon";
import { toast } from "sonner";
import { useStore } from "@/store";
import {
  api,
  errorMessage,
  events,
  type Brief as BriefT,
  type BriefMessage,
  type DirectorStatus,
  type Shot,
} from "@/lib/api";
import { usd } from "@/lib/format";
import { queueJobs } from "@/lib/queue";
import { basename, shotToRequest } from "@/lib/shots";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Input } from "@/ui/input";
import { useBriefs } from "@/components/brief/briefStore";
import { BriefComposer } from "@/components/brief/BriefComposer";
import { Markdown, stripShotList } from "@/components/brief/Markdown";
import { ShotCard } from "@/components/brief/ShotCard";
import { ShotEditDialog } from "@/components/brief/ShotEditDialog";

// ---------- sidebar list ----------

export function BriefList() {
  const projectId = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeBriefId);
  const setActive = useStore((s) => s.setActiveBrief);
  const { list, load } = useBriefs();

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  const create = async () => {
    try {
      const b = await api.briefCreate(projectId, "Untitled brief");
      await load(projectId);
      setActive(b.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const projectName = projects.find((p) => p.id === projectId)?.name;

  return (
    <>
      <div className="eyebrow mt-5 mb-1 truncate px-2.5">Briefs{projectName ? ` · ${projectName}` : ""}</div>
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {list.map((b) => (
          <button
            key={b.id}
            onClick={() => setActive(b.id)}
            className={cn(
              "flex h-8 shrink-0 items-center truncate rounded-md px-2.5 text-left text-[13px] text-text-2 hover:bg-fill-1 hover:text-text-1",
              activeId === b.id && "bg-fill-1 text-text-1",
            )}
          >
            <span className="truncate">{b.title}</span>
          </button>
        ))}
        <button
          onClick={create}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] text-text-3 hover:bg-fill-1 hover:text-text-1"
        >
          <PxPlus className="size-3.5" /> New brief
        </button>
      </div>
    </>
  );
}

// ---------- screen ----------

interface Live {
  text: string;
  tools: { name: string; detail: string }[];
}

function toolLabel(name: string, detail: string): string {
  const n = name.toLowerCase();
  if (n.includes("search")) return `Searching: ${detail}`;
  if (n.includes("fetch")) return `Reading ${detail}`;
  if (n === "read") return `Reading ${basename(detail)}`;
  if (n === "validate") return "Checking params against the model schemas…";
  return detail ? `${name}: ${detail}` : name;
}

export default function Brief() {
  const projectId = useStore((s) => s.projectId);
  const activeId = useStore((s) => s.activeBriefId);
  const setActive = useStore((s) => s.setActiveBrief);
  const seed = useStore((s) => s.briefSeed);
  const modelsById = useStore((s) => s.modelsById);
  const setRoute = useStore((s) => s.setRoute);
  const { list, loaded, load } = useBriefs();

  const [status, setStatus] = useState<DirectorStatus | null>(null);
  const [brief, setBrief] = useState<BriefT | null>(null);
  const [messages, setMessages] = useState<BriefMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [seedForComposer, setSeedForComposer] = useState<typeof seed>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledSeed = useRef<number | null>(null);

  useEffect(() => {
    api
      .directorStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Pick the most recent brief when none is active.
  useEffect(() => {
    if (!loaded || activeId || seed) return;
    if (list[0]) setActive(list[0].id);
  }, [loaded, list, activeId, seed, setActive]);

  const reload = useCallback(async (id: string) => {
    const r = await api.brief(id);
    setBrief(r.brief);
    setMessages(r.messages);
    setBusy(r.busy);
    if (!r.busy) setLive(null);
  }, []);

  useEffect(() => {
    setLive(null);
    if (!activeId) {
      setBrief(null);
      setMessages([]);
      return;
    }
    reload(activeId).catch((e) => {
      toast.error(errorMessage(e));
      setActive(null);
    });
  }, [activeId, reload, setActive]);

  // "Send to Brief" from Generate/Library.
  useEffect(() => {
    if (!seed || handledSeed.current === seed.nonce) return;
    handledSeed.current = seed.nonce;
    void (async () => {
      if (!useStore.getState().activeBriefId) {
        const b = await api.briefCreate(projectId, "Feedback on results");
        await load(projectId);
        setActive(b.id);
      }
      setSeedForComposer(seed);
    })().catch((e) => toast.error(errorMessage(e)));
  }, [seed, projectId, load, setActive]);

  // Director stream.
  useEffect(() => {
    const un = events.onDirector((e) => {
      if (e.brief_id !== useStore.getState().activeBriefId) {
        if (e.type === "done" || e.type === "error") void load(useStore.getState().projectId);
        return;
      }
      switch (e.type) {
        case "start":
          setBusy(true);
          setLive({ text: "", tools: [] });
          break;
        case "delta":
          setLive((l) => ({ text: (l?.text ?? "") + e.text, tools: l?.tools ?? [] }));
          break;
        case "tool":
          setLive((l) => ({
            text: l?.text ?? "",
            tools: [...(l?.tools ?? []), { name: e.name, detail: e.detail }],
          }));
          break;
        case "done":
        case "error":
          if (e.type === "error") toast.error(e.message);
          setBusy(false);
          void reload(e.brief_id);
          void load(useStore.getState().projectId);
          break;
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [reload, load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, live?.text, live?.tools.length]);

  const briefFiles = useMemo(
    () => messages.filter((m) => m.role === "user").flatMap((m) => m.attachments),
    [messages],
  );
  const shots: Shot[] = useMemo(() => brief?.shots ?? [], [brief]);

  const resolved = useMemo(
    () =>
      shots.map((s, i) => {
        const model = modelsById[s.model_id];
        if (!model || !brief) return { req: null, missing: [] as string[] };
        return shotToRequest(s, model, briefFiles, {
          projectId: brief.project_id ?? projectId,
          briefId: brief.id,
          index: i,
        });
      }),
    [shots, modelsById, briefFiles, brief, projectId],
  );

  const send = async (text: string, attachments: string[]) => {
    let id = activeId;
    try {
      if (!id) {
        const b = await api.briefCreate(projectId, text.slice(0, 40));
        await load(projectId);
        setActive(b.id);
        id = b.id;
      }
      // Name an untitled brief after its first message.
      if (brief && brief.title === "Untitled brief" && messages.length === 0) {
        await api.briefRename(id, text.split("\n")[0].slice(0, 48));
        void load(projectId);
      }
      await api.briefSend(id, text, attachments);
      setBusy(true);
      setLive({ text: "", tools: [] });
      await reload(id);
      setBusy(true);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const queue = async (indices: number[]) => {
    if (!brief) return;
    for (const i of indices) {
      const s = shots[i];
      if (s.issues.length) return toast.error(`${s.title}: fix the invalid params first.`);
      if (resolved[i].missing.length)
        return toast.error(`${s.title}: attach ${resolved[i].missing.join(", ")} in this brief first.`);
      if (!resolved[i].req) return toast.error(`${s.title}: unknown model ${s.model_id}.`);
    }
    setQueueing(true);
    try {
      const jobs = await queueJobs(
        indices.map((i) => ({ label: shots[i].title || `Shot ${i + 1}`, req: resolved[i].req! })),
        indices.length > 1 ? `Queue ${indices.length} shots?` : "Queue this shot?",
      );
      if (jobs.length)
        toast("Shots are rendering", {
          action: { label: "View in Generate", onClick: () => setRoute("generate") },
        });
    } finally {
      setQueueing(false);
    }
  };

  const saveShot = async (index: number, s: Shot) => {
    if (!brief) return;
    const next = shots.map((x, i) => (i === index ? s : x));
    const saved = await api.briefSetShots(brief.id, next);
    setBrief({ ...brief, shots: saved });
    const issues = saved[index]?.issues ?? [];
    if (issues.length)
      toast.warning(`Saved, but ${issues.length} param issue${issues.length > 1 ? "s" : ""} remain.`);
    else toast.success("Shot updated");
  };

  const removeBrief = async () => {
    if (!brief) return;
    await api.briefDelete(brief.id);
    setActive(null);
    const l = await load(projectId);
    if (l[0]) setActive(l[0].id);
  };

  const noDirector = status !== null && status.backend === null;

  if (!activeId || !brief) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex max-w-md flex-col items-center gap-5 text-center"
        >
          <div className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-a15)] text-accent shadow-[var(--glow-accent)]">
            <Wand2 className="size-6" />
          </div>
          <h1 className="heading text-[28px]">Brief the director</h1>
          <p className="text-text-2">
            Describe what you want to make and drop in references. Claude asks a few questions, researches the
            models, then writes a shot list you can queue with one click. Nothing is spent until you confirm
            the cost.
          </p>
          {noDirector && <NoDirector onSettings={() => setRoute("settings")} />}
          <Button
            variant="default"
            size="xl"
            onClick={async () => {
              const b = await api.briefCreate(projectId, "Untitled brief");
              await load(projectId);
              setActive(b.id);
            }}
          >
            <PxPlus /> New brief
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col border-r border-subtle">
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-subtle px-7 pt-2">
          <TitleEditor
            title={brief.title}
            onSave={async (t) => {
              await api.briefRename(brief.id, t);
              setBrief({ ...brief, title: t });
              void load(projectId);
            }}
          />
          <div className="no-drag flex items-center gap-2">
            <BackendChip brief={brief} status={status} onSettings={() => setRoute("settings")} />
            <Button variant="ghost" size="icon-sm" aria-label="Delete brief" onClick={removeBrief}>
              <Trash2 />
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-10 py-7">
          {messages.length === 0 && !live && (
            <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center text-text-2">
              <PxChat className="size-6 text-text-3" />
              <p>
                Tell the director what you're making: product, platform, length, mood. Attach a pack shot or
                mood board if you have one.
              </p>
              {noDirector && <NoDirector onSettings={() => setRoute("settings")} />}
            </div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <MessageView key={m.id} m={m} />
            ))}
          </AnimatePresence>
          {live && (
            <div className="flex max-w-[640px] flex-col gap-2.5">
              <DirectorLabel>{live.tools.length ? "Director · working" : "Director"}</DirectorLabel>
              {live.tools.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-text-2">
                  {i === live.tools.length - 1 && !live.text ? (
                    <Loader2 className="size-3 animate-spin text-accent" />
                  ) : (
                    <Globe className="size-3 text-text-3" />
                  )}
                  <span className="truncate">{toolLabel(t.name, t.detail)}</span>
                </div>
              ))}
              {live.text ? (
                <Markdown text={stripShotList(live.text).text} />
              ) : (
                live.tools.length === 0 && <div className="shimmer h-4 w-48 rounded-md" />
              )}
            </div>
          )}
        </div>

        <BriefComposer
          busy={busy}
          disabled={noDirector}
          seed={seedForComposer}
          onSend={send}
          onStop={() => {
            void api.briefCancel(brief.id);
            setBusy(false);
            setLive(null);
          }}
        />
      </section>

      <aside className="flex w-[440px] shrink-0 flex-col bg-panel">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-subtle px-5 pt-2">
          <span className="heading">Shot list</span>
          <span className="text-text-2">
            {shots.length ? `${shots.length} shot${shots.length > 1 ? "s" : ""}` : ""}
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {shots.length === 0 ? (
            <div className="m-auto flex max-w-[280px] flex-col items-center gap-2 text-center text-text-3">
              <PxSparkle className="size-5" />
              <p className="text-[13px]">
                Shots appear here once the director has a plan. Each one is checked against the model's
                parameters.
              </p>
            </div>
          ) : (
            shots.map((s, i) => (
              <ShotCard
                key={`${brief.id}-${i}`}
                shot={s}
                index={i}
                missing={resolved[i]?.missing ?? []}
                busy={queueing}
                onEdit={() => setEditing(i)}
                onQueue={() => void queue([i])}
              />
            ))
          )}
        </div>
        {shots.length > 0 && (
          <div className="border-t border-subtle p-4">
            <Button
              variant="default"
              size="xl"
              className="w-full"
              disabled={queueing}
              onClick={() => void queue(shots.map((_, i) => i))}
            >
              {queueing ? <Loader2 className="animate-spin" /> : null}
              Queue all {shots.length} shot{shots.length > 1 ? "s" : ""}
            </Button>
            <p className="mt-2 text-center text-[11px] text-text-3">
              You'll see the estimated cost before anything starts.
            </p>
          </div>
        )}
      </aside>

      <ShotEditDialog
        shot={editing !== null ? (shots[editing] ?? null) : null}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(s) => saveShot(editing!, s)}
      />
    </div>
  );
}

function DirectorLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-text-2">
      <span className="grid size-5 place-items-center rounded-full bg-surface-3">
        <Wand2 className="size-3 text-accent" />
      </span>
      {children}
    </div>
  );
}

function MessageView({ m }: { m: BriefMessage }) {
  const anim = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.2 },
  };
  if (m.role === "user") {
    return (
      <motion.div
        {...anim}
        className="max-w-[560px] self-end rounded-[16px_16px_4px_16px] bg-surface-2 px-4 py-3 leading-relaxed"
      >
        <div className="selectable whitespace-pre-wrap">{m.text}</div>
        {m.attachments.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <Chip key={a}>{basename(a)}</Chip>
            ))}
          </div>
        )}
      </motion.div>
    );
  }
  if (m.role === "system") {
    return (
      <motion.div {...anim} className="flex items-center gap-2 text-xs text-text-3">
        <Wand2 className="size-3" /> Fixing invalid params in the shot list…
      </motion.div>
    );
  }
  if (m.role === "error") {
    return (
      <motion.div
        {...anim}
        className="flex max-w-[640px] items-start gap-2 rounded-xl bg-[rgba(250,0,25,.08)] px-3.5 py-2.5 text-[13px] text-[#ff8a8a]"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span className="selectable">{m.text}</span>
      </motion.div>
    );
  }
  const { text, hadShots } = stripShotList(m.text);
  return (
    <motion.div {...anim} className="flex max-w-[640px] flex-col gap-2.5">
      <DirectorLabel>Director</DirectorLabel>
      {text && <Markdown text={text} />}
      {hadShots && <div className="text-xs font-medium text-accent">Shot list updated →</div>}
    </motion.div>
  );
}

function TitleEditor({ title, onSave }: { title: string; onSave: (t: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(title);
  useEffect(() => setV(title), [title]);
  const commit = async () => {
    setEditing(false);
    const t = v.trim();
    if (t && t !== title) await onSave(t).catch((e) => toast.error(errorMessage(e)));
    else setV(title);
  };
  return editing ? (
    <Input
      autoFocus
      aria-label="Brief title"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") {
          setV(title);
          setEditing(false);
        }
      }}
      className="no-drag h-8 max-w-sm font-semibold"
    />
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="no-drag truncate rounded-md px-1 -mx-1 font-semibold hover:bg-fill-1"
      title="Rename"
    >
      {title}
    </button>
  );
}

function BackendChip({
  brief,
  status,
  onSettings,
}: {
  brief: BriefT;
  status: DirectorStatus | null;
  onSettings: () => void;
}) {
  const backend = status?.backend ?? null;
  if (status && backend === null) {
    return (
      <button
        onClick={onSettings}
        className="flex h-7 items-center gap-1.5 rounded-full bg-[rgba(223,171,1,.12)] px-2.5 text-xs font-medium text-warning"
      >
        <AlertTriangle className="size-3.5" /> No director set up
      </button>
    );
  }
  const api = backend === "anthropic-api" || brief.backend === "anthropic-api";
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-full bg-fill-1 px-2.5 text-xs text-text-2">
      <span className="size-1.5 rounded-full bg-accent" />
      {api
        ? `Anthropic API · ${usd(brief.director_cost_usd)} so far`
        : "Claude Code · subscription · no credits used"}
    </span>
  );
}

function NoDirector({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[rgba(223,171,1,.08)] p-3.5 text-left text-[13px] text-text-2">
      <span className="flex items-center gap-2 font-semibold text-warning">
        <AlertTriangle className="size-4" /> No director available
      </span>
      <span>
        Install Claude Code and run{" "}
        <code className="rounded bg-fill-2 px-1 font-mono text-[12px] text-text-1">claude</code> once to log
        in, or add an Anthropic API key as a fallback.
      </span>
      <Button size="sm" className="self-start" onClick={onSettings}>
        Open Settings
      </Button>
    </div>
  );
}
