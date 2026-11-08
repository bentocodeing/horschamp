import type { ReactNode } from "react";
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
  AlertDialogTrigger,
} from "@/ui/alert-dialog";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn("flex flex-col gap-3 rounded-[20px] bg-surface p-5 shadow-[var(--rim)]", className)}
    >
      {children}
    </section>
  );
}

export function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full",
        ok ? "bg-accent" : warn ? "bg-warning" : "bg-text-3",
      )}
      aria-hidden
    />
  );
}

export function Row({ label, children, muted }: { label: ReactNode; children: ReactNode; muted?: boolean }) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-4", muted && "text-text-2")}>
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-right">{children}</span>
    </div>
  );
}

/** Wraps a trigger with a confirm dialog for destructive actions. */
export function Confirm({
  title,
  description,
  action,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  action: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
