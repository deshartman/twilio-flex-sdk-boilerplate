---
name: twilio-dev-phone
description: Load this BEFORE answering any question about testing calls or SMS into this Flex agent desktop without a real handset — it holds the install steps, the phone-number overwrite warning and the test flow. Covers the Twilio Dev Phone (Twilio Labs CLI plugin, `twilio dev-phone`) — installing it, choosing or buying a spare (US) number for it, creating and selecting a Twilio CLI profile (`twilio profiles:add` / `profiles:use`) for the Flex sub-account so Dev Phone uses the right account, running it, placing test calls/texts to the Flex number, cleaning up, and recovering a number whose webhooks it wiped. Use when someone asks how to test inbound/outbound voice or SMS, "how do I call my Flex number", "I have no phone / no cell service / my number can't call this country", or mentions Dev Phone.
---

# Twilio Dev Phone — a browser softphone for testing Flex

[Dev Phone](https://www.twilio.com/docs/labs/dev-phone) is a Twilio Labs CLI
plugin that turns a **spare** Twilio number into a phone in a browser tab
(`http://localhost:3001`). In this repo it plays the **customer**: it calls or
texts the Flex number, and the call shows up as a task in the agent desktop
(`http://localhost:3000`). Port 3001 doesn't clash with `npm run dev`.

## ⚠️ It overwrites the number's configuration — never point it at the Flex number

On start, Dev Phone sets the number's **Voice URL, SMS URL and status callback** to
its own Serverless functions. On exit (Ctrl+C) it sets all three to **empty** — it
does **not** restore what was there before. Pointed at the Flex number that means:

- while running, every call and text to the Flex number goes to the Dev Phone tab
  instead of agents (a plain `SmsUrl` also bypasses the Flex Conversations address);
- after exit, the number's voice routing to the Flex **Voice IVR** Studio flow is
  gone, so calls fail until it's re-wired.

So the Dev Phone needs **its own second number**. Before running it, check the
account has one that isn't on Flex and isn't used for anything else (`npm run
configure` → number step labels each number *on Flex* / *not on Flex*; just
answer `n` at the end). If there isn't one, **buy a US number** for it:

- US numbers need **no regulatory bundle**, so they're instant and cheap. A US
  number can still call a Flex number in any country (international rates apply).
- Buy it in the **Flex sub-account** — the account the CLI profile below points
  at (create the profile first; the CLI commands use it). Via Console → Phone Numbers → Buy a number (country US, Voice +
  SMS), or the CLI:
  ```bash
  twilio api:core:available-phone-numbers:local:list -p flex-dev --country-code US --voice-enabled --sms-enabled --limit 5
  twilio api:core:incoming-phone-numbers:create -p flex-dev --phone-number +1XXXXXXXXXX
  ```
  Show the user the number and that it costs a monthly fee, and get a yes before
  buying — never buy silently.
- **SMS caveat:** a US local number texting **US** destinations needs A2P 10DLC
  registration or texts get blocked. Voice is unaffected, and texting a non-US Flex
  number isn't 10DLC traffic. If the Flex number is US and SMS must be tested, use a
  verified toll-free number or test voice only.

Guard rails built into the plugin, worth knowing:

- `--phone-number <n>` **refuses** a number that already has a non-default Voice or
  SMS URL (a Flex number does) unless `--force` is given. **Never suggest `--force`
  for the Flex number.**
- Picking a number in the browser UI's dropdown does **not** run that check — it
  overwrites whatever you pick. Tell the user to always start with
  `--phone-number` so the number is fixed up front.

## Install

Prerequisites: Node.js, the [Twilio CLI](https://www.twilio.com/docs/twilio-cli/quickstart),
and an **upgraded (paid) account** — trial accounts aren't supported.

```bash
twilio plugins:install @twilio-labs/plugin-dev-phone
twilio dev-phone --help        # confirms it's installed
```

## Required: a CLI profile for the Flex account — always walk the user through this

Dev Phone has no account flag of its own: it works in **whatever account the
active Twilio CLI profile points at**. It creates its services there, lists that
account's numbers, and places calls from there. If the profile is for the parent
account, a personal account or a different sub-account, `--phone-number` fails
with "not associated with your Twilio account" or the number picker shows the
wrong numbers. The CLI's default profile is almost never the Flex sub-account, so
**don't skip this step, even if the user has used the CLI before.** Tell them to:

1. Create a profile for the account that has Flex and the Dev Phone number. Use
   the **same Account SID and Auth Token used for `npm run configure`**:
   ```bash
   twilio profiles:add ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX -p flex-dev
   ```
   The CLI prompts for the Auth Token without showing it as it's typed. Don't
   pass `--auth-token` on the command line, because it would be saved in shell
   history. The CLI then creates an API key for the profile.
2. Make it the active profile, then confirm it's the one marked active:
   ```bash
   twilio profiles:use flex-dev
   twilio profiles:list
   ```
3. (Belt and braces) also pass `-p flex-dev` to `twilio dev-phone`, so the right
   account is used even if the active profile changes later.

Gotcha: `TWILIO_ACCOUNT_SID` / `TWILIO_API_KEY` / `TWILIO_AUTH_TOKEN` environment
variables in the shell **override the active profile**. A user who ran
`set -a; . ./.env.local` in that terminal will get those credentials instead.
Running `twilio dev-phone` in a fresh terminal avoids this. The profile's
credentials live in the CLI's own config (`~/.twilio-cli`), not in this repo.

## Test a call into Flex

1. `npm run dev`, sign in at `/login`, set the agent to **Available**.
2. In another terminal, with the profile from the step above:
   `twilio dev-phone -p flex-dev --phone-number +1XXXXXXXXXX` (the spare
   number). It creates a Sync service, a Conversations service, a
   Serverless service and a TwiML App, wires the number, and opens
   `http://localhost:3001` (`--headless` to skip opening; `--port` to move it).
3. In the Dev Phone tab, enter the **Flex number** as the destination and click
   **Call** (or send an SMS). The task rings in the agent desktop → Accept.
4. Outbound from Flex works too: dial the Dev Phone number from the agent
   desktop's dialpad and answer it in the Dev Phone tab.
5. Stop with **Ctrl+C** in the Dev Phone terminal — it deletes the resources it
   created and blanks the Dev Phone number's webhooks.

If nothing rings: the agent isn't Available, the Flex number isn't routed (run the
`npm run configure` number step), or the active CLI profile is a different account
from the one the agent is logged into (`twilio profiles:list`).

## Cleanup and recovery

- **Crashed or killed without Ctrl+C:** leftovers are removed on the next run, or
  run `twilio dev-phone --clear` to remove all Dev Phone resources first. (`--clear`
  only blanks numbers whose Voice *and* SMS URLs both start with `https://dev-phone`.)
- **Dev Phone ran against the Flex number by mistake:** run `npm run configure`
  and choose that number in the number step — it re-points voice at the Voice IVR
  flow and restores the SMS routing, after showing the change and asking `y`.
- Multiple people sharing one account should each use their own Dev Phone number;
  `--clear` affects every Dev Phone instance on the account.

## Rules

- This is a public repo: never write the user's phone numbers, SIDs or tokens into
  repo files — use placeholders like `+1XXXXXXXXXX`.
- Don't run `twilio dev-phone` yourself without the user's go-ahead — it changes a
  live number. Prefer giving them the command to run (`! twilio dev-phone …`).
- For number setup and Flex routing details use the `flex-sdk-boilerplate` skill.
