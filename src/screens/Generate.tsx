import { useEffect, useMemo, useRef } from "react";
import { KeyRound } from "lucide-react";
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
  const { jobs, projects, projectId, key, setRoute, presetComposer } = useStore();
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
          <span className="font-semibold">Generate</span>
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
