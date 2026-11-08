import { useState } from "react";
import { Copy, MoreHorizontal, Play, Star, Trash2 } from "lucide-react";
import { PxArrowLeft, PxPlus } from "@/ui/pixel-icon";
import { useStore } from "@/store";
import { Button } from "@/ui/button";
import { Pill } from "@/ui/pill";
import { Chip } from "@/ui/chip";
import { Kbd, SectionTitle, Surface } from "@/ui/surface";
import { StatusBadge, type JobStatus } from "@/ui/status-badge";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { Slider } from "@/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { Skeleton } from "@/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/alert-dialog";
import { Swatches, TokenValue } from "@/components/ds/Swatches";
import { cn } from "@/lib/utils";
import { PIXEL_ICONS } from "@/ui/pixel-icon";

const VARIANTS = [
  "default",
  "secondary",
  "inverse",
  "outline",
  "ghost",
  "glass",
  "destructive",
  "link",
] as const;
const SIZES = ["xs", "sm", "default", "lg", "xl"] as const;
const STATUSES: JobStatus[] = [
  "submitting",
  "queued",
  "running",
  "downloading",
  "completed",
  "failed",
  "nsfw",
  "canceled",
];
const RADII = ["--r-xs", "--r-chip", "--r-sm", "--r-control", "--r-md", "--r-surface", "--r-lg", "--r-xl"];
const SHADOWS = [
  "--sh-raised-sm",
  "--sh-raised",
  "--sh-popover",
  "--sh-modal",
  "--sh-float",
  "--glow-accent",
];
const DURATIONS = ["--dur-fast", "--dur-normal", "--dur-slow", "--dur-slower"];
const EASINGS = [
  "--ease-out",
  "--ease-in-out",
  "--ease-out-expo",
  "--ease-out-quart",
  "--ease-spring",
  "--ease-emphasized",
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-4 border-t border-subtle pt-8">
      <div className="eyebrow text-text-2">{title}</div>
      {children}
    </section>
  );
}

function MotionDemo({ duration, easing }: { duration: string; easing: string }) {
  return (
    <div className="group flex items-center gap-3 rounded-xl bg-surface p-3 shadow-[var(--rim)]">
      <div className="relative h-8 flex-1 rounded-md bg-fill-1">
        <span
          className="absolute top-1 left-1 size-6 rounded-md bg-accent group-hover:left-[calc(100%-1.75rem)]"
          style={{ transition: `left var(${duration}) var(${easing})` }}
        />
      </div>
      <div className="w-44 shrink-0">
        <div className="font-mono text-[11px] text-text-1">
          {duration} · {easing}
        </div>
        <TokenValue name={easing} />
      </div>
    </div>
  );
}

