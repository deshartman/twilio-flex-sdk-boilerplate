import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMessages } from '../loadMessages';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
  fs.mkdirSync(path.join(tmp, 'core', 'en'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'core', 'en', 'common.json'),
    JSON.stringify({ app: { title: 'Hi' } }),
  );
  fs.mkdirSync(path.join(tmp, 'features', 'voice', 'messages'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'features', 'voice', 'messages', 'en.json'),
    JSON.stringify({ dial: 'Dial' }),
  );
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadMessages', () => {
  it('keys core files by their filename namespace', () => {
    const m = loadMessages('en', {
      coreDir: path.join(tmp, 'core'),
      featuresDir: path.join(tmp, 'features'),
    });
    expect(m.common).toEqual({ app: { title: 'Hi' } });
  });

  it('keys each feature catalog by its directory-name namespace', () => {
    const m = loadMessages('en', {
      coreDir: path.join(tmp, 'core'),
      featuresDir: path.join(tmp, 'features'),
    });
    expect(m.voice).toEqual({ dial: 'Dial' });
  });

  it('returns core namespaces and never throws when the features dir is absent', () => {
    const m = loadMessages('en', {
      coreDir: path.join(tmp, 'core'),
      featuresDir: path.join(tmp, 'does-not-exist'),
    });
    expect(m.common).toBeDefined();
    expect(m.voice).toBeUndefined();
  });

  it('loads the real committed shell catalogs for en and es-ES', () => {
    const en = loadMessages('en');
    const es = loadMessages('es-ES');
    expect((en.common!.localeSwitcher as { label: string }).label).toBe('Select language');
    expect((es.common!.localeSwitcher as { label: string }).label).toBe('Seleccionar idioma');
  });
});
