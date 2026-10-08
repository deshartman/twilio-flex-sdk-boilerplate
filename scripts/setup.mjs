#!/usr/bin/env node
// One-time live setup. From an Account SID + Auth Token, discover or create
// everything else the app needs and write it to the env file.
//
//   npm run configure   (or: pnpm configure)
//
// Safe to re-run: a working API key and an existing Sync service are reused;
// only missing or broken values are replaced. Plain Node (>= 20), no deps.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SetupError, twilioClient, failure, mask, createPrompter } from './lib/twilio.mjs';
import { setupPhoneNumber } from './lib/phoneNumber.mjs';

export { SetupError, twilioClient };

export const RESOURCE_NAME = 'Flex SDK Boilerplate';

const API = 'https://api.twilio.com/2010-04-01';
const FLEX_API = 'https://flex-api.twilio.com';
const SYNC_API = 'https://sync.twilio.com/v1';
const TASKROUTER_API = 'https://taskrouter.twilio.com/v1';

// --- env file -------------------------------------------------------------

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Set each key in place (keeping comments/order), appending keys not present. */
export function mergeEnv(text, updates) {
  let out = text;
  const appended = [];
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(out)) out = out.replace(re, () => `${key}=${value}`);
    else appended.push(`${key}=${value}`);
  }
  if (appended.length > 0) {
    const sep = out && !out.endsWith('\n') ? '\n' : '';
    out = `${out}${sep}${appended.join('\n')}\n`;
  }
  return out;
}

/** Write to `.env` only when it is the sole env file; otherwise `.env.local`. */
export function pickEnvFile(exists) {
  return exists('.env') && !exists('.env.local') ? '.env' : '.env.local';
}

// --- Twilio REST ----------------------------------------------------------

export async function verifyAccount(req, accountSid) {
  if (!/^AC[0-9a-f]{32}$/.test(accountSid)) {
    throw new SetupError('Account SID must look like AC followed by 32 hex characters.');
  }
  const r = await req('GET', `${API}/Accounts/${accountSid}.json`);
  if (!r.ok) {
    throw new SetupError(
      `Account SID / Auth Token rejected (${r.status}). Copy both from the Console ` +
        'home page of the account (or sub-account) that has Flex.',
    );
  }
  return r.body.friendly_name;
}

export async function getFlexConfig(req) {
  const r = await req('GET', `${FLEX_API}/v1/Configuration`);
  if (r.status === 404) {
    throw new SetupError(
      'Flex is not set up on this account. In the Console open Flex → Overview, ' +
        'launch Flex once, then re-run.',
    );
  }
  if (!r.ok) throw failure('Flex Configuration fetch', r);
  return {
    instanceSid: r.body.flex_instance_sid,
    workspaceSid: r.body.taskrouter_workspace_sid,
    chatServiceSid: r.body.chat_service_instance_sid,
  };
}

/** Reuse the configured Sync service, else one named RESOURCE_NAME, else create it. */
export async function ensureSyncService(req, existingSid) {
  const r = await req('GET', `${SYNC_API}/Services?PageSize=100`);
  if (!r.ok) throw failure('Sync service list', r);
  const services = r.body.services ?? [];
  const found =
    services.find((s) => s.sid === existingSid) ??
    services.find((s) => s.friendly_name === RESOURCE_NAME);
  if (found) return { sid: found.sid, created: false };

  const c = await req('POST', `${SYNC_API}/Services`, { FriendlyName: RESOURCE_NAME });
  if (!c.ok) throw failure('Sync service create', c);
  return { sid: c.body.sid, created: true };
}

/**
 * Keep the existing API key if it can read the Flex Configuration (this catches
 * keys from another account and Restricted keys with no permissions — error
 * 8001); otherwise create a Standard key. The secret is only returned on create.
 */
export async function ensureApiKey(req, accountSid, existing, makeClient = twilioClient) {
  if (existing.apiKey && existing.apiSecret) {
    const probe = await makeClient(existing.apiKey, existing.apiSecret)(
      'GET',
      `${FLEX_API}/v1/Configuration`,
    );
    if (probe.ok) return { ...existing, created: false };
  }
  const c = await req('POST', `${API}/Accounts/${accountSid}/Keys.json`, {
    FriendlyName: RESOURCE_NAME,
  });
  if (!c.ok) throw failure('API key create', c);
  return { apiKey: c.body.sid, apiSecret: c.body.secret, created: true };
}

/**
 * Login usernames are Flex *usernames* (often an SSO handle like "jdoe",
 * not an email). Flex names each agent's TaskRouter worker after it, so list
 * workers and keep the ones the Flex Users API resolves — exactly what
 * /api/token will accept.
 */
