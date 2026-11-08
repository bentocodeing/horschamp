import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useStore } from "@/store";
import { api, errorMessage, type RegistryDiff } from "@/lib/api";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { SectionTitle } from "@/ui/surface";
import { Card, Confirm, Dot, Row } from "./common";

export function ModelsCard() {
  const registry = useStore((s) => s.registry);
  const loadModels = useStore((s) => s.loadModels);
  const [pending, setPending] = useState<{ path: string; diff: RegistryDiff } | null>(null);
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; path: string | null } | null>(null);
  const [installing, setInstalling] = useState(false);

  const installFfmpeg = async () => {
    setInstalling(true);
    try {
      setFfmpeg(await api.ffmpegInstall());
      toast.success("ffmpeg installed");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    api
      .ffmpegStatus()
      .then(setFfmpeg)
      .catch(() => setFfmpeg(null));
  }, []);

  const pick = async () => {
    const path = await open({ filters: [{ name: "Model registry", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      setPending({ path, diff: await api.modelsPreviewImport(path) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const apply = async () => {
    if (!pending) return;
    try {
      await api.modelsApplyImport(pending.path);
      await loadModels();
      toast.success("Model registry updated");
      setPending(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const d = pending?.diff;
  const nothing = d && !d.added.length && !d.removed.length && !d.changed.length;
  const gen = registry?.generated_at ? new Date(registry.generated_at).toLocaleDateString() : "unknown date";

  return (
    <Card>
      <SectionTitle>Models &amp; tools</SectionTitle>
      <Row label="Model registry" muted>
        <span className="text-text-1">
          {registry?.models.length ?? 0} models · {gen}
        </span>
      </Row>
      <div className="flex flex-wrap gap-2">
        <Button onClick={pick}>Import refreshed models.json…</Button>
        <Confirm
          title="Reset to the bundled registry?"
          description="Drops any imported models.json and uses the one shipped with the app."
          action="Reset"
          onConfirm={async () => {
            await api.modelsReset();
            await loadModels();
            toast.success("Using bundled models");
          }}
        >
          <Button variant="ghost">Reset to bundled</Button>
        </Confirm>
      </div>
      <div className="text-xs text-text-3">
        Run <code className="font-mono text-text-2">pnpm refresh-models</code> to regenerate models.json from
        the Higgsfield docs, then import it here.
      </div>
      <Row label="ffmpeg (timeline export)" muted>
        {ffmpeg?.available ? (
          <span className="truncate font-mono text-xs text-text-1">
            <Dot ok /> {ffmpeg.path}
          </span>
        ) : (
          <>
            <span className="whitespace-nowrap text-xs">
              <Dot ok={false} warn /> not found
            </span>
            <Button
              size="sm"
              className="whitespace-nowrap"
              onClick={installFfmpeg}
              disabled={installing}
              title="Uses Homebrew on macOS or winget on Windows"
            >
              {installing ? "Installing, a few min…" : "Install ffmpeg"}
            </Button>
          </>
        )}
      </Row>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="heading text-xl">Update models?</DialogTitle>
            <DialogDescription className="truncate">{pending?.path}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto text-[13px]">
            {nothing && <div className="text-text-2">No differences from the current registry.</div>}
            {!!d?.added.length && (
              <DiffList title={`Added (${d.added.length})`} items={d.added} tone="text-accent" />
            )}
            {!!d?.removed.length && (
              <DiffList title={`Removed (${d.removed.length})`} items={d.removed} tone="text-[#ff8a8a]" />
            )}
            {!!d?.changed.length && (
              <DiffList
                title={`Changed (${d.changed.length})`}
                items={d.changed.map(([id, what]) => `${id}  ${what}`)}
                tone="text-warning"
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="inverse" onClick={apply} disabled={!!nothing}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DiffList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div>
      <div className={`mb-1 text-xs font-semibold ${tone}`}>{title}</div>
      <ul className="selectable flex flex-col gap-0.5 font-mono text-[12px] text-text-2">
        {items.map((i) => (
          <li key={i} className="truncate">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
