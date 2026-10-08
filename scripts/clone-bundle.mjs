#!/usr/bin/env node
// Clone an approved regulatory bundle from a parent account into one of its
// sub-accounts (Numbers v2 Bundle Clones). Authenticates as the SOURCE account.
//   npm run clone-bundle
// Prompts for the source Account SID, target Account SID, Bundle SID, and the
// source Auth Token (hidden). Nothing is stored or hardcoded.
//
// `npm run configure` does this automatically when buying a number that needs
// a bundle; this is the standalone version.
import { SetupError, twilioClient, failure, mask, createPrompter } from './lib/twilio.mjs';
import { cloneBundle } from './lib/phoneNumber.mjs';

const { ask, close } = createPrompter();
const sid = (prefix, v, label) => {
  if (!new RegExp(`^${prefix}[0-9a-fA-F]{32}$`).test(v)) {
    throw new SetupError(`${label} must be ${prefix} followed by 32 hex characters.`);
  }
  return v;
};

try {
  console.log('Clone a regulatory bundle into another account\n');
  const source = sid('AC', await ask('Source Account SID (owns the bundle): '), 'Source Account SID');
  const target = sid('AC', await ask('Target Account SID (receives the clone): '), 'Target Account SID');
  if (target === source) throw new SetupError('Source and target must be different accounts.');
  const bundle = sid('BU', await ask('Bundle SID: '), 'Bundle SID');
  const token = await ask(`Auth Token for ${mask(source)} (hidden): `, { secret: true });
  if (!token) throw new SetupError('Auth Token is required.');
  const req = twilioClient(source, token);

  const b = await req('GET', `https://numbers.twilio.com/v2/RegulatoryCompliance/Bundles/${bundle}`);
  if (!b.ok) throw failure('Reading the bundle', b);
  console.log(`Bundle: "${b.body.friendly_name}" — status ${b.body.status}, regulation ${b.body.regulation_sid}`);
  if (b.body.status !== 'twilio-approved') throw new SetupError('Only twilio-approved bundles can be cloned.');

  const t = await req('GET', `https://api.twilio.com/2010-04-01/Accounts/${target}.json`);
  if (!t.ok) throw new SetupError('Target account not reachable with these credentials — it must be a sub-account of the source.');
  console.log(`Target: "${t.body.friendly_name}" (${t.body.status})`);

  if (!/^y(es)?$/i.test(await ask('\nCreate the clone? [y/N]: '))) throw new SetupError('Cancelled — nothing created.');
  const c = await cloneBundle(req, bundle, target);
  console.log(`\n✓ Cloned → ${c.sid} in ${mask(target)}, status ${c.status}`);
} catch (err) {
  if (!(err instanceof SetupError)) throw err;
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  close();
}
