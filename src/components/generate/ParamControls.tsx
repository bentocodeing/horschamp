import { useState } from "react";
import { SlidersHorizontal, Paperclip } from "lucide-react";
import { PxChevronDown } from "@/ui/pixel-icon";
import type { Model, ModelInput } from "@/lib/api";
import { groupOf, humanize, isMediaInput } from "@/lib/params";
import { cn } from "@/lib/utils";
import { str } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Pill } from "@/ui/pill";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Switch } from "@/ui/switch";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Button } from "@/ui/button";

type Params = Record<string, unknown>;
type SetParam = (name: string, value: unknown) => void;

function display(i: ModelInput, v: unknown): string {
  if (v === undefined || v === null || v === "") return humanize(i.name);
  if (i.name === "duration") return `${str(v)}s`;
  if (typeof v === "boolean") return `${humanize(i.name)} ${v ? "on" : "off"}`;
  if (i.name === "sound") return `Sound ${str(v)}`;
  if (i.name === "batch_size" || i.name === "num_images") return `×${str(v)}`;
  return str(v);
}

/** Choices for a numeric pill: every step for small ranges, a handful otherwise. */
export function numericChoices(i: ModelInput): number[] {
  if (i.min === undefined || i.max === undefined) return [];
  const span = i.max - i.min;
  if (span <= 12) return Array.from({ length: span + 1 }, (_, k) => i.min! + k);
  const picks = new Set([
    i.min,
    i.max,
    Math.round(i.min + span / 4),
    Math.round(i.min + span / 2),
    Math.round(i.min + (3 * span) / 4),
  ]);
  return [...picks].sort((a, b) => a - b);
}

/** Pill for an enum / small integer / boolean param in the prompt bar. */
export function ParamPill({
  input,
  value,
  onChange,
}: {
  input: ModelInput;
  value: unknown;
  onChange: SetParam;
}) {
  if (input.type === "boolean") {
    return (
      <Pill muted={!value} onClick={() => onChange(input.name, !value)} aria-pressed={!!value}>
        {display(input, !!value)}
      </Pill>
    );
  }
  const choices: (string | number | boolean)[] = input.enum ?? numericChoices(input);
  if (!choices.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pill aria-label={humanize(input.name)}>
          {display(input, value)}
          <PxChevronDown className="opacity-50" />
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={10}
        className="max-h-80 min-w-36 overflow-auto"
      >
        <DropdownMenuLabel className="eyebrow">{humanize(input.name)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={str(value)}
          onValueChange={(v) => {
            const match = choices.find((c) => String(c) === v);
            onChange(input.name, match);
          }}
        >
          {choices.map((c) => (
            <DropdownMenuRadioItem key={String(c)} value={String(c)}>
              {display(input, c)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One form field rendered from the input schema. */
export function ParamField({
  input,
  value,
  onChange,
  error,
}: {
  input: ModelInput;
  value: unknown;
  onChange: SetParam;
  error?: string;
}) {
  const id = `param-${input.name}`;
  const [jsonText, setJsonText] = useState(() => (value === undefined ? "" : JSON.stringify(value, null, 2)));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const base = input.type.split("/")[0];

  let control: React.ReactNode;
  if (input.enum) {
    control = (
      <Select
        value={str(value)}
        onValueChange={(v) =>
          onChange(
            input.name,
            input.enum!.find((c) => String(c) === v),
          )
        }
      >
        <SelectTrigger id={id} className="h-8 w-full">
          <SelectValue placeholder="Default" />
        </SelectTrigger>
        <SelectContent>
          {input.enum.map((c) => (
            <SelectItem key={String(c)} value={String(c)}>
              {String(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (base === "boolean") {
    control = <Switch id={id} checked={!!value} onCheckedChange={(c) => onChange(input.name, c)} />;
  } else if (base === "integer" || base === "number") {
    control = (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={base === "integer" ? 1 : "any"}
        min={input.min}
        max={input.max}
        value={str(value)}
        placeholder={input.default != null ? str(input.default) : undefined}
        onChange={(e) => onChange(input.name, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  } else if (base === "array" || base === "object") {
    control = (
      <>
        <Textarea
          id={id}
          className="min-h-20 font-mono text-xs"
          value={jsonText}
          placeholder={base === "array" ? "[ ]" : "{ }"}
          onChange={(e) => {
            setJsonText(e.target.value);
            if (!e.target.value.trim()) {
              setJsonErr(null);
              return onChange(input.name, undefined);
            }
            try {
              onChange(input.name, JSON.parse(e.target.value));
              setJsonErr(null);
            } catch {
              setJsonErr("Not valid JSON yet");
            }
          }}
        />
        {jsonErr && <span className="text-[11px] text-warning">{jsonErr}</span>}
      </>
    );
  } else {
    const long = (input.maxLength ?? 0) > 200;
    const Comp = long ? Textarea : Input;
    control = (
      <Comp
        id={id}
        value={(value as string) ?? ""}
        maxLength={input.maxLength}
        className={long ? "min-h-16" : undefined}
        onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
          onChange(input.name, e.target.value || undefined)
        }
      />
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-1.5", base === "boolean" && "flex-row items-center justify-between")}
    >
      <Label htmlFor={id} className="flex items-baseline gap-1.5 text-xs text-text-2">
        {humanize(input.name)}
        {input.required && <span className="text-accent">*</span>}
        {input.min !== undefined && input.max !== undefined && (
          <span className="text-text-3">
            {input.min}–{input.max}
          </span>
        )}
      </Label>
      {control}
      {input.description && input.description !== humanize(input.name) && base !== "boolean" && (
        <span className="text-[11px] text-text-3">{input.description}</span>
      )}
      {error && <span className="text-[11px] text-[#ff8a8a]">{error}</span>}
    </div>
  );
}

/** Popover with every non-primary param, plus attach buttons for each media input. */
export function MoreParams({
  model,
  params,
  onChange,
  errors,
  onAttach,
  mediaFilled,
}: {
  model: Model;
  params: Params;
  onChange: SetParam;
  errors: Record<string, string>;
  onAttach: (input: ModelInput) => void;
  mediaFilled: Set<string>;
}) {
  const more = model.inputs.filter((i) => groupOf(i) === "more");
  const media = model.inputs.filter(isMediaInput);
  const count = more.filter((i) => params[i.name] !== undefined && params[i.name] !== i.default).length;
  const hasErr = more.some((i) => errors[i.name]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Pill muted className={cn(hasErr && "text-[#ff8a8a]")}>
          <SlidersHorizontal />
          More{count ? ` · ${count}` : ""}
        </Pill>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-[400px] p-0">
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {media.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              <div className="eyebrow">Inputs</div>
              {media.map((i) => (
                <div key={i.name} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-2">
                    {humanize(i.name)}
                    {i.required && <span className="text-accent"> *</span>}
                    {mediaFilled.has(i.name) && <span className="text-accent"> · attached</span>}
                  </span>
                  <Button size="xs" variant="secondary" onClick={() => onAttach(i)}>
                    <Paperclip /> Attach
                  </Button>
                </div>
              ))}
            </div>
          )}
          {more.length ? (
            <div className="flex flex-col gap-4">
              <div className="eyebrow">Parameters</div>
              {more.map((i) => (
                <ParamField
                  key={`${model.id}-${i.name}`}
                  input={i}
                  value={params[i.name]}
                  onChange={onChange}
                  error={errors[i.name]}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-2">This model has no extra parameters.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
