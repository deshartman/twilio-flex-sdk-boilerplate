import { describe, it, expect, vi } from 'vitest';
import {
  parseEnv,
  mergeEnv,
  pickEnvFile,
  verifyAccount,
  getFlexConfig,
  ensureSyncService,
  ensureApiKey,
  listAgentUsernames,
  chooseUsername,
  resolveCredentials,
  SetupError,
  RESOURCE_NAME,
} from '../setup.mjs';

type Reply = { ok: boolean; status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Reply => ({ ok: true, status: 200, body });
const err = (status: number, code?: number): Reply => ({ ok: false, status, body: { code } });

const ACCOUNT = `AC${'a'.repeat(32)}`;

describe('env file helpers', () => {
  it('parses keys, ignoring comments and stripping quotes', () => {
    expect(parseEnv('# c\nA=1\nB="two"\nC=\n')).toEqual({ A: '1', B: 'two', C: '' });
  });

  it('replaces existing keys in place and appends new ones', () => {
    const out = mergeEnv('# keep\nA=old\nB=\n', { A: 'new', B: 'b', C: 'c' });
    expect(out).toBe('# keep\nA=new\nB=b\nC=c\n');
  });

  it('writes values literally even when they contain $ patterns', () => {
    expect(mergeEnv('A=x\n', { A: 'se$&cret' })).toBe('A=se$&cret\n');
  });

  it('targets .env only when it is the sole env file', () => {
    expect(pickEnvFile((f: string) => f === '.env')).toBe('.env');
    expect(pickEnvFile(() => true)).toBe('.env.local');
    expect(pickEnvFile(() => false)).toBe('.env.local');
  });
});

describe('verifyAccount', () => {
  it('rejects a malformed SID without calling the API', async () => {
    const req = vi.fn();
    await expect(verifyAccount(req, 'GO123')).rejects.toBeInstanceOf(SetupError);
    expect(req).not.toHaveBeenCalled();
  });

  it('returns the account name on success and explains a rejection', async () => {
    expect(await verifyAccount(vi.fn().mockResolvedValue(ok({ friendly_name: 'Sub' })), ACCOUNT)).toBe('Sub');
    await expect(verifyAccount(vi.fn().mockResolvedValue(err(401)), ACCOUNT)).rejects.toThrow(/rejected/);
  });
});

describe('getFlexConfig', () => {
  it('extracts instance and workspace SIDs', async () => {
    const req = vi.fn().mockResolvedValue(
      ok({ flex_instance_sid: 'GO1', taskrouter_workspace_sid: 'WS1', chat_service_instance_sid: 'IS1' }),
    );
    expect(await getFlexConfig(req)).toEqual({ instanceSid: 'GO1', workspaceSid: 'WS1', chatServiceSid: 'IS1' });
  });

  it('tells the user to launch Flex when the account has none', async () => {
    await expect(getFlexConfig(vi.fn().mockResolvedValue(err(404)))).rejects.toThrow(/Launch Flex|launch Flex/);
  });
});

describe('ensureSyncService', () => {
  it('reuses the configured service', async () => {
    const req = vi.fn().mockResolvedValue(ok({ services: [{ sid: 'IS1', friendly_name: 'Default Service' }] }));
    expect(await ensureSyncService(req, 'IS1')).toEqual({ sid: 'IS1', created: false });
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('reuses a service it created on an earlier run', async () => {
    const req = vi.fn().mockResolvedValue(ok({ services: [{ sid: 'IS2', friendly_name: RESOURCE_NAME }] }));
    expect(await ensureSyncService(req, undefined)).toEqual({ sid: 'IS2', created: false });
  });

  it('creates one when none matches', async () => {
    const req = vi
      .fn()
      .mockResolvedValueOnce(ok({ services: [{ sid: 'IS9', friendly_name: 'Default Service' }] }))
      .mockResolvedValueOnce(ok({ sid: 'ISnew' }));
    expect(await ensureSyncService(req, undefined)).toEqual({ sid: 'ISnew', created: true });
    expect(req).toHaveBeenLastCalledWith('POST', expect.stringContaining('/Services'), {
      FriendlyName: RESOURCE_NAME,
    });
  });
});

describe('ensureApiKey', () => {
  it('keeps an existing key that can read Flex', async () => {
    const req = vi.fn();
    const makeClient = () => vi.fn().mockResolvedValue(ok({}));
    const out = await ensureApiKey(req, ACCOUNT, { apiKey: 'SKold', apiSecret: 's' }, makeClient);
    expect(out).toEqual({ apiKey: 'SKold', apiSecret: 's', created: false });
    expect(req).not.toHaveBeenCalled();
  });

  it('replaces a key without permissions (error 8001) with a new Standard key', async () => {
    const req = vi.fn().mockResolvedValue(ok({ sid: 'SKnew', secret: 'fresh' }));
    const makeClient = () => vi.fn().mockResolvedValue(err(401, 8001));
    const out = await ensureApiKey(req, ACCOUNT, { apiKey: 'SKold', apiSecret: 's' }, makeClient);
    expect(out).toEqual({ apiKey: 'SKnew', apiSecret: 'fresh', created: true });
    expect(req).toHaveBeenCalledWith('POST', expect.stringContaining(`/Accounts/${ACCOUNT}/Keys.json`), {
      FriendlyName: RESOURCE_NAME,
    });
  });

  it('creates a key when none is configured', async () => {
    const req = vi.fn().mockResolvedValue(ok({ sid: 'SKnew', secret: 'fresh' }));
    const out = await ensureApiKey(req, ACCOUNT, { apiKey: '', apiSecret: '' });
    expect(out.created).toBe(true);
  });
});

describe('listAgentUsernames', () => {
  it('returns only workers that resolve as Flex users', async () => {
    const req = vi.fn(async (_m: string, url: string): Promise<Reply> => {
      if (url.includes('/Workers')) {
        return ok({ workers: [{ friendly_name: 'jdoe' }, { friendly_name: 'bot-worker' }] });
      }
      return ok({ users: url.includes('Username=jdoe') ? [{ flex_user_sid: 'FU1' }] : [] });
    });
    expect(await listAgentUsernames(req, 'WS1', 'GO1')).toEqual(['jdoe']);
  });
});

describe('chooseUsername', () => {
  it('keeps a still-valid current username without asking', async () => {
    const ask = vi.fn();
    expect(await chooseUsername(['a', 'b'], 'b', ask)).toBe('b');
    expect(ask).not.toHaveBeenCalled();
  });

  it('auto-picks a single agent and returns null when there are none', async () => {
    expect(await chooseUsername(['only'], undefined, vi.fn())).toBe('only');
    expect(await chooseUsername([], undefined, vi.fn())).toBeNull();
  });

  it('asks when there are several', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await chooseUsername(['a', 'b'], undefined, vi.fn().mockResolvedValue('2'))).toBe('b');
  });
});

describe('resolveCredentials', () => {
  it('reuses saved credentials without prompting', async () => {
    const prompt = vi.fn();
    const out = await resolveCredentials({ TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: 't' }, prompt);
    expect(out).toEqual({ accountSid: ACCOUNT, authToken: 't', reused: true });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts when either is missing, passing what is saved', async () => {
    const env = { TWILIO_ACCOUNT_SID: ACCOUNT };
    const prompt = vi.fn().mockResolvedValue({ accountSid: ACCOUNT, authToken: 'typed' });
    expect(await resolveCredentials(env, prompt)).toEqual({ accountSid: ACCOUNT, authToken: 'typed', reused: false });
    expect(prompt).toHaveBeenCalledWith(env);
  });

  it('requires both after prompting', async () => {
    const prompt = vi.fn().mockResolvedValue({ accountSid: '', authToken: '' });
    await expect(resolveCredentials({}, prompt)).rejects.toBeInstanceOf(SetupError);
  });
});