export async function listAgentUsernames(req, workspaceSid, instanceSid) {
  const r = await req('GET', `${TASKROUTER_API}/Workspaces/${workspaceSid}/Workers?PageSize=200`);
  if (!r.ok) throw failure('TaskRouter worker list', r);
  const names = (r.body.workers ?? []).map((w) => w.friendly_name);
  const resolved = await Promise.all(
    names.map(async (name) => {
      const u = await req(
        'GET',
        `${FLEX_API}/v4/Instances/${instanceSid}/Users?Username=${encodeURIComponent(name)}`,
      );
      return u.ok && (u.body.users ?? []).length > 0 ? name : null;
    }),
  );
  return resolved.filter(Boolean);
}

export async function chooseUsername(usernames, current, ask) {
  if (current && usernames.includes(current)) return current;
  if (usernames.length <= 1) return usernames[0] ?? null;
  usernames.forEach((u, i) => console.log(`  ${i + 1}) ${u}`));
  const pick = Number(await ask(`Which agent will you log in as? [1-${usernames.length}]: `));
  return usernames[pick - 1] ?? usernames[0];
}

/** Reuse saved Account SID + Auth Token; prompt only when either is missing. */
export async function resolveCredentials(env, prompt) {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, reused: true };
  }
  const { accountSid, authToken } = await prompt(env);
  if (!accountSid || !authToken) throw new SetupError('Account SID and Auth Token are required.');
  return { accountSid, authToken, reused: false };
}

// --- CLI ------------------------------------------------------------------

async function main() {
  const file = pickEnvFile(existsSync);
  const seed = existsSync(file) ? file : existsSync('.env.example') ? '.env.example' : null;
  const text = seed ? readFileSync(seed, 'utf8') : '';
  const env = parseEnv(text);

  const { ask, close } = createPrompter();
  try {
    console.log(`Twilio Flex live setup → writing ${file}\n`);
    const promptCreds = async (saved = {}) => ({
      accountSid: saved.TWILIO_ACCOUNT_SID || (await ask('Account SID: ')),
      authToken: saved.TWILIO_AUTH_TOKEN || (await ask('Auth Token (hidden): ', { secret: true })),
    });
    let { accountSid, authToken } = await resolveCredentials(env, promptCreds);
    let accountName;
    try {
      accountName = await verifyAccount(twilioClient(accountSid, authToken), accountSid);
    } catch (err) {
      // Saved credentials can go stale (rotated token, switched account) — ask once.
      if (!(err instanceof SetupError) || !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) throw err;
      console.log(`! Saved credentials in ${seed} were rejected — enter new ones.`);
      ({ accountSid, authToken } = await resolveCredentials({}, promptCreds));
      accountName = await verifyAccount(twilioClient(accountSid, authToken), accountSid);
    }
    const req = twilioClient(accountSid, authToken);
    console.log(`✓ Account: ${accountName} (${mask(accountSid)})`);

    const { instanceSid, workspaceSid, chatServiceSid } = await getFlexConfig(req);
    console.log(`✓ Flex instance ${instanceSid}, workspace ${workspaceSid}`);

    const sync = await ensureSyncService(req, env.TWILIO_SYNC_SERVICE_SID);
    console.log(`✓ Sync service ${sync.sid}${sync.created ? ' (created)' : ''}`);

    const key = await ensureApiKey(req, accountSid, {
      apiKey: env.TWILIO_API_KEY,
      apiSecret: env.TWILIO_API_SECRET,
    });
    console.log(`✓ API key ${key.apiKey}${key.created ? ' (created, Standard)' : ' (existing, works)'}`);

    const usernames = await listAgentUsernames(req, workspaceSid, instanceSid);
    const username = await chooseUsername(usernames, env.TWILIO_FLEX_USERNAME, ask);
    if (username) console.log(`✓ Login username: ${username}`);
    else {
      console.log(
        '! No Flex agents yet. Log into hosted Flex once (Console → Flex → Overview → ' +
          'Launch Flex) to create your agent, then re-run to pick the username.',
      );
    }

    writeFileSync(
      file,
      mergeEnv(text, {
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: authToken,
        TWILIO_API_KEY: key.apiKey,
        TWILIO_API_SECRET: key.apiSecret,
        TWILIO_FLEX_INSTANCE_SID: instanceSid,
        TWILIO_WORKSPACE_SID: workspaceSid,
        TWILIO_SYNC_SERVICE_SID: sync.sid,
        ...(username && { TWILIO_FLEX_USERNAME: username }),
      }),
    );
    console.log(`\nWrote ${file}. Restart the dev server to pick it up.`);
    if (!env.PUBLIC_BASE_URL) {
      console.log('Live transcript also needs PUBLIC_BASE_URL (a public tunnel, e.g. ngrok) — set it by hand.');
    }

    if (!/^n/i.test(await ask('\nSet up a phone number for Flex now? [Y/n]: '))) {
      await setupPhoneNumber({ req, accountSid, chatServiceSid, ask });
    }
  } catch (err) {
    if (!(err instanceof SetupError)) throw err;
    console.error(`\n✗ ${err.message}`);
    process.exitCode = 1;
  } finally {
    close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
