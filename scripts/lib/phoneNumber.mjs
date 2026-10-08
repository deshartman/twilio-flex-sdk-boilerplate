// Phone-number step of `npm run configure`: pick an existing number or buy one
// (reusing / cloning a regulatory bundle when the country needs it), then route
// it into Flex — voice via the Flex "Voice IVR" Studio flow, SMS via a
// Conversations address that starts the Flex "Messaging Flow".
//
// Every billable or destructive call (purchase, clone, re-pointing webhooks) is
// shown first and needs an explicit "y".
import { SetupError, failure, mask, twilioClient } from './twilio.mjs';

const API = 'https://api.twilio.com/2010-04-01';
const NUMBERS_API = 'https://numbers.twilio.com/v2/RegulatoryCompliance';
const PRICING_API = 'https://pricing.twilio.com/v1/PhoneNumbers/Countries';
const STUDIO_API = 'https://studio.twilio.com/v2/Flows';
const CONVERSATIONS_API = 'https://conversations.twilio.com/v1/Configuration/Addresses';

// Names Flex gives the Studio flows it provisions.
export const FLEX_FLOWS = { voice: 'Voice IVR', messaging: 'Messaging Flow' };

// Twilio number types → the AvailablePhoneNumbers path segment.
export const NUMBER_TYPES = { local: 'Local', mobile: 'Mobile', 'toll-free': 'TollFree' };

// US/CA list regulations for every type but only need a bundle for none of the
// standard ones, so "has regulations" can't be the test there.
const NO_BUNDLE_COUNTRIES = new Set(['US', 'CA']);

const yes = (answer) => /^y(es)?$/i.test(answer);
const studioWebhook = (accountSid, flowSid) => `https://webhooks.twilio.com/v1/Accounts/${accountSid}/Flows/${flowSid}`;

// --- discovery ------------------------------------------------------------

export async function findFlexFlows(req) {
  const r = await req('GET', `${STUDIO_API}?PageSize=100`);
  if (!r.ok) throw failure('Studio flow list', r);
  const flows = r.body.flows ?? [];
  const byName = (name) => flows.find((f) => f.friendly_name === name)?.sid;
  return { voice: byName(FLEX_FLOWS.voice), messaging: byName(FLEX_FLOWS.messaging), all: flows };
}

export async function listNumbers(req, accountSid) {
  const r = await req('GET', `${API}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=200`);
  if (!r.ok) throw failure('Phone number list', r);
  return r.body.incoming_phone_numbers ?? [];
}

export async function listSmsAddresses(req) {
  const r = await req('GET', `${CONVERSATIONS_API}?PageSize=200`);
  if (!r.ok) throw failure('Conversations address list', r);
  return (r.body.address_configurations ?? []).filter((a) => a.type === 'sms');
}

/** Is this number already routed into Flex, per channel? */
export function flexStatus(number, accountSid, flows, smsAddresses) {
  const voice = Boolean(flows.voice) && number.voice_url === studioWebhook(accountSid, flows.voice);
  const address = smsAddresses.find((a) => a.address === number.phone_number);
  const sms =
    Boolean(flows.messaging) &&
    address?.auto_creation?.type === 'studio' &&
    address.auto_creation.studio_flow_sid === flows.messaging;
  return { voice, sms, address };
}

// --- buying ---------------------------------------------------------------

export async function needsBundle(req, country, type) {
  if (NO_BUNDLE_COUNTRIES.has(country)) return false;
  const r = await req('GET', `${NUMBERS_API}/Regulations?IsoCountry=${country}&NumberType=${type}`);
  if (!r.ok) throw failure('Regulation lookup', r);
  return (r.body.results ?? []).length > 0;
}

export async function findApprovedBundle(req, country, type) {
  const r = await req(
    'GET',
    `${NUMBERS_API}/Bundles?Status=twilio-approved&IsoCountry=${country}&NumberType=${type}&PageSize=50`,
  );
  if (!r.ok) throw failure('Bundle lookup', r);
  return r.body.results ?? [];
}

export async function monthlyPrice(req, country, type) {
  const r = await req('GET', `${PRICING_API}/${country}`);
  if (!r.ok) return null;
  const wanted = type === 'toll-free' ? 'toll free' : type;
  const p = (r.body.phone_number_prices ?? []).find((x) => x.number_type === wanted);
  return p ? `${p.current_price} ${r.body.price_unit}/month` : null;
}

export async function searchNumbers(req, accountSid, country, type, contains) {
  const q = new URLSearchParams({ PageSize: '5', VoiceEnabled: 'true' });
  if (contains) q.set('Contains', contains);
  const r = await req(
    'GET',
    `${API}/Accounts/${accountSid}/AvailablePhoneNumbers/${country}/${NUMBER_TYPES[type]}.json?${q}`,
  );
  if (r.status === 404) return [];
  if (!r.ok) throw failure('Number search', r);
  return r.body.available_phone_numbers ?? [];
}

