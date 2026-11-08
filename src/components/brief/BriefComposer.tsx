import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Paperclip, Square } from "lucide-react";
import { api } from "@/lib/api";
import { fileSrc } from "@/lib/media";
import { fileKind } from "@/lib/params";
import { basename } from "@/lib/shots";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Kbd } from "@/ui/surface";

export function BriefComposer({
  busy,
  disabled,
  seed,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled?: boolean;
  seed: { text: string; attachments: string[]; nonce: number } | null;
  onSend: (text: string, attachments: string[]) => Promise<boolean>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const add = (paths: string[]) => {
    const ok = paths.filter((p) => fileKind(p) === "image" || fileKind(p) === "video");
    if (!ok.length) return;
    void api.previewAllow(ok);
    setFiles((f) => [...f, ...ok.filter((p) => !f.includes(p))]);
  };

  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    add(seed.attachments);
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  useEffect(() => {
    let un: (() => void) | undefined;
    let alive = true;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          add(p.paths);
        }
      })
      .then((f) => {
        if (alive) un = f;
        else f();
      });
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  const pick = async () => {
    const r = await open({
      multiple: true,
      filters: [
        { name: "Images and videos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov"] },
      ],
    });
    if (r) add(Array.isArray(r) ? r : [r]);
  };

  const send = async () => {
    if (busy || disabled || !text.trim()) return;
    const ok = await onSend(text.trim(), files);
    if (ok) {
      setText("");
      setFiles([]);
    }
  };

  return (
    <div className="relative px-10 pb-6">
      {dragging && (
        <div className="pointer-events-none absolute inset-x-10 -top-24 bottom-6 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-[var(--accent-a48)] bg-[var(--accent-a10)] text-sm font-semibold text-accent">
          Drop references for the director
        </div>
      )}
      <div className="glass flex flex-col gap-2.5 rounded-2xl p-3.5">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <div key={f} className="flex items-center gap-2 rounded-lg bg-fill-1 p-1 pr-2">
                {fileKind(f) === "image" ? (
                  <img src={fileSrc(f)} alt="" className="size-9 rounded-md object-cover" />
                ) : (
                  <video
                    src={fileSrc(f)}
                    muted
                    preload="metadata"
                    className="size-9 rounded-md object-cover"
                  />
                )}
                <Chip onRemove={() => setFiles((x) => x.filter((y) => y !== f))}>{basename(f)}</Chip>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button size="icon" aria-label="Attach reference" onClick={pick} disabled={disabled}>
            <Paperclip />
          </Button>
          <label htmlFor="brief-input" className="sr-only">
            Message the director
          </label>
          <textarea
            id="brief-input"
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={'Describe what you want to make, or say "make shot 2 cheaper"…'}
            className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[15px] text-text-1 outline-none placeholder:text-text-3"
          />
          {busy ? (
            <Button variant="secondary" size="lg" onClick={onStop}>
              <Square className="size-3.5 fill-current" /> Stop
            </Button>
          ) : (
            <Button variant="default" size="lg" onClick={send} disabled={disabled || !text.trim()}>
              Send <Kbd>⌘↵</Kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
