import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store";
import { api, errorMessage, type Job, type Settings } from "@/lib/api";
import { usd, when } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { StatusBadge } from "@/ui/status-badge";
import { SectionTitle } from "@/ui/surface";
import { Card } from "./common";

function Stat({
  label,
  value,
  sub,
  accent,
  action,
  children,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[14px] bg-surface-2 p-3.5",
        accent && "shadow-[inset_0_0_0_1px_var(--accent-a30)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] tracking-[.06em] text-text-2 uppercase">{label}</div>
        {action}
      </div>
      {children ?? (
        <div
          className={cn("mt-1.5 font-display text-[22px] font-bold tabular-nums", accent && "text-accent")}
        >
          {value}
        </div>
      )}
      <div className="mt-1 text-[11px] text-text-2">{sub}</div>
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onSave,
  label,
  className,
}: {
  id: string;
  value: string;
  onSave: (v: string) => Promise<void>;
  label: string;
  className?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = async () => {
    if (v.trim() === value) return;
    try {
      await onSave(v.trim() || "0");
    } catch (e) {
      toast.error(errorMessage(e));
      setV(value);
    }
  };
  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-2">$</span>
      <Input
        id={id}
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="pl-6 tabular-nums"
      />
    </div>
  );
}

/**
 * Starting balance is read-only by default. Changing it resets the date spending is counted
 * from, so it goes through an explicit Edit button and a confirmation dialog.
 */
