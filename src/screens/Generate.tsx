import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { UNTITLED_THREAD } from "@/components/generate/ThreadList";
import { Input } from "@/ui/input";
import { useStore } from "@/store";
import { JobCard } from "@/components/generate/JobCard";
import { PromptBar } from "@/components/generate/PromptBar";
import { Button } from "@/ui/button";

const ACTIVE = new Set(["submitting", "queued", "running", "downloading"]);
const IDEAS = [
  "Slow push-in on a ceramic coffee cup, morning light through linen curtains, steam rising",
  "Editorial portrait in a neon-lit noodle bar, rain on the window, 35mm film grain",
  "Aerial shot over terraced rice fields at sunrise, mist in the valleys",
];

export default function Generate() {
  const { jobs, projects, projectId, key, setRoute, presetComposer, threads, threadId } = useStore();
  const thread = threads.find((t) => t.id === threadId);
  const list = useMemo(
    () => Object.values(jobs).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [jobs],
  );
  const running = list.filter((j) => ACTIVE.has(j.status)).length;
  const project = projects.find((p) => p.id === projectId);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [list.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-subtle px-7 pt-2">
        <div className="flex items-center gap-2.5">
          <span className="text-text-2">{project?.name ?? "All work"}</span>
          <span className="text-text-3">/</span>
          {threadId === null ? (
            <span className="font-semibold">Earlier jobs</span>
          ) : thread ? (
            <ThreadTitle key={thread.id} id={thread.id} title={thread.title} />
          ) : (
            <span className="font-semibold">Generate</span>
          )}
          {thread && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete conversation"
              title="Delete conversation (its media stays in the Library)"
              onClick={() =>
                useStore
                  .getState()
                  .deleteThread(thread.id)
                  .catch((e) => toast.error(errorMessage(e)))
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
        {running > 0 && (
          <span className="flex h-7 items-center gap-1.5 rounded-full bg-fill-1 px-2.5 text-xs text-text-2">
            <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
            {running} job{running > 1 ? "s" : ""} running
          </span>
        )}
      </header>

      <section
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col items-center gap-8 overflow-y-auto px-7 py-8"
      >
        {key && !key.present && (
          <div className="flex w-full max-w-[820px] items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[var(--rim)]">
            <KeyRound className="size-4 text-accent" />
            <span className="flex-1 text-[13px] text-text-2">
              Add your Higgsfield API key to start generating. It's stored in your OS keychain.
            </span>
            <Button size="sm" variant="inverse" onClick={() => setRoute("settings")}>
              Add key
            </Button>
          </div>
        )}
        {list.length === 0 ? (
          <div className="my-auto flex max-w-[640px] flex-col items-center gap-6 text-center">
            <h1 className="heading text-[40px] leading-[1.05]">What are we making?</h1>
            <p className="text-text-2">
              Pick a model, describe the shot, drop reference images. Every job asks before it spends credits.
            </p>
            <div className="flex flex-col gap-2">
              {IDEAS.map((t) => (
                <button
                  key={t}
                  onClick={() => presetComposer({ prompt: t })}
                  className="rounded-xl bg-fill-1 px-4 py-2.5 text-left text-[13px] text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          list.map((j) => <JobCard key={j.id} job={j} />)
        )}
      </section>

      <PromptBar />
    </div>
  );
}

function ThreadTitle({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(title);
  const commit = async () => {
    setEditing(false);
    const t = v.trim();
    if (!t || t === title) return setV(title);
    try {
      await useStore.getState().renameThread(id, t);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return editing ? (
    <Input
      autoFocus
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
      onClick={() => {
        setV(title);
        setEditing(true);
      }}
      className="no-drag max-w-[420px] truncate rounded-md px-1 -mx-1 font-semibold hover:bg-fill-1"
      title="Rename"
    >
      {title || UNTITLED_THREAD}
    </button>
  );
}
