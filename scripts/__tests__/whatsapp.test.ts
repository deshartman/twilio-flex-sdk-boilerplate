import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listWhatsAppSenders, whatsAppOnFlex, routeWhatsApp, setupWhatsApp } from '../lib/whatsapp.mjs';
import { FLEX_FLOWS } from '../lib/phoneNumber.mjs';
import { SetupError } from '../lib/twilio.mjs';

type Reply = { ok: boolean; status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Reply => ({ ok: true, status: 200, body });

const sender = (n: string, extra: Record<string, unknown> = {}) => ({
  sid: `XE${n}`,
  sender_id: `whatsapp:+${n}`,
  status: 'ONLINE',
  ...extra,
});
const waAddress = (address: string, flow = 'FWmsg') => ({
  sid: 'IGwa',
  type: 'whatsapp',
  address,
  auto_creation: { type: 'studio', studio_flow_sid: flow },
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('listWhatsAppSenders', () => {
  it('reads the v2 Senders API for the whatsapp channel', async () => {
    const req = vi.fn().mockResolvedValue(ok({ senders: [sender('61')] }));
    expect(await listWhatsAppSenders(req)).toHaveLength(1);
    expect(req.mock.calls[0]![1]).toMatch(/messaging\.twilio\.com\/v2\/Channels\/Senders\?Channel=whatsapp/);
  });

  it('treats a 404 (no WhatsApp on the account) as no senders', async () => {
    const req = vi.fn().mockResolvedValue({ ok: false, status: 404, body: {} });
    expect(await listWhatsAppSenders(req)).toEqual([]);
  });
});

describe('whatsAppOnFlex', () => {
  it('needs a whatsapp address on the Messaging Flow for the sender', () => {
    const s = sender('61');
    expect(whatsAppOnFlex(s, 'FWmsg', [waAddress('whatsapp:+61')]).onFlex).toBe(true);
    expect(whatsAppOnFlex(s, 'FWmsg', [waAddress('whatsapp:+61', 'FWother')]).onFlex).toBe(false);
    expect(whatsAppOnFlex(s, 'FWmsg', []).onFlex).toBe(false);
  });
});

describe('routeWhatsApp', () => {
  it('creates a whatsapp studio address on the Flex chat service', async () => {
    const req = vi.fn().mockResolvedValue(ok({}));
    await routeWhatsApp(req, sender('61'), 'FWmsg', 'ISchat', undefined);
    expect(req).toHaveBeenCalledWith(
      'POST',
      'https://conversations.twilio.com/v1/Configuration/Addresses',
      expect.objectContaining({
        Type: 'whatsapp',
        Address: 'whatsapp:+61',
        'AutoCreation.Type': 'studio',
        'AutoCreation.StudioFlowSid': 'FWmsg',
        'AutoCreation.ConversationServiceSid': 'ISchat',
      }),
    );
  });

  it('updates an existing address instead of creating a duplicate', async () => {
    const req = vi.fn().mockResolvedValue(ok({}));
    await routeWhatsApp(req, sender('61'), 'FWmsg', undefined, { sid: 'IGold' });
    expect(req).toHaveBeenCalledTimes(1);
    expect(req.mock.calls[0]![1]).toMatch(/\/Addresses\/IGold$/);
  });
});

describe('setupWhatsApp', () => {
  function fakeAccount(senders: Record<string, unknown>[], addresses: Record<string, unknown>[] = []) {
    return vi.fn(async (method: string, url: string): Promise<Reply> => {
      if (url.includes('studio.twilio.com')) return ok({ flows: [{ sid: 'FWmsg', friendly_name: FLEX_FLOWS.messaging }] });
      if (url.includes('Channels/Senders')) return ok({ senders });
      if (method === 'GET' && url.includes('/Configuration/Addresses')) return ok({ address_configurations: addresses });
      return ok({});
    });
  }
  const posts = (req: ReturnType<typeof fakeAccount>) => req.mock.calls.filter(([m]) => m === 'POST');

  it('fails clearly when the Messaging Flow is missing', async () => {
    const req = vi.fn().mockResolvedValue(ok({ flows: [], senders: [] }));
    await expect(setupWhatsApp({ req, chatServiceSid: undefined, ask: vi.fn() })).rejects.toBeInstanceOf(SetupError);
  });

  it('returns quietly when the account has no WhatsApp senders', async () => {
    const req = fakeAccount([]);
    const ask = vi.fn();
    expect(await setupWhatsApp({ req, chatServiceSid: undefined, ask })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('routes a chosen sender after confirmation', async () => {
    const s = sender('61');
    const req = fakeAccount([s]);
    const ask = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('y');
    expect(await setupWhatsApp({ req, chatServiceSid: 'ISchat', ask })).toBe(s);
    expect(posts(req)).toHaveLength(1);
  });

  it('changes nothing when the user declines', async () => {
    const req = fakeAccount([sender('61')]);
    const ask = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('n');
    expect(await setupWhatsApp({ req, chatServiceSid: undefined, ask })).toBeNull();
    expect(posts(req)).toHaveLength(0);
  });

  it('skips a sender already on Flex without asking to apply', async () => {
    const req = fakeAccount([sender('61')], [waAddress('whatsapp:+61')]);
    const ask = vi.fn().mockResolvedValueOnce('1');
    await setupWhatsApp({ req, chatServiceSid: undefined, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(posts(req)).toHaveLength(0);
  });

  it('warns about a sender webhook that would run alongside Flex', async () => {
    const req = fakeAccount([sender('61', { webhook: { callback_url: 'https://old.example' } })]);
    const ask = vi.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('y');
    await setupWhatsApp({ req, chatServiceSid: undefined, ask });
    const logged = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(logged).toContain('https://old.example');
  });
});
