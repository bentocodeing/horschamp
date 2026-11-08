# Design System

Horschamp's own design system for a dark, media-first desktop tool. The source of truth is `src/styles/tokens.css`; this doc explains how to use it. Open **Settings → Design system** in the app to browse every component.

## 1. Character

- Near-black, cool charcoal backgrounds. Media fills most of the screen and the chrome stays quiet.
- **One accent**: a lime green (`--accent`, `#c6ff3d`) for the primary action, the active nav item, focus rings and selected states. A warm amber (`--accent-2`, `#ffb547`) is reserved for small highlights such as badges and "new" tags.
- Surfaces are built from translucent white overlays on dark (`--fill-1/2/3`), not from opaque greys. Borders are 1px white at 5–20% alpha, often drawn as an inset box-shadow (`--rim`, `--rim-strong`).
- Headings use Space Grotesk; UI text uses Inter at 12–14px, weight 500/600.
- Compact controls: 32px height, 10px radius. Cards and panels use 16–20px radii.
- Motion is quick (about 200ms) with ease-out curves.

## 2. Tokens

All tokens live in `src/styles/tokens.css` and are mapped to Tailwind utilities in `src/styles/globals.css`. Never use raw hex colors in components.

| Group     | Tokens                                                                                      | Notes                                                  |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Surfaces  | `--bg-app`, `--bg-panel`, `--bg-surface`, `--bg-surface-2/3`, `--bg-elevated`, `--bg-glass` | App background → panels → cards → raised controls      |
| Fills     | `--fill-1`, `--fill-2`, `--fill-3`                                                          | White at 5 / 10 / 20%: control fill, hover, pressed    |
| Borders   | `--border-subtle`, `--border-default`, `--border-strong`, `--rim`, `--rim-strong`           |                                                        |
| Text      | `--text-1`, `--text-2`, `--text-3`, `--text-disabled`, `--text-inverse`                     | `--text-inverse` is for text on the accent             |
| Accent    | `--accent`, `--accent-hi`, `--accent-600`, `--accent-a10/15/30/48`, `--accent-gradient`     | Change these alone to re-theme the app                 |
| Highlight | `--accent-2`, `--accent-2-a15`                                                              | Badges and tags only, never for primary actions        |
| Semantic  | `--success`, `--warning`, `--danger`, `--info`                                              | Status, errors, job states                             |
| Type      | `--font-ui`, `--font-heading`, `--font-code`, `--fs-*`, `--lh-*`, `--fw-*`, `--tracking-*`  |                                                        |
| Spacing   | `--sp-*` (4px base)                                                                         |                                                        |
| Radii     | `--r-xs` … `--r-xl`, `--r-full`                                                             | Controls `--r-control`, cards `--r-surface` / `--r-lg` |
| Shadows   | `--sh-*`, `--ring-focus`, `--glow-accent`                                                   |                                                        |
| Blur      | `--blur-xs` … `--blur-xl`                                                                   | Glass panels and popovers                              |
| Motion    | `--ease-*`, `--dur-*`                                                                       | Default: `--dur-normal` with `--ease-out`              |
| Layout    | `--nav-h`, `--sidebar-w`, `--control-h`, `--grid-gap`, `--prompt-bar-max-w`                 |                                                        |

## 3. Typography

- `.heading`: Space Grotesk 700, uppercase, tight tracking (`--tracking-caps`). Use it for screen titles and section labels, not for body text.
- `.eyebrow`: small uppercase labels above sections.
- Body and controls: Inter, `--fs-12` to `--fs-14`, weight 500 or 600.
- Code, IDs and prices: `--font-code`.

## 4. Components

shadcn/ui primitives live in `src/ui/`, rethemed with these tokens. Feature components live in `src/components/<feature>/`.

- **Primary button**: accent gradient background, `--text-inverse` text, `--r-md`, `--sh-btn-lip`. Pressed state darkens and moves down 1px.
- **Secondary / ghost buttons**: `--fill-1` or transparent, `--fill-2` on hover.
- **Parameter pill**: 32px high, `--fill-1`, `--r-sm`, focus ring `--ring-focus`.
- **Cards and panels**: `--bg-surface`, `--r-surface`, `--rim`.
- **Glass popovers**: `--bg-glass` with `--blur-md` and `--sh-popover`.
- **Media cards**: media fills the card, `--media-scrim` at the bottom for captions.
- **Progress and pending tiles**: thin accent bar on a `--fill-2` track; pending tiles use the `tile-sweep` keyframe.

## 5. Motion

- Default transition: `--dur-normal` with `--ease-out`. Panels and dialogs use `--ease-out-expo`.
- Keyframes in `tokens.css`: `tile-sweep`, `text-shimmer`, `fade-in-up-sm`, `pop-in`, `dot-cycle`, `sweep-skew`.
- Respect `prefers-reduced-motion` for anything that loops.

## 6. Changing the look

To re-theme, edit the `--accent*` block in `tokens.css` (and `--accent-2*` for the highlight). The app icon in `src-tauri/icons/` is generated from `src-tauri/icons/source.svg` (the pixel logo arrow from `src/ui/pixel-icon.tsx` on the accent) with `pnpm tauri icon src-tauri/icons/source.svg`; delete the `android/` and `ios/` folders it also creates.