/** Address SID a purchase needs (bundles carry one; a single matching address is reused). */
export async function pickAddressSid(req, accountSid, country, bundle) {
  const r = await req('GET', `${API}/Accounts/${accountSid}/Addresses.json?IsoCountry=${country}&PageSize=50`);
  if (!r.ok) throw failure('Address lookup', r);
  const addresses = r.body.addresses ?? [];
  return addresses.length === 1 || bundle ? addresses[0]?.sid : undefined;
}

/** Clone an approved bundle into `targetAccountSid`. `parentReq` must be authed as the bundle's owner. */
export async function cloneBundle(parentReq, bundleSid, targetAccountSid) {
  const r = await parentReq('POST', `${NUMBERS_API}/Bundles/${bundleSid}/Clones`, {
    TargetAccountSid: targetAccountSid,
  });
  if (!r.ok) throw failure('Bundle clone', r);
  return { sid: r.body.bundle_sid, status: r.body.status, friendly_name: r.body.friendly_name };
}

// --- Flex wiring ----------------------------------------------------------

export async function routeVoice(req, accountSid, number, voiceFlowSid) {
  const r = await req('POST', `${API}/Accounts/${accountSid}/IncomingPhoneNumbers/${number.sid}.json`, {
    VoiceUrl: studioWebhook(accountSid, voiceFlowSid),
    VoiceMethod: 'POST',
  });
  if (!r.ok) throw failure('Voice routing', r);
}

export async function routeSms(req, accountSid, number, messagingFlowSid, chatServiceSid, existing) {
  // Clear any plain SMS webhook (e.g. the demo.twilio.com default) so inbound
  // texts go through the Conversations address, like Flex's own numbers.
  if (number.sms_url) {
    const c = await req('POST', `${API}/Accounts/${accountSid}/IncomingPhoneNumbers/${number.sid}.json`, {
      SmsUrl: '',
    });
    if (!c.ok) throw failure('Clearing SMS webhook', c);
  }
  const fields = {
    FriendlyName: 'Flex Messaging Channel Flow',
    'AutoCreation.Enabled': 'true',
    'AutoCreation.Type': 'studio',
    'AutoCreation.StudioFlowSid': messagingFlowSid,
    'AutoCreation.StudioRetryCount': '3',
    ...(chatServiceSid && { 'AutoCreation.ConversationServiceSid': chatServiceSid }),
  };
  const r = existing
    ? await req('POST', `${CONVERSATIONS_API}/${existing.sid}`, fields)
    : await req('POST', CONVERSATIONS_API, { Type: 'sms', Address: number.phone_number, ...fields });
  if (!r.ok) throw failure('SMS routing', r);
}

// --- interactive flow -----------------------------------------------------

async function chooseExisting({ req, accountSid, flows, smsAddresses, ask }) {
  const numbers = await listNumbers(req, accountSid);
  if (numbers.length === 0) {
    console.log('  No numbers on this account yet.');
    return null;
  }
  numbers.forEach((n, i) => {
    const s = flexStatus(n, accountSid, flows, smsAddresses);
    const tag = s.voice && s.sms ? 'on Flex' : s.voice || s.sms ? 'partly on Flex' : 'not on Flex';
    console.log(`  ${i + 1}) ${n.phone_number}  (${tag})`);
  });
  const pick = Number(await ask(`Which number? [1-${numbers.length}]: `));
  return numbers[pick - 1] ?? null;
}

/** Find or clone an approved bundle for country/type; null means "can't buy yet". */
async function ensureBundle({ req, accountSid, country, type, ask }) {
  const [own] = await findApprovedBundle(req, country, type);
  if (own) {
    console.log(`✓ Using approved bundle "${own.friendly_name}" (${mask(own.sid)})`);
    return own;
  }
  console.log(`  ${country} ${type} numbers need an approved regulatory bundle, and this account has none.`);
  const parentSid = await ask('Clone one from a parent account? Parent Account SID (Enter to skip): ');
  if (parentSid) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(parentSid)) throw new SetupError('Parent Account SID must be AC + 32 hex.');
    const parentToken = await ask(`Auth Token for ${mask(parentSid)} (hidden): `, { secret: true });
    const parent = twilioClient(parentSid, parentToken);
    const candidates = await findApprovedBundle(parent, country, type);
    if (candidates.length === 0) {
      console.log(`  The parent account has no approved ${country} ${type} bundle either.`);
    } else {
      candidates.forEach((b, i) => console.log(`  ${i + 1}) ${b.friendly_name} (${mask(b.sid)})`));
      const chosen = candidates[Number(await ask(`Clone which bundle? [1-${candidates.length}]: `)) - 1];
      if (chosen && yes(await ask(`Clone "${chosen.friendly_name}" into ${mask(accountSid)}? [y/N]: `))) {
        const cloned = await cloneBundle(parent, chosen.sid, accountSid);
        console.log(`✓ Cloned bundle → ${mask(cloned.sid)} (${cloned.status})`);
        return cloned;
      }
    }
  }
  console.log(
    '  Create a bundle in the Console (Phone Numbers → Regulatory Compliance → Bundles); review takes ' +
      'up to ~24 business hours. Re-run `npm run configure` once it is approved.',
  );
  return null;
}

