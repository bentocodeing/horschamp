import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageOff, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, events, type LibraryFilter, type LibraryItem } from "@/lib/api";
import { usd } from "@/lib/format";
import { useStore } from "@/store";
import { Pill } from "@/ui/pill";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { MediaCard } from "@/components/library/MediaCard";
import { Lightbox } from "@/components/library/Lightbox";
import { TimelineStrip } from "@/components/library/TimelineStrip";

type Kind = "all" | "video" | "image" | "favorites";
type Range = "any" | "today" | "7d" | "30d";
const ALL = "__all__";

function sinceFor(r: Range): string | null {
  if (r === "any") return null;
  const d = new Date();
  if (r === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (r === "7d" ? 7 : 30));
  return d.toISOString();
}

export default function Library() {
  const { projects, projectId: sidebarProject, setRoute } = useStore();
  const [kind, setKind] = useState<Kind>("all");
  const [project, setProject] = useState<string>(sidebarProject ?? ALL);
  const [model, setModel] = useState<string>(ALL);
  const [range, setRange] = useState<Range>("any");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  // Models seen in unfiltered-by-model results, so the dropdown doesn't shrink to one entry.
  const [knownModels, setKnownModels] = useState<Record<string, string>>({});

  // Follow the sidebar's project when it changes (adjust state during render, no effect).
  const [seenSidebar, setSeenSidebar] = useState(sidebarProject);
  if (seenSidebar !== sidebarProject) {
    setSeenSidebar(sidebarProject);
    setProject(sidebarProject ?? ALL);
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filter = useMemo<LibraryFilter>(
    () => ({
      kind: kind === "video" || kind === "image" ? kind : null,
      favorites: kind === "favorites",
      project_id: project === ALL ? null : project,
      model_id: model === ALL ? null : model,
      search: search.trim() || null,
      since: sinceFor(range),
      limit: 500,
    }),
    [kind, project, model, search, range],
  );

  const [reloadTick, setReloadTick] = useState(0);
  const load = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    api
      .library(filter)
      .then((res) => {
        if (!alive) return;
        setItems(res);
        setKnownModels((prev) => {
          const next = { ...prev };
          for (const r of res) next[r.job.model_id] = r.job.model_name;
          return next;
        });
      })
      .catch((e) => alive && toast.error(errorMessage(e)))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [filter, reloadTick]);

  useEffect(() => {
    const un = events.onJob((j) => {
      if (j.status === "completed") load();
    });
    return () => {
      void un.then((f) => f());
    };
  }, [load]);

  const stats = useMemo(() => {
    const jobs = new Map<string, number>();
    for (const i of items) jobs.set(i.job.id, i.job.cost_usd ?? i.job.est_usd ?? 0);
    return { count: items.length, total: [...jobs.values()].reduce((a, b) => a + b, 0) };
  }, [items]);

  const modelOptions = Object.entries(knownModels).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="relative z-10 flex flex-col gap-4 px-7 pt-12 pb-4">
        <div className="flex items-baseline justify-between">
          <h1 className="heading text-[28px] leading-none">Library</h1>
          <span className="text-text-2 tabular-nums">
            {stats.count} generation{stats.count === 1 ? "" : "s"} · {usd(stats.total)} total
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={kind === "all"} onClick={() => setKind("all")}>
            All
          </Pill>
          <Pill active={kind === "video"} onClick={() => setKind("video")}>
            Videos
          </Pill>
          <Pill active={kind === "image"} onClick={() => setKind("image")}>
            Images
          </Pill>
          <Pill active={kind === "favorites"} onClick={() => setKind("favorites")}>
            <Star /> Favorites
          </Pill>
          <span className="mx-1 h-5 w-px bg-fill-2" aria-hidden />

          <FilterSelect
            label="Project"
            value={project}
            onChange={setProject}
            options={[[ALL, "Any"], ...projects.map((p) => [p.id, p.name] as [string, string])]}
          />
          <FilterSelect
            label="Model"
            value={model}
            onChange={setModel}
            options={[[ALL, "Any"], ...modelOptions]}
          />
          <FilterSelect
            label="Date"
            value={range}
            onChange={(v) => setRange(v as Range)}
            options={[
              ["any", "Any time"],
              ["today", "Today"],
              ["7d", "Last 7 days"],
              ["30d", "Last 30 days"],
            ]}
          />

          <div className="relative ml-auto w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3" />
            <Input
              aria-label="Search prompts"
              placeholder="Search prompts…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
        {loaded && items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-surface text-text-3 shadow-[var(--rim)]">
              <ImageOff className="size-5" />
            </div>
            <div className="text-[15px] font-semibold">Nothing here yet</div>
            <p className="max-w-xs text-text-2">
              {search || kind !== "all" || model !== ALL || range !== "any"
                ? "No generations match these filters."
                : "Finished images and videos land here, saved in your library folder."}
            </p>
            <Button variant="inverse" onClick={() => setRoute("generate")}>
              Go to Generate
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
            {items.map((item, i) => (
              <MediaCard
                key={item.asset.id}
                item={item}
                index={i}
                onOpen={() => setOpen(i)}
                onChanged={load}
              />
            ))}
          </div>
        )}
      </section>

      <TimelineStrip items={items} />
      <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="h-8 gap-1.5 rounded-full border-0 bg-fill-2 px-3 text-[13px] font-medium text-text-1 shadow-none hover:bg-fill-3"
      >
        <span className="text-text-2">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
