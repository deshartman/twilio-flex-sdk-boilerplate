---
name: flex-sdk-ui
description: Load this BEFORE searching or reading code for any question or change about this repo's UI — it maps every screen area to its file, so no grep is needed. Covers the agent-desktop UI in this Twilio Flex SDK boilerplate and how to change it — layout (header, icon rail, three resizable columns, task workspace tabs, right Transcript/CRM panel), colours and theme tokens (light/dark), fonts, sizing/spacing, branding/logo, adding or removing panels, tabs, rail items, header controls and modals, and plugin slots. Use when someone wants to restyle, rebrand, resize, add, remove, move or rename any part of the UI, or asks "where is X rendered" / "which file draws Y".
---

# Agent-desktop UI — map and change guide

The user will usually describe a change in visual terms ("make the left column
narrower", "remove Queues", "our brand is green", "put a CRM button in the
header"). Translate that into the file(s) below, make the **smallest** change, and
keep the repo's rules (i18n, tokens, tests). For setup/login/env questions use the
`flex-sdk-boilerplate` skill instead.

Before editing, read the file you're changing — this map is a guide, the code is
the source of truth. If a request is ambiguous (e.g. "make it bigger" — the text?
the column? the buttons?), ask one short question rather than guessing.

## Screen anatomy

```
/login  →  src/app/(auth)/login/page.tsx   (Card, username input, sign-in Button)

/agent-desktop  →  src/features/session/components/AgentDesktopShell.tsx
┌──────────────────────────────────────────────────────────────────────────┐
│ header: Logo · [header-action slot] ThemeToggle LocaleSwitcher |         │
│         AudioSettingsMenu | ActivitySelector                             │
├────┬───────────────┬──────────────────────────────┬──────────────────────┤
│Icon│ LEFT 24%      │ MIDDLE 50%                   │ RIGHT 26%            │
│Rail│ TaskList      │ SelectedTaskDetail           │ RightPanel           │
│    │  └ TaskCard×n │  ├ (none) "Select a task"    │  tabs: Transcript    │
│Desk│               │  └ TaskWorkspace             │  (only during a call)│
│Team│               │     header: contact + status │  + CRM               │
│Dial│               │     tabs: Call|Conversation, │  ├ TranscriptPanel   │
│Queu│               │           Notes, Info        │  └ CrmPanel          │
│    │               │  [task-panel slot]           │     [side-panel slot]│
└────┴───────────────┴──────────────────────────────┴──────────────────────┘
 Rail "Teams" → SupervisorPanel (full width)   "Queues" → QueuesView (full width)
 "Dialpad" → OutboundDialer modal
```

| Area | File | Notes |
| --- | --- | --- |
| Header bar | `AgentDesktopShell.tsx` (`<header>`) | Order of controls is just JSX order; `Separator` draws the dividers. |
| Logo | `src/components/ui/Logo.tsx` → `public/brand/twilio-logo.svg` | Swap the SVG or the `src`; size via `className` in the header (`h-8 w-auto`). |
| Icon rail | `src/components/layout/IconRail.tsx` | `ACTIONS` array drives it; `DesktopView` union types the views. Width `w-14`. |
| Columns | `src/components/layout/ResizableColumns.tsx` | `react-resizable-panels`; `defaultSize`/`minSize` are **percent**. |
| Task list | `src/features/tasks/components/TaskList.tsx`, `TaskCard.tsx` | Status chip colours in `STATUS_STYLES`, channel icon tint in `CHANNEL_ICON_STYLES`. |
| Middle placeholder | `src/features/session/components/SelectedTaskDetail.tsx` | Empty-state card. |
| Task workspace | `src/features/session/components/TaskWorkspace.tsx` | Header, tab list (`tabs` memo), panel switch. |
| Incoming task | `src/features/tasks/components/IncomingTaskPanel.tsx`, `ChannelBadge.tsx` | Accept/decline screen; channel pill accents in `ACCENTS`. |
| Call controls | `src/features/voice/components/CallPanel.tsx` | Round buttons, timer, participants. |
| Chat | `src/features/conversations/components/` | `MessageList` (bubbles, `max-w-[70%]`), `MessageComposer`, `EmailComposer`, modals. |
| Notes / Info / Wrap-up | `src/features/tasks/components/NotesTab.tsx`, `TaskAttributesView.tsx`, `WrapUpForm.tsx` | |
| Right panel | `src/components/layout/RightPanel.tsx` | Tab list + mounted-but-hidden panels. |
| CRM area | `src/components/layout/CrmPanel.tsx` | Empty state + `side-panel` slot. |
| Transcript | `src/features/transcript/components/TranscriptPanel.tsx` | |
| Presence | `src/features/presence/components/ActivitySelector.tsx` | |
| Queues / Teams views | `src/features/queues/components/QueuesView.tsx`, `src/features/supervisor/components/` | |
| Theme toggle | `src/components/theme/ThemeToggle.tsx`, `ThemeProvider.tsx` | `defaultTheme="light"`, `enableSystem={false}`. |
| Language picker | `src/components/i18n/LocaleSwitcher.tsx`; locales in `src/i18n/config.ts` | |

Primitives in `src/components/ui/`: `Button` (variants primary/secondary/danger/
ghost), `IconButton` (round, `label` required, `size` px), `Card`, `Tabs`
(controlled, renders only the tab strip), `Popover` (`portal` inside scroll
containers), `Separator`, `Drawer`; effects `magic/BorderBeam`,
`magic/ShimmerButton`. Icons: `lucide-react` (`WhatsAppIcon` is the one custom).
Reuse these before writing new markup.

Unused today (fine to wire up or delete if asked): `layout/AppHeader.tsx`,
`ui/Drawer.tsx`.

## Colours and theme

Three layers — change the highest one that achieves the request:

1. **Semantic tokens** — `src/theme/tokens.css`. `:root` = light, `.dark` = dark.
   `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`,
   `--color-text`, `--color-text-muted`, `--color-brand`, `--color-primary`
   (+ `-hover`, `-soft`), `--color-danger|success|warning|info` (+ `-soft`).
   **A rebrand is usually just these lines.** Update both `:root` and `.dark`.
   `-soft` tints are translucent `rgba(...)` defined once in `:root` — if the base
   colour changes, recompute the rgba to match.
2. **Raw scales** — same file, `--red-*`, `--blue-*`, `--neutral-*` (Twilio brand
   values). Add a new scale (e.g. `--green-*`) here and expose it in
   `tailwind.config.ts` `colors` if components need it directly.
3. **Tailwind mapping** — `tailwind.config.ts` maps tokens to classes:
   `bg-bg`, `bg-surface`, `bg-surface-2`, `border-border`, `text-text`,
   `text-muted`, `bg-brand`, `bg-primary`/`hover:bg-primary-hover`/`bg-primary-soft`,
   `text-danger`/`bg-danger-soft`, `success`, `warning`, `info`, plus
   `red-50…900`, `blue-…`, `neutral-…`.

Rules: never put raw hex in components (both themes must track). Opacity
modifiers (`bg-primary/20`) don't work on these `var()` colours — use the `-soft`
tokens or add a new token. Light primary is blue-500, dark primary is blue-300 —
check contrast in **both** themes after any colour change (toggle in the header).
Known exception: `TaskCard` status chips deliberately use opaque `bg-surface` +
ring instead of `-soft` (comment explains why) — keep that when restyling.

`globals.css` holds the body background, the `.mui-border-beam` effect, and the
reduced-motion overrides. Animations (`status-ping`, `bubble-in`, `shimmer-slide`,
`spin-around`) are keyframes in `tailwind.config.ts`.

## Fonts

`src/theme/fonts.ts` (`next/font/local`) loads Twilio Sans Text/Display/Mono from
`src/theme/fonts/*.woff2` as `--font-text|display|mono`; Tailwind maps them to
`font-sans` (body, set on `<body>` in `src/app/layout.tsx`), `font-display`
(headings), `font-mono` (timers, numbers). To change typeface: replace the files and
`src` entries, or switch to `next/font/google` and keep the same `variable` names so
nothing else changes. Twilio Sans is proprietary — a fork going public should
replace it or confirm licence terms.

## Sizing and spacing

- **Column widths**: `ResizableColumns.tsx` `defaultSize` (must sum to 100) and
  `minSize`. Widths **persist in localStorage** (`autoSaveId="flex-desktop-columns"`),
  so a changed default won't appear until the user drags, clears site data, or you
  change the `autoSaveId`. Tell the user this.
- **Rail width** `w-14` and button height `h-11` in `IconRail.tsx`.
- **Header height** comes from `py-3` + the 40px controls (`h-10` ThemeToggle,
  `h-8` logo).
- **Density** is plain Tailwind spacing (`p-4`, `gap-4`, `px-3 py-2.5` on task
  cards). Global type scale: change `fontSize` in `tailwind.config.ts`
  `theme.extend`, or set a base size on `body` in `globals.css`.
- Arbitrary values already in use (`text-[10px]`, `max-w-[70%]`, `h-[200px]`) are
  local — grep for them when asked to "make the small text bigger".

## Common changes — recipes

**Remove a rail item** (e.g. Queues): delete its entry from `ACTIONS` in
`IconRail.tsx`, its branch in `AgentDesktopShell.tsx`, and the view from
`DesktopView` if no longer used. Update `IconRail.test.tsx` /
`AgentDesktopShell.test.tsx`. Leave the feature folder unless asked to delete it.

**Add a rail view**: add to `DesktopView`, add an `ACTIONS` entry (lucide icon +
`labelKey`), add `rail.<key>` to **all 12** `src/features/session/messages/<locale>.json`,
and render it in the `view === …` chain in `AgentDesktopShell.tsx`.

**Add a header control**: put it in the `<header>` in `AgentDesktopShell.tsx`
(use `IconButton` or a `Popover` trigger), or — if it's integration-specific —
contribute it as a plugin `header-action` so core stays untouched.

**Remove/replace a column**: `ResizableColumns` takes `left`/`middle`/`right`. To
drop one, give the component an optional prop and skip its `Panel` +
`ColumnHandle`, re-balancing `defaultSize`; or render a two-panel `PanelGroup`.
Tests cover `RightPanel` — keep the Transcript tab logic if the right column stays.

**Add a tab to the task workspace**: extend `TabId`, the `tabs` memo, and the panel
switch in `TaskWorkspace.tsx`; label under `workspace.tabs.*` in the session
catalogs. For the right panel, same pattern in `RightPanel.tsx` (`transcript`
catalog). Panels that hold live state are kept mounted and hidden with `hidden`,
not unmounted — follow that.

**Rebrand**: `tokens.css` (`--color-brand`, `--color-primary*`, maybe neutrals),
`public/brand/` logo + `Logo.tsx` alt/size, `metadata.title` in
`src/app/layout.tsx`, `src/app/favicon.ico`, and `title`/`subtitle` strings in the
session catalogs for the login card.

**Add a modal**: copy an existing one (e.g. `OutboundDialer.tsx`):
`role="dialog"` + `aria-label`, `fixed inset-0 z-50 … bg-black/40`, a `Card`
inside, `open`/`onClose` props controlled by the shell.

**Change empty-state text**: it's in the catalogs, not the JSX — e.g. CRM
`src/i18n/messages/<locale>/crm.json`, no-selection `session.desktop.noSelection`.

## Plugin slots — for additions that shouldn't touch core

Rendered today: `header-action` (header), `task-panel` (under the task
workspace), `side-panel` (top of CrmPanel). **`nav-item` and `settings-page` are
accepted by the registry but no `<PluginSlot>` renders them yet** — a plugin
contributing there shows nothing until you place `<PluginSlot name="nav-item" />`
(e.g. in `IconRail`). Pattern: copy `src/plugins/example/`, add to
`enabledPlugins` in `src/plugins/index.ts`; see `src/plugins/README.md`. Prefer a
plugin when the user's change is customer- or integration-specific (CRM widget,
custom header button); edit core when they're reshaping the product itself.

