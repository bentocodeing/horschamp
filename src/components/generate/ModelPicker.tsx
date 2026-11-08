import { useMemo, useState } from "react";
import { PxCheck, PxChevronDown } from "@/ui/pixel-icon";
import type { Model } from "@/lib/api";
import { CATEGORY_LABEL } from "@/lib/params";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/ui/command";
import { Pill } from "@/ui/pill";

const ORDER = ["image", "text-to-video", "image-to-video", "video-to-video", "other"];

export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: Model[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.id === value);
  const groups = useMemo(() => {
    const g = new Map<string, Model[]>();
    for (const m of models) g.set(m.category, [...(g.get(m.category) ?? []), m]);
    return [...g.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [models]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill aria-label="Choose model" className="max-w-[260px]">
          <span className="truncate">{current?.name ?? "Choose model"}</span>
          <PxChevronDown className="opacity-60" />
        </Pill>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={10} className="w-[420px] p-0">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Search models…" />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>No model matches.</CommandEmpty>
            {groups.map(([cat, list]) => (
              <CommandGroup key={cat} heading={CATEGORY_LABEL[cat] ?? cat}>
                {list.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.id}`}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-text-1">{m.name}</div>
                      <div className="truncate text-[11px] text-text-3">{m.id}</div>
                    </div>
                    {m.id === value && <PxCheck className="size-4 text-accent" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
