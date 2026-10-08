---
name: flex-sdk-boilerplate
description: Load this BEFORE searching or reading code for any question about setting up, running, configuring, logging in to, debugging or understanding this repo — it holds the setup steps, error-to-fix table and architecture map, so no grep is needed. Guide for this Twilio Flex SDK Next.js agent-desktop boilerplate — getting it running, connecting a live Flex account (npm run configure), choosing the login username, troubleshooting login/token/API-key errors, and explaining or extending the codebase (features, SDK wrappers, store, i18n, theming, plugins, live transcript). Use when someone asks how to set up, run, configure, debug, or extend this repo, or asks a question the README would answer.
---

# Twilio Flex SDK boilerplate — interactive guide

You are standing in for the README. Answer conversationally, and **check the user's
actual state before advising** (env file, running server, live account) rather than
reciting docs. Never print secret values — show SIDs masked (`AC1234…cdef`) and
secrets/tokens only as "set" / "empty".

## Getting it running

1. `npm install` (pnpm works; the repo is npm-canonical — `pnpm-lock.yaml` and
   `pnpm-workspace.yaml` are gitignored, don't commit them).
2. Optional live account: `npm run configure` (or `pnpm configure` — **not**
   `pnpm setup`, which is a pnpm built-in).
3. `npm run dev` → open `http://localhost:3000`. `/` redirects to `/login`; a
   successful sign-in routes to `/agent-desktop`.

With no credentials the app runs in **stub mode**: `/api/token` returns a
`STUB.…STUB` token and the whole UI is explorable offline. Live mode turns on when
`TWILIO_ACCOUNT_SID` + `TWILIO_API_KEY` + `TWILIO_API_SECRET` are all set.

## Connecting a live Flex account

Steer users to `npm run configure` (`scripts/setup.mjs`). It needs only the
**Account SID** and **Auth Token** of the (sub-)account that has Flex, then:
verifies them → reads Flex Configuration (instance `GO…` + workspace `WS…`) →
reuses or creates a Sync service named "Flex SDK Boilerplate" → keeps a working
API key or creates a **Standard** one → lists valid agent usernames and asks which
to use → merges the keys into `.env.local` (or `.env` if it is the only env file).
Re-runnable. The user must restart the dev server afterwards — Next reads env only
at startup. `PUBLIC_BASE_URL` (tunnel for live transcript) is still manual.

Prerequisite: Flex must be provisioned **and someone must have logged into hosted
Flex once** (Console → Flex → Overview → Launch Flex). That first login creates the
Flex user and its TaskRouter worker; until then there is nobody to log in as.

## Phone numbers for Flex

`npm run configure` ends with an optional number step (`scripts/lib/phoneNumber.mjs`):
use an existing number or buy one; for regulated countries reuse an approved bundle
in the account or clone one from a parent account (parent SID + Auth Token, hidden,
not stored); then route it into Flex. "On Flex" means exactly two things, mirroring
the numbers Flex provisions itself:

- **Voice:** `VoiceUrl` = `https://webhooks.twilio.com/v1/Accounts/{AC}/Flows/{FW}`
  for the Studio flow named **Voice IVR**.
- **SMS:** a Conversations address (`/v1/Configuration/Addresses`, `Type=sms`)
  with `AutoCreation.Type=studio` → the flow named **Messaging Flow**, on the Flex
  chat service (`chat_service_instance_sid` from Flex Configuration), and the
  number's plain `SmsUrl` cleared — a leftover `SmsUrl` (e.g. `demo.twilio.com`)
  bypasses the address and texts never reach agents.

Purchases and re-routing always show what will change and need a `y`. US/CA need no
bundle (they list regulations but don't require one). A brand-new bundle needs
documents + Twilio review (~24 business hours) — Console only, then re-run.
`npm run clone-bundle` is the standalone clone (source/target SIDs, Bundle SID,
source Auth Token).

To place test calls/texts into Flex without a handset, use the `twilio-dev-phone`
skill. Dev Phone needs a **second** number (it overwrites and then blanks that
number's webhooks), so buy a cheap US one rather than reusing the Flex number.

## The login username — the #1 point of confusion

The login form wants the **Flex username**, which on SSO accounts is usually the
login handle (`jdoe`), **not** the email (`jdoe@company.com`). `/api/token` looks it
up via `GET flex-api/v4/Instances/{GO}/Users?Username=…` (exact match; that API
can't list users). To discover valid names: list TaskRouter workers in the Flex
workspace — Flex names each worker after its username — and confirm each via the
Users API. `npm run configure` does exactly this. Setting `TWILIO_FLEX_USERNAME`
pre-fills the form.

## Troubleshooting

Diagnose with read-only calls, sourcing the env file in a subshell
(`set -a; . ./.env.local; set +a`) and authenticating with the API key pair.

| Symptom | Likely cause → fix |
| --- | --- |
| Lands on a "Twilio Flex SDK Boilerplate" card with Primary/Secondary/Danger buttons | Old build before the `/` → `/login` redirect. Go to `/login`. |
| `username_required` (400) | Form blank and no `TWILIO_FLEX_USERNAME`. |
| `flex_user_not_found` | Wrong username (email vs handle), no hosted-Flex login yet, **or** the API key can't see the instance — this code also masks auth failures; the real HTTP status is in the dev-server log (`Flex user lookup failed (401)`). |
| Twilio error **8001** "actor doesn't have any assertions" | Restricted API key with no permissions. Create a **Standard** key (or run `npm run configure`). |
| 401 / 70051 on every call | Key belongs to a different account than `TWILIO_ACCOUNT_SID`; keys only work in the account that created them. |
| `flex_config_unavailable` / Configuration 404 | Flex not provisioned on this account, or key lacks access (Twilio returns 404 for resources a key can't see). |
| `TWILIO_FLEX_INSTANCE_SID` starts with `AC` | Pasted the Account SID. It must be `GO…`, or blank to auto-discover. |
| `GET Accounts/{AC}.json` → 401 with an API key | Expected — only the Auth Token can read the account record. Not a fault. |
| Queue Stats "not configured" | Needs `TWILIO_AUTH_TOKEN` + `TWILIO_WORKSPACE_SID`. |
| Calls/texts to a number don't reach Flex | Run `npm run configure` → number step; it labels each number on/not on Flex and fixes the routing. |
| Can't buy a number: bundle required | Reuse/clone via the number step, or create one in Console → Regulatory Compliance (review ~24 business hours). |
| Transcript tab "not configured" | Needs `TWILIO_SYNC_SERVICE_SID` + `PUBLIC_BASE_URL` (ngrok). |
| Login works, `activities` empty in `/api/token` | `TWILIO_WORKSPACE_SID` unset; the SDK still loads activities after connect. |

## Environment variables

Source of truth: `.env.example` (commented). Required for live: `TWILIO_ACCOUNT_SID`,
`TWILIO_API_KEY`, `TWILIO_API_SECRET`. Everything else is optional and only enables
a feature: `TWILIO_FLEX_USERNAME` (form default), `TWILIO_FLEX_INSTANCE_SID`
(auto-discovered), `TWILIO_WORKSPACE_SID` + `TWILIO_AUTH_TOKEN` (Queue Stats; the
token also validates transcription callbacks), `TWILIO_SYNC_SERVICE_SID` +
`PUBLIC_BASE_URL` (live transcript), `NEXT_PUBLIC_FLEX_SSO_PROFILE_SID` (SSO login),
`TRANSCRIPTION_*` (transcription defaults, overridable in-app). The routes that read
them are under `src/app/api/` — check there when behaviour and docs disagree.

Why an API key is still needed even with the Auth Token: the Sync access token for
the live transcript is a JWT signed with an API key secret; an Auth Token can't sign
it. A key's secret is only returned at creation, so it must be stored, not minted
per server start.

## Auth & token lifecycle

Two paths, both via `POST /api/token`: **custom token** (default — mints a Flex user
token for a username via SDK Auth Option 3, `src/lib/flex/server/flexToken.ts`) and
**SSO/OAuth** (when `NEXT_PUBLIC_FLEX_SSO_PROFILE_SID` is set; `exchangeToken`
callback on the login page). Custom tokens have a 1-hour TTL; a self-managed loop
re-mints ~1 min before expiry and rotates via `client.updateToken(...)`, with a
`TokenAutoUpdateFailed` fallback. The login identity is persisted so sessions
survive reload. SSO uses the SDK's native `autoUpdateToken`.

## Codebase map (for "how does X work" / "add Y")

`CLAUDE.md` has the binding conventions — read it before changing code. Essentials:

- **SDK is browser-only.** All SDK code is `'use client'` and loaded via
  `next/dynamic({ ssr: false })`; never import it in Server Components or routes.
- **SDK boundary `src/lib/flex/`**: `client.ts` singleton, `actions/` wrappers per
  domain (Worker, Task, Voice, Conversation, Supervisor), `events.ts` event→store
  bridge, `errors.ts`, `provider.tsx`, `server/` (token minting, TaskRouter REST).
  Feature code calls the wrappers — never `new` SDK Actions directly. Actions are
  classes run positionally (`client.execute(new X(a, b))`); verify constructor
  shapes in `node_modules/@twilio/flex-sdk/actions/<Domain>/index.d.ts` first.
- **Store `src/store/`**: Zustand, slices in `slices/` (session, presence, tasks,
  voice, conversations, supervisor, settings) composed into `useFlexStore`.
- **Features `src/features/<f>/`** (components/hooks/messages): voice, tasks,
  conversations, presence, queues, supervisor, directory, transcript; `session`
  assembles the desktop shell.
- **Routes**: `src/app/(auth)/login`, `src/app/agent-desktop`, `src/app/api/*`
  (token, sync-token, queue-stats, transcription/start + callback).
- **i18n**: no hardcoded user strings (`react/jsx-no-literals` is an error). Core
  catalogs `src/i18n/messages/<locale>/<ns>.json`; feature catalogs
  `src/features/<f>/messages/<locale>.json`; auto-discovered. 12 locales, all
  complete — add keys to every locale.
- **Theming**: semantic Tailwind tokens over `src/theme/tokens.css` (`bg-bg`,
  `bg-surface`, `text-muted`, `bg-primary`…), never raw hex.
- **Plugins**: `PluginManifest` with `register(host)` contributing to `nav-item`,
  `side-panel`, `task-panel`, `header-action`, `settings-page`. Enable by adding to
  `enabledPlugins` in `src/plugins/index.ts`. Read-only `host.store`; never import
  `@/store`. Copy `src/plugins/example/`; details in `src/plugins/README.md`.
- **Live transcript**: `/api/transcription/start` starts Real-Time Transcription
  on the agent's call leg → Twilio posts to `/api/transcription/callback` (signature
  validated with the Auth Token) → published to Sync stream `session-<CallSid>` →
  `TranscriptPanel` subscribes via `twilio-sync`.

For changing how the desktop looks or what it shows (layout, colours, sizing,
adding/removing panels, tabs, rail items), use the `flex-sdk-ui` skill — it has the
screen-to-file map and change recipes.

## Making changes

TDD: write the failing test in `__tests__/` beside the code first. Done means
`npm run test:run`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` are all
clean. A couple of UI tests occasionally hit the 5s timeout under full-suite load;
re-run before assuming a regression.
