// WhatsApp step of `npm run configure`: pick a registered WhatsApp sender and
// route it into Flex via a Conversations address (Type=whatsapp) that starts the
// Flex "Messaging Flow" — the same wiring Flex's own messaging numbers use.
//
// Registering a sender (Meta business verification) can't be automated here, so
// this only works with senders that already exist on the account. The sender's
// own inbound webhook is reported but never changed: it may serve another app.
import { SetupError, failure } from './twilio.mjs';
import { FLEX_FLOWS, findFlexFlows } from './phoneNumber.mjs';

const SENDERS_API = 'https://messaging.twilio.com/v2/Channels/Senders';
const CONVERSATIONS_API = 'https://conversations.twilio.com/v1/Configuration/Addresses';

const yes = (answer) => /^y(es)?$/i.test(answer);

export async function listWhatsAppSenders(req) {
  const r = await req('GET', `${SENDERS_API}?Channel=whatsapp&PageSize=100`);
  if (r.status === 404) return [];
  if (!r.ok) throw failure('WhatsApp sender list', r);
  return r.body.senders ?? [];
}

export async function listWhatsAppAddresses(req) {
  const r = await req('GET', `${CONVERSATIONS_API}?PageSize=200`);
  if (!r.ok) throw failure('Conversations address list', r);
  return (r.body.address_configurations ?? []).filter((a) => a.type === 'whatsapp');
}

/** Is this sender already routed into Flex? `sender_id` is `whatsapp:+E164`, as is the address. */
export function whatsAppOnFlex(sender, messagingFlowSid, addresses) {
  const address = addresses.find((a) => a.address === sender.sender_id);
  const onFlex =
    address?.auto_creation?.type === 'studio' && address.auto_creation.studio_flow_sid === messagingFlowSid;
  return { onFlex, address };
}

export async function routeWhatsApp(req, sender, messagingFlowSid, chatServiceSid, existing) {
  const fields = {
    FriendlyName: 'Flex WhatsApp Channel Flow',
    'AutoCreation.Enabled': 'true',
    'AutoCreation.Type': 'studio',
    'AutoCreation.StudioFlowSid': messagingFlowSid,
    'AutoCreation.StudioRetryCount': '3',
    ...(chatServiceSid && { 'AutoCreation.ConversationServiceSid': chatServiceSid }),
  };
  const r = existing
    ? await req('POST', `${CONVERSATIONS_API}/${existing.sid}`, fields)
    : await req('POST', CONVERSATIONS_API, { Type: 'whatsapp', Address: sender.sender_id, ...fields });
  if (!r.ok) throw failure('WhatsApp routing', r);
}

export async function setupWhatsApp({ req, chatServiceSid, ask }) {
  const flows = await findFlexFlows(req);
  if (!flows.messaging) {
    throw new SetupError(
      `No Studio flow named "${FLEX_FLOWS.messaging}" — Flex normally creates it. Check Studio in the Console.`,
    );
  }
  const senders = await listWhatsAppSenders(req);
  if (senders.length === 0) {
    console.log('  No WhatsApp senders on this account (Console → Messaging → Senders → WhatsApp senders).');
    return null;
  }
  const addresses = await listWhatsAppAddresses(req);

  senders.forEach((s, i) => {
    const tag = whatsAppOnFlex(s, flows.messaging, addresses).onFlex ? 'on Flex' : 'not on Flex';
    console.log(`  ${i + 1}) ${s.sender_id}  ${s.status}  (${tag})`);
  });
  const sender = senders[Number(await ask(`Which WhatsApp sender? [1-${senders.length}]: `)) - 1];
  if (!sender) return null;

  const { onFlex, address } = whatsAppOnFlex(sender, flows.messaging, addresses);
  if (onFlex) {
    console.log(`✓ ${sender.sender_id} is already on Flex.`);
    return sender;
  }
  if (sender.status !== 'ONLINE') console.log(`  ! Sender status is ${sender.status}; messages flow only once it is ONLINE.`);
  console.log(
    `\n${sender.sender_id}:\n  WhatsApp: ${address ? 'existing address' : '(no address)'} → Flex "${FLEX_FLOWS.messaging}"`,
  );
  if (!yes(await ask('Apply? [y/N]: '))) {
    console.log('  Left unchanged.');
    return null;
  }
  await routeWhatsApp(req, sender, flows.messaging, chatServiceSid, address);
  console.log(`✓ ${sender.sender_id} now routes WhatsApp into Flex. Message it to test.`);
  const hook = sender.webhook?.callback_url;
  if (hook) {
    console.log(
      `  ! This sender also posts inbound messages to ${hook}, which runs alongside Flex.\n` +
        '    Clear "Webhook URL for incoming messages" on the sender in the Console unless another app needs it.',
    );
  }
  return sender;
}
