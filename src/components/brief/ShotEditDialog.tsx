import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Shot } from "@/lib/api";
import { useStore } from "@/store";
import { CATEGORY_LABEL } from "@/lib/params";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { Textarea } from "@/ui/textarea";

/** Edit a shot's title, model and raw params. Saving re-validates on the Rust side. */
export function ShotEditDialog({
  shot,
  open,
  onOpenChange,
  onSave,
}: {
  shot: Shot | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (s: Shot) => Promise<void>;
}) {
  const registry = useStore((s) => s.registry);
  const [title, setTitle] = useState("");
  const [modelId, setModelId] = useState("");
  const [json, setJson] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (shot && open) {
      setTitle(shot.title);
      setModelId(shot.model_id);
      setJson(JSON.stringify(shot.params ?? {}, null, 2));
      setErr(null);
    }
  }, [shot, open]);

  const groups = useMemo(() => {
    const g: Record<string, { id: string; name: string }[]> = {};
    for (const m of registry?.models ?? []) (g[m.category] ??= []).push({ id: m.id, name: m.name });
    return g;
  }, [registry]);

  const save = async () => {
    if (!shot) return;
    let params: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(json);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Params must be a JSON object");
      params = v as Record<string, unknown>;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...shot, title: title.trim() || shot.title, model_id: modelId, params });
      onOpenChange(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="heading text-xl">Edit shot</DialogTitle>
          <DialogDescription>Params are checked against the model's schema when you save.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shot-title">Title</Label>
            <Input id="shot-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shot-model">Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger id="shot-model" className="w-full">
                <SelectValue placeholder="Pick a model" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {Object.entries(groups).map(([cat, ms]) => (
                  <SelectGroup key={cat}>
                    <SelectLabel>{CATEGORY_LABEL[cat] ?? cat}</SelectLabel>
                    {ms.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shot-params">Params (JSON)</Label>
            <Textarea
              id="shot-params"
              value={json}
              spellCheck={false}
              onChange={(e) => {
                setJson(e.target.value);
                setErr(null);
              }}
              className="min-h-56 font-mono text-[12px]"
            />
            <span className="text-xs text-text-3">Use "@filename" for attached files, e.g. "@pack.png".</span>
            {err && <span className="text-xs text-[#ff8a8a]">{err}</span>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="inverse" onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
