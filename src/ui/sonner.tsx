import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    position="bottom-right"
    icons={{
      success: <CircleCheckIcon className="size-4 text-accent" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4 text-warning" />,
      error: <OctagonXIcon className="size-4 text-danger" />,
      loading: <Loader2Icon className="size-4 animate-spin" />,
    }}
    style={
      {
        "--normal-bg": "var(--bg-surface-2)",
        "--normal-text": "var(--text-1)",
        "--normal-border": "var(--border-default)",
        "--border-radius": "var(--r-surface)",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