/** Gradient-only sample of the library card so the page needs no media. */
function SampleMediaCard() {
  const [fav, setFav] = useState(true);
  return (
    <div className="group relative h-64 w-56 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#3a3d42,#1a1c1f_60%,#2d3a12)] shadow-[var(--rim)]">
      <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px]">
        <Play className="size-3 fill-current" /> hover
      </span>
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: "var(--media-scrim)" }}
      >
        <div className="absolute top-3 right-3 flex gap-1.5">
          <Button
            variant="glass"
            size="icon"
            aria-label="Favorite"
            aria-pressed={fav}
            onClick={() => setFav(!fav)}
          >
            <Star className={cn("size-4", fav && "fill-accent text-accent")} />
          </Button>
          <Button variant="glass" size="icon" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
        <div className="absolute inset-x-3.5 bottom-3.5 flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-on-media-2)]">Sample model · 5s · $0.42</span>
          <span className="line-clamp-2 text-xs">
            Slow push-in on a ceramic cup, morning light, steam rising.
          </span>
          <div className="flex gap-1.5">
            <Button size="xs" className="bg-white/15 hover:bg-white/25">
              Reuse
            </Button>
            <Button size="xs" className="bg-white/15 hover:bg-white/25">
              Use as input
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DesignSystem() {
  const setRoute = useStore((s) => s.setRoute);
  const [chips, setChips] = useState(["pack.png", "mood.jpg", "ref_frame.jpg"]);
  const [slider, setSlider] = useState([5]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-8 pt-12 pb-16">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <Button variant="ghost" size="sm" className="-ml-2.5 w-fit" onClick={() => setRoute("settings")}>
              <PxArrowLeft /> Settings
            </Button>
            <h1 className="heading text-[40px] leading-none">Design system</h1>
            <p className="max-w-xl text-text-2">
              Brand-neutral tokens. Swap the accent by editing{" "}
              <code className="font-mono text-text-1">--accent*</code> in{" "}
              <code className="font-mono text-text-1">src/styles/tokens.css</code>. Respects
              prefers-reduced-motion.
            </p>
          </div>
        </div>

        <Section id="colors" title="Colors">
          <Swatches />
        </Section>

        <Section id="type" title="Typography">
          <div className="flex flex-col gap-3">
            {[64, 40, 28, 20].map((s) => (
              <div key={s} className="flex items-baseline gap-4">
                <span className="w-14 shrink-0 font-mono text-[11px] text-text-3">{s}px</span>
                <span className="heading" style={{ fontSize: s, lineHeight: 1.1 }}>
                  Generate
                </span>
              </div>
            ))}
            {[16, 14, 12, 10].map((s) => (
              <div key={s} className="flex items-baseline gap-4">
                <span className="w-14 shrink-0 font-mono text-[11px] text-text-3">{s}px</span>
                <span style={{ fontSize: s }}>
                  Slow push-in on a ceramic coffee cup, morning light through linen.
                </span>
              </div>
            ))}
            <div className="flex items-baseline gap-4">
              <span className="w-14 shrink-0 font-mono text-[11px] text-text-3">eyebrow</span>
              <span className="eyebrow">Projects</span>
            </div>
          </div>
        </Section>

        <Section id="shape" title="Radii & shadows">
          <div className="flex flex-wrap gap-4">
            {RADII.map((r) => (
              <div key={r} className="flex flex-col items-center gap-2">
                <div
                  className="size-16 bg-surface-2 shadow-[var(--rim-strong)]"
                  style={{ borderRadius: `var(${r})` }}
                />
                <span className="font-mono text-[11px] text-text-2">{r}</span>
                <TokenValue name={r} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 pt-2">
            {SHADOWS.map((s) => (
              <div
                key={s}
                className="flex h-20 items-end rounded-2xl bg-surface-2 p-3"
                style={{ boxShadow: `var(${s})` }}
              >
                <span className="font-mono text-[11px] text-text-2">{s}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="motion" title="Motion (hover a row)">
          <div className="grid grid-cols-2 gap-3">
            {EASINGS.map((e, i) => (
              <MotionDemo key={e} easing={e} duration={DURATIONS[Math.min(i, DURATIONS.length - 1)]} />
            ))}
          </div>
        </Section>

        <Section id="icons" title="Pixel icons">
          <div className="flex flex-wrap gap-3">
            {Object.entries(PIXEL_ICONS).map(([name, Icon]) => (
              <div
                key={name}
                className="flex w-28 flex-col items-center gap-3 rounded-xl bg-surface p-4 shadow-[var(--rim)]"
              >
                <Icon className="size-12 text-accent" />
                <div className="flex items-center gap-2 text-text-1">
                  <Icon className="size-4" />
                  <Icon className="size-3.5" />
                </div>
                <span className="font-mono text-[10px] text-text-2">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="buttons" title="Buttons">
          <div className="flex flex-col gap-3">
            {VARIANTS.map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-3">
                <span className="w-24 shrink-0 font-mono text-[11px] text-text-3">{v}</span>
                {SIZES.map((s) => (
                  <Button key={s} variant={v} size={s}>
                    {v === "default" ? "Generate" : "Button"}
                  </Button>
                ))}
                <Button variant={v} size="icon" aria-label="Add">
                  <PxPlus />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <span className="w-24 shrink-0 font-mono text-[11px] text-text-3">cta</span>
              <Button variant="default" size="lg">
                Generate <Kbd>⌘↵</Kbd>
              </Button>
              <Button variant="default" size="lg" disabled>
                Generate
              </Button>
            </div>
          </div>
        </Section>

        <Section id="pills" title="Pills, chips, status">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>Kling 3.0 Pro</Pill>
            <Pill>16:9</Pill>
            <Pill active>All</Pill>
            <Pill muted>More params</Pill>
            <Pill disabled>Disabled</Pill>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <Chip key={c} onRemove={() => setChips(chips.filter((x) => x !== c))}>
                {c}
              </Chip>
            ))}
            <Chip tone="accent">✓ valid params</Chip>
            <Chip tone="danger">duration must be ≤ 15</Chip>
            {chips.length < 3 && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setChips(["pack.png", "mood.jpg", "ref_frame.jpg"])}
              >
                Reset
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} elapsed={s === "running" ? "0:14" : undefined} />
            ))}
          </div>
        </Section>

        <Section id="forms" title="Form controls">
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-input">Input</Label>
              <Input id="ds-input" placeholder="Search prompts…" />
              <Input aria-label="Invalid input" aria-invalid defaultValue="99" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-textarea">Textarea</Label>
              <Textarea id="ds-textarea" placeholder="Describe the shot…" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Select</Label>
              <Select defaultValue="16:9">
                <SelectTrigger aria-label="Aspect ratio" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["16:9", "9:16", "1:1", "4:5"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch id="ds-switch" defaultChecked />
                <Label htmlFor="ds-switch">Sound</Label>
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  aria-label="Duration"
                  min={3}
                  max={15}
                  step={1}
                  value={slider}
                  onValueChange={setSlider}
                  className="w-56"
                />
                <span className="text-xs tabular-nums text-text-2">{slider[0]}s</span>
              </div>
            </div>
          </div>
          <Tabs defaultValue="a" className="w-fit">
            <TabsList>
              <TabsTrigger value="a">Videos</TabsTrigger>
              <TabsTrigger value="b">Images</TabsTrigger>
              <TabsTrigger value="c">Audio</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="text-xs text-text-2">
              Tab content
            </TabsContent>
          </Tabs>
        </Section>

        <Section id="overlays" title="Overlays">
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button>Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Estimated from Higgsfield</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <MoreHorizontal /> Menu
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>
                  <Copy /> Copy prompt
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit shot</DialogTitle>
                  <DialogDescription>
                    Dialogs use surface-2, a 24px radius and the modal shadow.
                  </DialogDescription>
                </DialogHeader>
                <Input aria-label="Title" defaultValue="3 · Pack reveal" />
                <DialogFooter>
                  <Button variant="inverse">Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Alert dialog</Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                  <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Section>

        <Section id="surfaces" title="Surfaces, loading, media">
          <div className="grid grid-cols-3 gap-4">
            <Surface className="flex flex-col gap-2 p-5">
              <SectionTitle>Surface</SectionTitle>
              <span className="text-xs text-text-2">bg-surface + 1px rim</span>
            </Surface>
            <Surface raised className="flex flex-col gap-2 p-5">
              <SectionTitle>Raised</SectionTitle>
              <span className="text-xs text-text-2">surface-2 + raised shadow</span>
            </Surface>
            <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#2d3a12,#131517)] p-1">
              <div className="glass flex h-full flex-col gap-2 rounded-xl p-5">
                <SectionTitle>Glass</SectionTitle>
                <span className="text-xs text-text-2">12px blur over content</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="grid flex-1 grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
            <SampleMediaCard />
          </div>
        </Section>
      </div>
    </div>
  );
}