async function buyNumber({ req, accountSid, ask }) {
  const country = ((await ask('Country (ISO code, e.g. US, AU, GB): ')) || 'US').toUpperCase();
  const typeIn = ((await ask('Type — local, mobile or toll-free [local]: ')) || 'local').toLowerCase();
  if (!NUMBER_TYPES[typeIn]) throw new SetupError(`Unknown number type "${typeIn}".`);

  let bundle = null;
  if (await needsBundle(req, country, typeIn)) {
    bundle = await ensureBundle({ req, accountSid, country, type: typeIn, ask });
    if (!bundle) return null;
  }

  const contains = await ask('Digits the number should contain (optional, e.g. an area code): ');
  const found = await searchNumbers(req, accountSid, country, typeIn, contains);
  if (found.length === 0) {
    console.log(`  No ${country} ${typeIn} numbers available${contains ? ` containing ${contains}` : ''}.`);
    return null;
  }
  const price = await monthlyPrice(req, country, typeIn);
  found.forEach((n, i) => console.log(`  ${i + 1}) ${n.phone_number}  ${n.locality || n.region || ''}`.trimEnd()));
  const chosen = found[Number(await ask(`Which number? [1-${found.length}]: `)) - 1];
  if (!chosen) return null;
  if (!yes(await ask(`Buy ${chosen.phone_number}${price ? ` for ${price}` : ''}? This is billed. [y/N]: `))) {
    console.log('  Not purchased.');
    return null;
  }

  const addressSid = chosen.address_requirements !== 'none'
    ? await pickAddressSid(req, accountSid, country, bundle)
    : undefined;
  const r = await req('POST', `${API}/Accounts/${accountSid}/IncomingPhoneNumbers.json`, {
    PhoneNumber: chosen.phone_number,
    FriendlyName: 'Flex SDK Boilerplate',
    ...(bundle && { BundleSid: bundle.sid }),
    ...(addressSid && { AddressSid: addressSid }),
  });
  if (!r.ok) throw failure('Number purchase', r);
  console.log(`✓ Bought ${r.body.phone_number}`);
  return r.body;
}

export async function setupPhoneNumber({ req, accountSid, chatServiceSid, ask }) {
  const flows = await findFlexFlows(req);
  for (const [channel, name] of Object.entries(FLEX_FLOWS)) {
    if (!flows[channel]) {
      throw new SetupError(
        `No Studio flow named "${name}" — Flex normally creates it. Check Studio in the Console.`,
      );
    }
  }
  const smsAddresses = await listSmsAddresses(req);

  const mode = await ask('  1) Use an existing number\n  2) Buy a new number\nChoose [1]: ');
  const number = mode === '2'
    ? await buyNumber({ req, accountSid, ask })
    : await chooseExisting({ req, accountSid, flows, smsAddresses, ask });
  if (!number) return null;

  const status = flexStatus(number, accountSid, flows, smsAddresses);
  if (status.voice && status.sms) {
    console.log(`✓ ${number.phone_number} is already on Flex (voice + SMS).`);
    return number;
  }
  const changes = [
    !status.voice && `voice: ${number.voice_url || '(none)'} → Flex "${FLEX_FLOWS.voice}"`,
    !status.sms && `SMS:   ${status.address ? 'existing address' : number.sms_url || '(none)'} → Flex "${FLEX_FLOWS.messaging}"`,
  ].filter(Boolean);
  console.log(`\n${number.phone_number}:\n  ${changes.join('\n  ')}`);
  if (!yes(await ask('Apply? [y/N]: '))) {
    console.log('  Left unchanged.');
    return null;
  }
  if (!status.voice) await routeVoice(req, accountSid, number, flows.voice);
  if (!status.sms) await routeSms(req, accountSid, number, flows.messaging, chatServiceSid, status.address);
  console.log(`✓ ${number.phone_number} now routes voice and SMS into Flex. Call or text it to test.`);
  return number;
}