function BalanceStat({
  value,
  setAt,
  onSave,
}: {
  value: number | null;
  setAt: string | null;
  onSave: (v: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft(value != null ? String(value) : "");
    setOpen(true);
  };
  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const changed = valid && parsed !== value;

  const save = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!changed) return;
    setSaving(true);
    try {
      await onSave(String(parsed));
      toast.success(`Starting balance set to ${usd(parsed)}`);
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stat
      label="Starting balance"
      value=""
      action={
        <Button
          size="xs"
          variant="ghost"
          onClick={start}
          aria-label="Edit starting balance"
          className="-my-1"
        >
          <Pencil />
          {value != null ? "Edit" : "Set"}
        </Button>
      }
      sub={value != null && setAt ? `You set this · ${when(setAt)}` : "You set this"}
    >
      <div className="mt-1.5 font-display text-[22px] font-bold tabular-nums">
        {value != null ? usd(value) : <span className="text-text-3">Not set</span>}
      </div>
      <AlertDialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {value != null ? "Change starting balance?" : "Set starting balance"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Enter the balance shown in your Higgsfield Console right now. Spending is counted from today, so
              earlier jobs no longer count against it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <MoneyField
            id="start-balance"
            label="Starting balance in dollars"
            value={draft}
            onChange={setDraft}
          />
          {value != null && changed && (
            <div className="text-xs text-text-2">
              {usd(value)} → {usd(parsed)}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={save} disabled={!changed || saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Stat>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-2">$</span>
      <Input
        id={id}
        autoFocus
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        className="pl-6 tabular-nums"
      />
    </div>
  );
}

export function SpendingCard() {
  const spending = useStore((s) => s.spending);
  const refreshSpending = useStore((s) => s.refreshSpending);
  const storeJobs = useStore((s) => s.jobs);
  const [settings, setSettings] = useState<Settings>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadSettings = () =>
    api
      .settings()
      .then(setSettings)
      .catch((e) => toast.error(errorMessage(e)));
  useEffect(() => {
    void loadSettings();
    void refreshSpending();
  }, [refreshSpending]);
  useEffect(() => {
    api
      .jobs(null, 50)
      .then(setJobs)
      .catch(() => {});
  }, [storeJobs]);

  const set = async (key: string, value: string) => {
    await api.settingSet(key, value);
    await Promise.all([loadSettings(), refreshSpending()]);
  };

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const r = await api.usageSync();
      toast.success(`Higgsfield reports ${usd(r.total_usd)} spent`);
      await refreshSpending();
    } catch (e) {
      setSyncError(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const [repricing, setRepricing] = useState(false);
  const reprice = async () => {
    setRepricing(true);
    try {
      const r = await api.spendingReprice();
      if (r.unknown > 0)
        toast.error(`${r.unknown} job${r.unknown === 1 ? "" : "s"} still unpriced: ${r.error}`);
      else toast.success(`Priced ${r.priced} job${r.priced === 1 ? "" : "s"}`);
      await refreshSpending();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRepricing(false);
    }
  };

  const exportCsv = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const path = await save({
      defaultPath: `horschamp-spending-${day}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const n = await api.spendingExportCsv(path);
      toast.success(`Exported ${n} job${n === 1 ? "" : "s"} to CSV`, {
        action: { label: "Show", onClick: () => void api.revealPath(path) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const showBackups = () => api.backupsReveal().catch((e) => toast.error(errorMessage(e)));

  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: settings.library_dir });
    if (typeof dir === "string") {
      await set("library_dir", dir).catch((e) => toast.error(errorMessage(e)));
      toast.success("Library folder changed. New downloads go there.");
    }
  };

  const s = spending;
  const syncedAt = s?.usage_synced_at ? `from API · synced ${when(s.usage_synced_at)}` : "not synced yet";

  return (
    <Card className="col-span-2 gap-3.5">
      <div className="flex items-center justify-between">
        <SectionTitle>Spending</SectionTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={exportCsv}>
            <Download />
            Export CSV
          </Button>
          <Button onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sync from Higgsfield usage
          </Button>
        </div>
      </div>
      {s && s.unpriced_jobs > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-fill-1 px-3 py-2 text-xs text-text-2">
          <span>
            {s.unpriced_jobs} completed job{s.unpriced_jobs === 1 ? " has" : "s have"} no price yet and count
            as $0, so the spent total is too low.
          </span>
          <Button size="sm" variant="ghost" onClick={reprice} disabled={repricing}>
            {repricing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Estimate now
          </Button>
        </div>
      )}
      {syncError && <div className="rounded-lg bg-fill-1 px-3 py-2 text-xs text-text-2">{syncError}</div>}
      <div className="grid grid-cols-4 gap-3">
        <BalanceStat
          value={s?.starting_balance_usd ?? null}
          setAt={s?.balance_set_at ?? null}
          onSave={(v) => set("starting_balance_usd", v)}
        />
        <Stat label="Spent (Higgsfield usage)" value={usd(s?.usage_spent_usd)} sub={syncedAt} />
        <Stat
          label="Spent (local log)"
          value={usd(s?.local_spent_usd ?? 0)}
          sub="completed jobs × estimate"
        />
        <Stat
          label="Est. remaining"
          value={usd(s?.remaining_est_usd)}
          sub={s?.starting_balance_usd != null ? "start − spent" : "set a starting balance"}
          accent
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-text-2">
        <div className="flex items-center gap-2.5">
          <span>Ask before jobs over</span>
          <MoneyInput
            id="threshold"
            label="Confirmation threshold in dollars"
            value={settings.confirm_over_usd ?? "0"}
            onSave={(v) => set("confirm_over_usd", v)}
            className="w-24"
          />
          <span className="text-xs text-text-3">0 = always ask</span>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0">Library folder</span>
          <span
            className="max-w-[360px] truncate rounded-md bg-fill-1 px-3 py-1.5 text-text-1"
            title={settings.library_dir}
          >
            {settings.library_dir?.replace(/^\/Users\/[^/]+/, "~") ?? "…"}
          </span>
          <Button size="sm" variant="ghost" onClick={pickFolder}>
            Change
          </Button>
        </div>
      </div>
      {s && s.director_spent_usd > 0 && (
        <div className="text-xs text-text-2">
          Director via Anthropic API: {usd(s.director_spent_usd)} (billed by Anthropic, not Higgsfield)
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-text-2">
        <span>Job history and spending are backed up once a day; the last 7 days are kept.</span>
        <Button size="xs" variant="ghost" onClick={showBackups}>
          Show backups
        </Button>
      </div>
      <SpendTable jobs={jobs} />
    </Card>
  );
}

const COLS = "grid grid-cols-[140px_minmax(0,1fr)_200px_110px_120px] gap-3";

function SpendTable({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <div className="border-t border-subtle pt-3 text-text-3">No jobs yet.</div>;
  return (
    <div className="flex flex-col border-t border-subtle">
      <div className={cn(COLS, "py-2.5 text-[11px] tracking-[.06em] text-text-3 uppercase")}>
        <span>When</span>
        <span>Prompt</span>
        <span>Model</span>
        <span>Status</span>
        <span className="text-right">Cost</span>
      </div>
      {jobs.map((j) => {
        const refunded = j.status === "failed" || j.status === "canceled" || j.status === "nsfw";
        const cost = refunded ? 0 : (j.cost_usd ?? j.est_usd);
        return (
          <div key={j.id} className={cn(COLS, "items-center border-t border-[rgba(255,255,255,.04)] py-2.5")}>
            <span className="text-text-2">{when(j.created_at)}</span>
            <span className="selectable truncate">
              {j.prompt || <span className="text-text-3">(no prompt)</span>}
            </span>
            <span className="truncate text-text-2">{j.model_name}</span>
            <span>
              <StatusBadge status={j.status} />
            </span>
            <span className={cn("text-right tabular-nums", refunded && "text-text-2")}>
              {refunded ? "$0.00 · refunded" : j.status === "completed" ? usd(cost) : `est. ${usd(cost)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
