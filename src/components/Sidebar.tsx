import { useState } from "react";
import { motion } from "motion/react";
import { PxLogoArrow, PxChat, PxFilm, PxGrid, PxPlus, PxSliders, PxSparkle } from "@/ui/pixel-icon";
import { toast } from "sonner";
import { useStore, type Route } from "@/store";
import { api, errorMessage } from "@/lib/api";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/ui/input";
import { BriefList } from "@/screens/Brief";
import { ThreadList } from "@/components/generate/ThreadList";

const NAV: { route: Route; label: string; icon: typeof PxSparkle }[] = [
  { route: "generate", label: "Generate", icon: PxSparkle },
  { route: "brief", label: "Brief", icon: PxChat },
  { route: "library", label: "Library", icon: PxGrid },
  { route: "settings", label: "Settings", icon: PxSliders },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-5">
      <div className="grid size-7 place-items-center rounded-lg bg-accent shadow-[var(--glow-accent)]">
        <PxLogoArrow className="size-4 text-black" />
      </div>
      <span className="heading text-[15px]">Horschamp</span>
    </div>
  );
}

export function Sidebar() {
  const { route, setRoute, projects, projectId, setProject, loadProjects, spending } = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    if (!name.trim()) return setAdding(false);
    try {
      const p = await api.projectCreate(name);
      await loadProjects();
      setProject(p.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    setName("");
    setAdding(false);
  };

  const spent = spending ? Math.max(spending.usage_spent_usd ?? 0, spending.local_spent_usd) : 0;
  const start = spending?.starting_balance_usd ?? null;
  const pct = start ? Math.max(0, Math.min(100, ((start - spent) / start) * 100)) : 0;

  return (
    <nav className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-subtle bg-panel px-3 pt-11 pb-4">
      <div className="drag-region absolute inset-x-0 top-0 h-10" />
      <Logo />
      {NAV.map(({ route: r, label, icon: Icon }) => (
        <button
          key={r}
          onClick={() => setRoute(r)}
          aria-current={route === r ? "page" : undefined}
          className={cn(
            "relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:text-text-1",
            route === r && "text-text-1",
          )}
        >
          {route === r && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 rounded-md bg-fill-2"
              transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
            />
          )}
          <Icon className="relative size-4" />
          <span className="relative">{label}</span>
        </button>
      ))}

      {route === "brief" ? (
        <BriefList />
      ) : (
        <>
          <div className="eyebrow mt-5 mb-1 px-2.5">Projects</div>
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            <ProjectRow
              label="All work"
              active={projectId === null}
              onClick={() => setProject(null)}
              icon={<PxFilm className="size-3.5" />}
            />
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                label={p.name}
                active={projectId === p.id}
                onClick={() => setProject(p.id)}
              />
            ))}
            {adding ? (
              <Input
                autoFocus
                value={name}
                placeholder="Project name"
                className="h-8"
                onChange={(e) => setName(e.target.value)}
                onBlur={create}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                  if (e.key === "Escape") setAdding(false);
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-text-3 hover:bg-fill-1 hover:text-text-1"
              >
                <PxPlus className="size-3.5" /> New project
              </button>
            )}
          </div>
          {route === "generate" && <ThreadList />}
        </>
      )}

      <button
        onClick={() => setRoute("settings")}
        className="mt-auto flex flex-col gap-2 rounded-2xl bg-surface p-3.5 text-left shadow-[var(--rim)] transition-colors hover:bg-surface-2"
      >
        <span className="eyebrow text-text-2">Balance (est.)</span>
        <span className="font-display text-[22px] leading-none font-bold tabular-nums">
          {start !== null ? usd(start - spent) : usd(spent)}
        </span>
        {start !== null && (
          <span className="h-1 rounded-full bg-fill-2">
            <span
              className="block h-1 rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
        <span className="text-[11px] text-text-2">
          {start !== null ? `${usd(spent)} spent` : "spent · set your balance"}
          {spending?.usage_synced_at ? " · synced" : " · local log"}
          {spending && spending.unpriced_jobs > 0 && ` · ${spending.unpriced_jobs} unpriced`}
        </span>
      </button>
    </nav>
  );
}

function ProjectRow({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 truncate rounded-md px-2.5 text-left text-[13px] text-text-2 hover:bg-fill-1 hover:text-text-1",
        active && "text-text-1 bg-fill-1",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
