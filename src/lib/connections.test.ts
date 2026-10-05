import { describe, expect, it } from 'vitest';
import { acsStack, bodyFor, draftFor, isDirty, type ConnectionDraft } from './connections';
import type { StoredConnection } from './server';

const stored = (over: Partial<StoredConnection> = {}): StoredConnection => ({
  id: 'c1',
  kind: 'splunk',
  name: 'default',
  base_url: 'https://splunk.example.com:8089',
  tls_verify: true,
  writes_enabled: false,
  created_at: '2026-10-05T00:00:00Z',
  ...over,
});

const draft = (over: Partial<ConnectionDraft>, from: StoredConnection | null = null): ConnectionDraft => ({
  ...draftFor(from?.kind ?? 'splunk', from),
  ...over,
});

describe('a connection draft', () => {
  it('starts from what is stored, without credentials, and is clean until something is typed', () => {
    const splunk = stored({ tls_verify: false, writes_enabled: true });
    const start = draftFor('splunk', splunk);
    expect(start).toMatchObject({ target: splunk.base_url, token: '', verify: false, writes: true });
    expect(isDirty('splunk', start, splunk)).toBe(false);
    expect(isDirty('splunk', { ...start, token: 'x' }, splunk)).toBe(true);
    expect(isDirty('splunk', { ...start, writes: false }, splunk)).toBe(true);
    expect(isDirty('splunk', draftFor('splunk', null), null)).toBe(false);
  });

  it('shows a Splunk Cloud connection as its stack name', () => {
    const cloud = stored({ kind: 'splunk_acs', base_url: 'https://admin.splunk.com/acme-prod/adminconfig/v2' });
    expect(draftFor('splunk_acs', cloud).target).toBe('acme-prod');
    expect(acsStack('https://admin.splunk.com.evil.example/acme/adminconfig/v2')).toBeNull();
  });
});

describe('what a draft sends', () => {
  it('needs an https address and credentials for a new Splunk connection', () => {
    expect(bodyFor('splunk', draft({ target: 'splunk.example.com:8089', token: 't' }), null)).toHaveProperty('problem');
    expect(bodyFor('splunk', draft({ target: 'http://splunk.example.com:8089', token: 't' }), null)).toHaveProperty('problem');
    expect(bodyFor('splunk', draft({ target: 'https://splunk.example.com:8089' }), null)).toEqual({ problem: 'Enter the token.' });
    expect(bodyFor('splunk', draft({ target: ' https://splunk.example.com:8089 ', token: ' t ', verify: false }), null)).toEqual({
      body: { base_url: 'https://splunk.example.com:8089', writes_enabled: false, secret: { token: 't', verify: false } },
    });
  });

  it('sends only the chosen kind of sign-in, and all of it', () => {
    const basic = draft({ target: 'https://s.example.com:8089', auth: 'basic', username: 'svc', token: 'ignored' });
    expect(bodyFor('splunk', basic, null)).toEqual({ problem: 'Enter the password as well.' });
    expect(bodyFor('splunk', { ...basic, password: 'pw' }, null)).toEqual({
      body: { base_url: 'https://s.example.com:8089', writes_enabled: false, secret: { username: 'svc', password: 'pw', verify: true } },
    });
  });

  it('keeps stored credentials when none are typed, and carries a certificate change alone', () => {
    const splunk = stored();
    expect(bodyFor('splunk', draft({ writes: true }, splunk), splunk)).toEqual({
      body: { base_url: splunk.base_url, writes_enabled: true },
    });
    expect(bodyFor('splunk', draft({ verify: false }, splunk), splunk)).toEqual({
      body: { base_url: splunk.base_url, writes_enabled: false, secret: { verify: false } },
    });
  });

  it('turns a stack name, or its pasted web address, into the Splunk Cloud admin address', () => {
    const want = { body: { base_url: 'https://admin.splunk.com/acme-prod/adminconfig/v2', writes_enabled: false, secret: { token: 'jwt' } } };
    expect(bodyFor('splunk_acs', draft({ target: 'acme-prod', token: 'jwt' }), null)).toEqual(want);
    expect(bodyFor('splunk_acs', draft({ target: 'https://ACME-prod.splunkcloud.com/en-US/app', token: 'jwt' }), null)).toEqual(want);
    expect(bodyFor('splunk_acs', draft({ target: 'https://evil.example/x', token: 'jwt' }), null)).toHaveProperty('problem');
  });

  it('leaves an address stored in another shape alone until it is retyped', () => {
    const gov = stored({ kind: 'splunk_acs', base_url: 'https://admin.splunkcloudgc.com/acme/adminconfig/v2' });
    expect(bodyFor('splunk_acs', draft({ writes: true }, gov), gov)).toEqual({
      body: { base_url: gov.base_url, writes_enabled: true },
    });
  });
});