## Rules every UI change must keep

- **No hardcoded user-facing text** — `react/jsx-no-literals` fails lint. Add keys
  with `useTranslations('<ns>')`, to **every locale** (12: see
  `src/i18n/config.ts`). Feature strings: `src/features/<f>/messages/<locale>.json`;
  core: `src/i18n/messages/<locale>/<ns>.json`. English text in other locales is
  acceptable as a placeholder if the user doesn't want translations — say so.
- **Tokens, not hex**; check light **and** dark.
- **Accessibility**: icon-only buttons need `aria-label` (`IconButton` enforces
  `label`); keep `role="tab"`/`aria-selected`, `role="dialog"`, `aria-current`.
  Tests query by role + name, so renaming a label can break them — update tests.
- **SDK stays behind the boundary**: UI components call hooks/wrappers from
  `src/features/*/hooks` or `src/lib/flex/actions`, never `new` SDK actions.
- **TDD for behaviour** (shown/hidden, new tab, removed item): update or add the
  test in the sibling `__tests__/` first. Pure restyles (colours, spacing) usually
  need no test; only `Button.test.tsx` asserts classes.
- Done = `npm run test:run`, `npx tsc --noEmit`, `npm run lint`, `npm run build`
  clean. Then ask the user to look at it in `npm run dev` (stub mode shows the
  shell; tasks, calls and the Transcript tab only appear with a live account).

Small known gaps worth mentioning if relevant (don't fix unasked):
`ThemeToggle`'s `aria-label="toggle theme"` isn't translated, and the login button
reads "Continue in demo mode" (`session.demoMode`) even when signing in live.
