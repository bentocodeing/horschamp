import { toast } from "sonner";
import { useStore } from "@/store";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PxPlus } from "@/ui/pixel-icon";

export const UNTITLED_THREAD = "New conversation";

/** Sidebar list of Generate conversations for the current project. */
export function ThreadList() {
  const threads = useStore((s) => s.threads);
  const threadId = useStore((s) => s.threadId);
  const openThread = useStore((s) => s.openThread);
  const newThread = useStore((s) => s.newThread);

  const create = async () => {
    try {
      await newThread();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <div className="eyebrow mt-5 mb-1 px-2.5">Conversations</div>
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        <button
          onClick={create}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] text-text-3 hover:bg-fill-1 hover:text-text-1"
        >
          <PxPlus className="size-3.5" /> New conversation
        </button>
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => openThread(t.id)}
            title={t.title || UNTITLED_THREAD}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-md px-2.5 text-left text-[13px] text-text-2 hover:bg-fill-1 hover:text-text-1",
              threadId === t.id && "bg-fill-1 text-text-1",
            )}
          >
            <span className="truncate">{t.title || UNTITLED_THREAD}</span>
          </button>
        ))}
        <button
          onClick={() => openThread(null)}
          className={cn(
            "flex h-8 shrink-0 items-center rounded-md px-2.5 text-left text-[13px] text-text-3 hover:bg-fill-1 hover:text-text-1",
            threadId === null && "bg-fill-1 text-text-1",
          )}
        >
          <span className="truncate">Earlier jobs</span>
        </button>
      </div>
    </>
  );
}
