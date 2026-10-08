import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findFlexFlows,
  flexStatus,
  needsBundle,
  monthlyPrice,
  pickAddressSid,
  cloneBundle,
  routeVoice,
  routeSms,
  setupPhoneNumber,
  FLEX_FLOWS,
} from '../lib/phoneNumber.mjs';
import { SetupError } from '../lib/twilio.mjs';

type Reply = { ok: boolean; status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Reply => ({ ok: true, status: 200, body });

const AC = `AC${'a'.repeat(32)}`;
const FLOWS = { voice: 'FWvoice', messaging: 'FWmsg' };
const voiceUrl = `https://webhooks.twilio.com/v1/Accounts/${AC}/Flows/FWvoice`;
const studioAddress = (address: string, flow = 'FWmsg') => ({
  sid: 'IG1',
  type: 'sms',
  address,
  auto_creation: { type: 'studio', studio_flow_sid: flow },
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('findFlexFlows', () => {
  it('finds the Flex-provisioned flows by name', async () => {
    const req = vi.fn().mockResolvedValue(
      ok({
        flows: [
          { sid: 'FW1', friendly_name: FLEX_FLOWS.voice },
          { sid: 'FW2', friendly_name: FLEX_FLOWS.messaging },
          { sid: 'FW3', friendly_name: 'Chat Flow' },
        ],
      }),
    );
    const out = await findFlexFlows(req);
    expect(out).toMatchObject({ voice: 'FW1', messaging: 'FW2' });
  });
});

describe('flexStatus', () => {
  it('recognises a number fully routed into Flex', () => {
    const n = { phone_number: '+1555', voice_url: voiceUrl };
    expect(flexStatus(n, AC, FLOWS, [studioAddress('+1555')])).toMatchObject({ voice: true, sms: true });
  });

  it('flags demo webhooks and a missing / foreign SMS address', () => {
    const n = { phone_number: '+61', voice_url: 'https://demo.twilio.com/welcome/voice/' };
    expect(flexStatus(n, AC, FLOWS, [])).toMatchObject({ voice: false, sms: false });
    expect(flexStatus(n, AC, FLOWS, [studioAddress('+61', 'FWother')]).sms).toBe(false);
  });
});

describe('needsBundle', () => {
  it('never needs one in US/CA, without calling the API', async () => {
    const req = vi.fn();
    expect(await needsBundle(req, 'US', 'local')).toBe(false);
    expect(req).not.toHaveBeenCalled();
  });

  it('needs one where regulations exist', async () => {
    expect(await needsBundle(vi.fn().mockResolvedValue(ok({ results: [{ sid: 'RN1' }] })), 'AU', 'mobile')).toBe(true);
    expect(await needsBundle(vi.fn().mockResolvedValue(ok({ results: [] })), 'XX', 'local')).toBe(false);
  });
});

describe('monthlyPrice', () => {
  it('maps toll-free to the Pricing API label', async () => {
    const req = vi.fn().mockResolvedValue(
      ok({ price_unit: 'USD', phone_number_prices: [{ number_type: 'toll free', current_price: '20.00' }] }),
    );
    expect(await monthlyPrice(req, 'AU', 'toll-free')).toBe('20.00 USD/month');
  });

  it('returns null rather than failing when pricing is unavailable', async () => {
    expect(await monthlyPrice(vi.fn().mockResolvedValue({ ok: false, status: 404, body: {} }), 'AU', 'local')).toBeNull();
  });
});

describe('pickAddressSid', () => {
  it('reuses the only address, and the first when a bundle is in play', async () => {
    const one = vi.fn().mockResolvedValue(ok({ addresses: [{ sid: 'AD1' }] }));
    expect(await pickAddressSid(one, AC, 'AU', null)).toBe('AD1');
    const two = vi.fn().mockResolvedValue(ok({ addresses: [{ sid: 'AD1' }, { sid: 'AD2' }] }));
    expect(await pickAddressSid(two, AC, 'AU', null)).toBeUndefined();
    expect(await pickAddressSid(two, AC, 'AU', { sid: 'BU1' })).toBe('AD1');
  });
});

describe('cloneBundle', () => {
  it('posts the target account to the Clones endpoint', async () => {
    const req = vi.fn().mockResolvedValue(ok({ bundle_sid: 'BUnew', status: 'twilio-approved' }));
    expect(await cloneBundle(req, 'BUsrc', AC)).toMatchObject({ sid: 'BUnew', status: 'twilio-approved' });
    expect(req).toHaveBeenCalledWith('POST', expect.stringContaining('/Bundles/BUsrc/Clones'), {
      TargetAccountSid: AC,
    });
  });
});

describe('routing', () => {
  it('points voice at the Studio webhook', async () => {
    const req = vi.fn().mockResolvedValue(ok({}));
    await routeVoice(req, AC, { sid: 'PN1' }, 'FWvoice');
    expect(req).toHaveBeenCalledWith('POST', expect.stringContaining('/IncomingPhoneNumbers/PN1.json'), {
      VoiceUrl: voiceUrl,
      VoiceMethod: 'POST',
    });
  });

  it('clears a plain SMS webhook and creates a studio address on the Flex chat service', async () => {
    const req = vi.fn().mockResolvedValue(ok({}));
    await routeSms(req, AC, { sid: 'PN1', phone_number: '+61', sms_url: 'https://demo' }, 'FWmsg', 'ISchat', undefined);
    expect(req).toHaveBeenNthCalledWith(1, 'POST', expect.stringContaining('/PN1.json'), { SmsUrl: '' });
    expect(req).toHaveBeenNthCalledWith(
      2,
      'POST',
      'https://conversations.twilio.com/v1/Configuration/Addresses',
      expect.objectContaining({
        Type: 'sms',
        Address: '+61',
        'AutoCreation.Type': 'studio',
        'AutoCreation.StudioFlowSid': 'FWmsg',
        'AutoCreation.ConversationServiceSid': 'ISchat',
      }),
    );
  });

  it('updates an existing address instead of creating a duplicate', async () => {
    const req = vi.fn().mockResolvedValue(ok({}));
    await routeSms(req, AC, { sid: 'PN1', phone_number: '+61', sms_url: '' }, 'FWmsg', undefined, { sid: 'IGold' });
    expect(req).toHaveBeenCalledTimes(1);
    expect(req.mock.calls[0]![1]).toMatch(/\/Addresses\/IGold$/);
  });
});

describe('setupPhoneNumber', () => {
  const flexFlowsReply = ok({
    flows: [
      { sid: 'FWvoice', friendly_name: FLEX_FLOWS.voice },
      { sid: 'FWmsg', friendly_name: FLEX_FLOWS.messaging },
    ],
  });

  function fakeAccount(numbers: Record<string, unknown>[], addresses: Record<string, unknown>[] = []) {
    return vi.fn(async (method: string, url: string): Promise<Reply> => {
      if (url.includes('studio.twilio.com')) return flexFlowsReply;
      if (method === 'GET' && url.includes('/Configuration/Addresses')) return ok({ address_configurations: addresses });
      if (method === 'GET' && url.includes('IncomingPhoneNumbers')) return ok({ incoming_phone_numbers: numbers });
      return ok({});
    });
  }

  it('fails clearly when the Flex flows are missing', async () => {
    const req = vi.fn().mockResolvedValue(ok({ flows: [] }));
    await expect(setupPhoneNumber({ req, accountSid: AC, chatServiceSid: undefined, ask: vi.fn() })).rejects.toBeInstanceOf(SetupError);
  });

  it('wires an existing non-Flex number after confirmation', async () => {
    const number = { sid: 'PN1', phone_number: '+61', voice_url: 'https://demo', sms_url: 'https://demo' };
    const req = fakeAccount([number]);
    const ask = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('1').mockResolvedValueOnce('y');
    expect(await setupPhoneNumber({ req, accountSid: AC, chatServiceSid: 'ISchat', ask })).toBe(number);
    const writes = req.mock.calls.filter(([m]) => m === 'POST').map(([, url]) => url);
    expect(writes).toHaveLength(3); // voice, clear SmsUrl, create address
  });

  it('changes nothing when the user declines', async () => {
    const req = fakeAccount([{ sid: 'PN1', phone_number: '+61', voice_url: 'https://demo' }]);
    const ask = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('1').mockResolvedValueOnce('n');
    expect(await setupPhoneNumber({ req, accountSid: AC, chatServiceSid: undefined, ask })).toBeNull();
    expect(req.mock.calls.some(([m]) => m === 'POST')).toBe(false);
  });

  it('skips a number already on Flex without asking to apply', async () => {
    const req = fakeAccount([{ sid: 'PN1', phone_number: '+1555', voice_url: voiceUrl }], [studioAddress('+1555')]);
    const ask = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('1');
    await setupPhoneNumber({ req, accountSid: AC, chatServiceSid: undefined, ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(req.mock.calls.some(([m]) => m === 'POST')).toBe(false);
  });

  it('never purchases without an explicit yes', async () => {
    const req = vi.fn(async (method: string, url: string): Promise<Reply> => {
      if (url.includes('studio.twilio.com')) return flexFlowsReply;
      if (url.includes('/Configuration/Addresses')) return ok({ address_configurations: [] });
      if (url.includes('AvailablePhoneNumbers')) return ok({ available_phone_numbers: [{ phone_number: '+15551234' }] });
      if (url.includes('pricing')) return ok({ price_unit: 'USD', phone_number_prices: [] });
      return ok({});
    });
    // buy → US → local → no digits → pick 1 → decline purchase
    const ask = vi.fn();
    for (const a of ['2', 'US', 'local', '', '1', 'n']) ask.mockResolvedValueOnce(a);
    expect(await setupPhoneNumber({ req, accountSid: AC, chatServiceSid: undefined, ask })).toBeNull();
    expect(req.mock.calls.some(([m]) => m === 'POST')).toBe(false);
  });
});
