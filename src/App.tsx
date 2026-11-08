import { useEffect } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { toast } from "sonner";
import { useStore } from "@/store";
import { events, errorMessage } from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CostConfirmDialog } from "@/components/CostConfirmDialog";
import { Toaster } from "@/ui/sonner";
import { TooltipProvider } from "@/ui/tooltip";
import Generate from "@/screens/Generate";
import Brief from "@/screens/Brief";
import Library from "@/screens/Library";
import Settings from "@/screens/Settings";
import DesignSystem from "@/screens/DesignSystem";

export default function App() {
  const route = useStore((s) => s.route);

  useEffect(() => {
    useStore
      .getState()
      .init()
      .catch((e) => toast.error(errorMessage(e)));
    const un = events.onJob((j) => {
      const prev = useStore.getState().jobs[j.id];
      useStore.getState().upsertJob(j);
      if (prev && prev.status !== j.status) {
        if (j.status === "completed") toast.success(`${j.model_name} finished`);
        if (j.status === "failed" || j.status === "nsfw")
          toast.error(`${j.model_name}: ${j.error ?? j.status}`);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={400}>
        <div className="flex h-full">
          <Sidebar />
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="drag-region absolute inset-x-0 top-0 z-0 h-10" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={route}
                className="flex min-h-0 flex-1 flex-col"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
              >
                <ErrorBoundary resetKey={route}>
                  {route === "generate" && <Generate />}
                  {route === "brief" && <Brief />}
                  {route === "library" && <Library />}
                  {route === "settings" && <Settings />}
                  {route === "design" && <DesignSystem />}
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <CostConfirmDialog />
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}
