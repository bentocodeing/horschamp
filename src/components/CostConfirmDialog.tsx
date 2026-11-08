import { useStore } from "@/store";
import { usd } from "@/lib/format";
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

/** The one place credits get approved. Mounted once in App. */
export function CostConfirmDialog() {
  const c = useStore((s) => s.confirm);
  const spending = useStore((s) => s.spending);
  const total = c?.lines.reduce((s, l) => s + (l.usd ?? 0), 0) ?? 0;
  const unknown = c?.lines.some((l) => l.usd === null);
  const remaining = spending?.remaining_est_usd;

  return (
    <AlertDialog open={!!c} onOpenChange={(o) => !o && c?.resolve(false)}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="heading text-xl">{c?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            Higgsfield charges only for completed jobs. Failed, blocked and canceled-while-queued jobs are
            refunded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex max-h-64 flex-col overflow-auto rounded-xl bg-surface shadow-[var(--rim)]">
          {c?.lines.map((l, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-4 border-b border-subtle px-4 py-3 last:border-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-text-1">{l.label}</div>
                {l.note && <div className="mt-0.5 text-xs text-warning">{l.note}</div>}
              </div>
              <div className="shrink-0 font-display text-[15px] font-bold tabular-nums">
                {usd(l.usd, { unknown: "?" })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between px-1">
          <span className="text-text-2">Estimated total</span>
          <span className="font-display text-2xl font-bold tabular-nums text-accent">
            {usd(total)}
            {unknown && <span className="text-sm text-warning"> + unknown</span>}
          </span>
        </div>
        {remaining !== null && remaining !== undefined && (
          <div className="px-1 text-xs text-text-2">Est. balance after: {usd(remaining - total)}</div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => c?.resolve(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction autoFocus onClick={() => c?.resolve(true)}>
            Spend {usd(total)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
