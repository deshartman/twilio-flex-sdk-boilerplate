// Shared helpers for the setup scripts: a tiny Twilio REST client, actionable
// errors, and a prompt that can hide secrets. Plain Node (>= 20), no deps.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** A failure the user can act on — printed without a stack trace. */
export class SetupError extends Error {}

export const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : '');

export function twilioClient(username, password) {
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  return async function request(method, url, form) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: auth,
        ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  };
}

export function failure(what, r) {
  const code = r.body?.code ? `, Twilio error ${r.body.code}` : '';
  const msg = r.body?.message ? `: ${r.body.message}` : '';
  return new SetupError(`${what} failed (${r.status}${code})${msg}`);
}

/**
 * `ask(question, { secret })` over stdin. Uses a line iterator rather than
 * rl.question(): question() drops lines that arrive before it is called, so
 * piped input (CI, scripts) would hang. In a terminal, readline does the
 * echoing through `output`, so muting it hides secrets.
 */
export function createPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q, { secret = false } = {}) => {
    rl.setPrompt(q);
    rl.prompt();
    muted = secret;
    const { value, done } = await lines.next();
    muted = false;
    if (secret || done) process.stdout.write('\n');
    return done ? '' : value.trim();
  };
  return { ask, close: () => rl.close() };
}
