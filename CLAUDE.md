@AGENTS.md

# Twilio Flex SDK — Next.js Agent Desktop Boilerplate

A production-shaped agent desktop built on `@twilio/flex-sdk` 4.1.0. Next.js 15
(App Router) + React 19 + TypeScript (strict). Multi-lingual, themeable
(light/dark), plugin-extensible, and branded to Twilio's design guidelines.

## Commands

- `npm run dev` — dev server with Fast Refresh (the live SDK session lives in a
  module singleton so a UI hot-reload won't drop an active call).
- `npm run build` / `npm start` — production build / serve.
- `npm test` — Vitest watch. `npm run test:run` — single run (use in CI/gates).
- `npm run lint` — ESLint.

**Definition of done for any change:** `npm run test:run`, `tsc --noEmit`,
`npm run lint`, and `npm run build` all clean. Keep them green.

## The SDK is browser-only and its APIs are non-obvious

`@twilio/flex-sdk` runs only in the browser. All SDK code must sit behind
`'use client'` and be loaded via `next/dynamic({ ssr: false })` — never import it
into a Server Component or route handler.

Actions are **classes** run positionally: `client.execute(new SomeAction(arg1, arg2))`.
Argument shapes differ from intuition (several are positional where you'd expect
an options object, and a few Voice args are reversed). **Before writing any SDK
call, verify the constructor against `node_modules/@twilio/flex-sdk/actions/<Domain>/index.d.ts`.**
Event listeners (`AddVoiceEventListener`, `AddConversationEventListener`) are also
Action classes — one event-type per instance; casting them to a callback and
invoking them throws at runtime.

## Architecture

- `src/lib/flex/` — the SDK boundary. `client.ts` owns the `initFlexClient` /
  `getFlexClient` singleton; `actions/` wraps every Action class per domain
  (Worker, Task, Voice, Conversation, Supervisor); `events.ts` bridges SDK
  events into the store; `errors.ts` normalizes errors; `provider.tsx` is the
  client-side React provider. **Feature code calls these wrappers — it does not
  `new` SDK Actions directly.**
- `src/store/` — Zustand. `index.ts` composes six slices
  (`session`, `presence`, `tasks`, `voice`, `conversations`, `supervisor`) into
  `useFlexStore`. Each slice is a `create<Name>Slice: StateCreator<...>`.
- `src/features/<feature>/` — vertical slices (`components/`, `hooks/`,
  `messages/`). This is where domain UI lives. `session` assembles the desktop
  shell.
- `src/components/` — cross-cutting UI: `ui/` primitives, `layout/`, `theme/`
  (next-themes toggle), `i18n/`, `plugins/` (host runtime).
- `src/i18n/` — `loadMessages.ts` auto-discovers catalogs (see i18n below).
- `src/plugins/` — plugin registry, types, and the disabled example plugin.
- `src/theme/tokens.css` + `tailwind.config.ts` — brand tokens (see Brand).

## Internationalization — every user string is translatable

next-intl, cookie-based (no locale routing), switchable at runtime without
reload. **No hardcoded user-facing strings** — `react/jsx-no-literals` is an
error-level rule enforcing this (only glyphs/separators are allowlisted in
`eslint.config.mjs`). Use `useTranslations('<namespace>')`.

Catalogs are auto-discovered by `loadMessages` — add a new one with **zero edits**
to the loader:
- Core namespaces: `src/i18n/messages/<locale>/<namespace>.json`
- Feature namespaces: `src/features/<feature>/messages/<locale>.json` (namespace = feature folder name)

`en` is complete; `es` is a partial stub (core catalog only).

## Theming — light and dark are both first-class

`next-themes` with the `class` strategy over CSS variables in
`src/theme/tokens.css`. Style with the semantic Tailwind tokens
(`bg-bg`/`bg-surface`/`text`/`text-muted`/`border`/`bg-brand`/`bg-primary`/`bg-danger`,
plus the red/blue/neutral scales) — **not** raw hex — so both themes track
automatically.

## Brand

Palette, typography, and logo are Twilio's real guideline values (extracted from
the brand portal, recorded in the design spec §8), not approximations. Primary
red `#F22F46`; primary action Blue-500 `#1866EE`. **Twilio Sans (v2.000) is
self-hosted** — Text/Display/Mono `.woff2` under `src/theme/fonts/`, wired via
`next/font/local` in `src/theme/fonts.ts` and exposed as the `--font-text` /
`--font-display` / `--font-mono` CSS vars Tailwind maps to `font-sans` /
`font-display` / `font-mono`. Roman weights only; add more `.woff2` + `src`
entries to extend. Source Sans Pro / Inter remain as fallbacks. Twilio Sans is
proprietary — these files are licensed to this project; confirm redistribution
terms before publishing the repo. Logo: `public/brand/twilio-logo.svg`.

## Plugins

Extensible from day one; ships with none enabled. A plugin is a `PluginManifest`
(`src/plugins/types.ts`) whose `register(host)` contributes into one of five
slots: `nav-item`, `side-panel`, `task-panel`, `header-action`, `settings-page`.
Plugins get **read-only** store access via `host.store` and **must not** import
`@/store` directly. Plugin i18n catalogs are auto-merged by the same loader. See
`src/plugins/README.md` and `src/plugins/example/` for the pattern.

## Auth

`/api/token` (`src/app/api/token/route.ts`) mints the session token and boots
without a live Twilio account (stub-ready). Swap in real credentials via env
with no code changes.

## Conventions

- TDD: write the failing test first, then the minimal implementation. Tests live
  in `__tests__/` beside the code.
- Keep the SDK boundary intact — new SDK capabilities go through a wrapper in
  `src/lib/flex/actions/` and (if event-driven) `events.ts`, then a feature hook.
- Follow the existing slice/feature/wrapper patterns rather than introducing new
  ones.

## Project skills — load before exploring

- **UI questions or changes** (where something is rendered, layout, colours,
  sizing, branding, adding/removing panels, tabs, rail items): invoke the
  `flex-sdk-ui` skill first — it maps each screen area to its file.
- **Setup, login, env, troubleshooting, architecture**: invoke the
  `flex-sdk-boilerplate` skill first.

## Docs

Design spec: `docs/superpowers/specs/2026-07-26-twilio-flex-sdk-nextjs-boilerplate-design.md`
(SDK feature inventory + gap analysis vs. the demo, full brand palette).
Implementation plans: `docs/superpowers/plans/` (parts 1–8).
