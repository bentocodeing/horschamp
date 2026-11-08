import * as React from "react";
import { cn } from "@/lib/utils";

/** Rounded control pill used in the prompt bar and filter rows. */
export const Pill = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { active?: boolean; muted?: boolean }
>(({ className, active, muted, ...props }, ref) => (
  <button
    ref={ref}
    data-active={active || undefined}
    className={cn(
      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-200",
      "bg-fill-2 text-text-1 hover:bg-fill-3 disabled:opacity-40",
      muted && "text-text-2",
      active && "bg-text-1 text-[var(--text-inverse)] font-semibold hover:bg-white",
      "[&_svg]:size-3.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
Pill.displayName = "Pill";
