import * as React from "react";
import { cn } from "@/lib/utils";

/** Card surface: #1c1e21 with a 1px subtle rim. */
export function Surface({ className, raised, ...props }: React.ComponentProps<"div"> & { raised?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-surface shadow-[var(--rim)]",
        raised && "bg-surface-2 shadow-[var(--sh-raised),var(--rim)]",
        className,
      )}
      {...props}
    />
  );
}

export function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-[15px] font-semibold text-text-1", className)} {...props} />;
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-black/20 px-1 font-sans text-[11px] font-semibold opacity-80",
        className,
      )}
      {...props}
    />
  );
}
