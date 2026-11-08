import * as React from "react";
import { PxX } from "@/ui/pixel-icon";
import { cn } from "@/lib/utils";

/** Small label chip, e.g. an attached filename. Pass onRemove for an × button. */
export function Chip({
  className,
  children,
  onRemove,
  tone = "default",
  ...props
}: React.ComponentProps<"span"> & { onRemove?: () => void; tone?: "default" | "accent" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-[var(--r-chip)] px-2 text-[11px] font-medium",
        tone === "default" && "bg-fill-2 text-text-2",
        tone === "accent" && "bg-[var(--accent-a15)] text-accent",
        tone === "danger" && "bg-[rgba(250,0,25,.12)] text-[#ff8a8a]",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          className="-mr-1 grid size-4 place-items-center rounded-sm text-text-3 hover:bg-fill-2 hover:text-text-1"
        >
          <PxX className="size-3" />
        </button>
      )}
    </span>
  );
}
