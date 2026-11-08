import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium select-none outline-none transition-[background-color,color,box-shadow,transform,opacity] duration-200 ease-out active:scale-[.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:shadow-[var(--ring-focus)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** Lime call-to-action with the bottom lip. One per view. */
        default:
          "bg-accent text-accent-foreground shadow-[var(--sh-btn-lip)] hover:bg-[var(--accent-hi)] hover:shadow-[var(--sh-btn-lip),var(--glow-accent)] font-display font-bold uppercase tracking-[.02em]",
        secondary: "bg-fill-2 text-text-1 hover:bg-fill-3",
        /** White pill used for the main action in neutral contexts (Send, active filter). */
        inverse: "bg-text-1 text-[var(--text-inverse)] font-semibold hover:bg-white",
        outline: "bg-transparent text-text-1 shadow-[var(--rim-strong)] hover:bg-fill-1",
        ghost: "text-text-2 hover:bg-fill-1 hover:text-text-1",
        glass:
          "bg-[rgba(35,38,42,.8)] text-text-1 backdrop-blur-[var(--blur-md)] hover:bg-[rgba(55,58,62,.9)]",
        destructive: "bg-[rgba(250,0,25,.12)] text-[#ff8a8a] hover:bg-[rgba(250,0,25,.2)]",
        link: "text-accent underline-offset-4 hover:underline h-auto px-0",
      },
      size: {
        default: "h-8 rounded-md px-3 text-[13px]",
        xs: "h-6 rounded-sm px-2 text-xs gap-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 rounded-sm px-2.5 text-xs",
        lg: "h-10 rounded-lg px-5 text-[13px]",
        xl: "h-12 rounded-lg px-6 text-sm",
        icon: "size-8 rounded-md",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-sm",
        "icon-lg": "size-10 rounded-lg",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
