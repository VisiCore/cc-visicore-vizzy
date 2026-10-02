import { describe, expect, it } from 'vitest';
import { consume, covers, decide, searchWrites, type Approved, type CriblRequest } from './relay';

const request = (over: Partial<CriblRequest>): CriblRequest => ({
  request_id: 'r1',
  method: 'GET',
  path: '/api/v1/master/groups',
  content_type: '',
  body: null,
  approval_id: null,
  ...over,
});

const json = (body: unknown) => ({ content_type: 'application/json', body: JSON.stringify(body) });
const none: Approved = new Map();

describe('reads', () => {
  it('sends a GET to the Cribl API', () => {
    expect(decide(request({}), none)).toEqual({ send: true });
    expect(decide(request({ path: '/api/v1/m/default/system/inputs?limit=5' }), none)).toEqual({ send: true });
  });

  it('refuses anything that is not a Cribl API path', () => {
    for (const path of ['/app-ui/x', 'https://evil.example/api/v1/x', '/api/v1/../../x', '/api/v1/%2e%2e/x', '/api/v1//x']) {
      expect(decide(request({ path }), none).send, path).toBe(false);
    }
  });

  it('sends the POSTs that only read', () => {
    const reads = [
      '/api/v1/m/default_search/search/jobs',
      '/api/v1/system/metrics/query',
      '/api/v1/m/default/preview',
      '/api/v1/m/default/p/my-pack/preview',
      '/api/v1/w/node-1/edge/search/file',
    ];
    for (const path of reads) {
      expect(decide(request({ method: 'POST', path, ...json({ query: 'dataset="main" | limit 5' }) }), none).send, path).toBe(true);
    }
  });

  it('refuses a search that writes unless it was approved', () => {
    const search = { method: 'POST', path: '/api/v1/m/default_search/search/jobs' };
    const verdict = decide(request({ ...search, ...json({ query: 'dataset="main" | export to lake x' }) }), none);
    expect(verdict.send).toBe(false);
    expect(searchWrites('dataset="a" | where x | send group="g"')).toEqual(['send']);
    expect(searchWrites('dataset="exports" | where sender=="x"')).toEqual([]);
  });
});

describe('changes', () => {
  const source = { id: 'in_syslog', type: 'syslog', token: 's3cret' };
  const change = { method: 'POST', path: '/api/v1/m/default/system/inputs', ...json(source) };
  const card = { method: 'POST', url: 'https://cribl/api/v1/m/default/system/inputs', body: { ...source, token: '<redacted>' } };

  it('refuses a change nobody approved here', () => {
    expect(decide(request(change), none).send).toBe(false);
    expect(decide(request({ ...change, approval_id: 'a1' }), none).send).toBe(false);
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      expect(decide(request({ method, path: '/api/v1/m/default/system/inputs/in_syslog' }), none).send).toBe(false);
    }
  });

  it('sends the approved request once, and only that request', () => {
    const approved: Approved = new Map([['a1', [card]]]);
    const verdict = decide(request({ ...change, approval_id: 'a1' }), approved);
    expect(verdict.send).toBe(true);

    const elsewhere = { ...change, path: '/api/v1/m/prod/system/inputs', approval_id: 'a1' };
    expect(decide(request(elsewhere), approved).send).toBe(false);
    const altered = { ...change, ...json({ ...source, type: 'tcp' }), approval_id: 'a1' };
    expect(decide(request(altered), approved).send).toBe(false);
    expect(decide(request({ ...change, method: 'DELETE', approval_id: 'a1' }), approved).send).toBe(false);
    expect(decide(request({ ...change, approval_id: 'someone-elses' }), approved).send).toBe(false);

    consume(request({ ...change, approval_id: 'a1' }), approved, verdict.send ? verdict.uses : undefined);
    expect(decide(request({ ...change, approval_id: 'a1' }), approved).send).toBe(false);
  });

  it('matches a card whose secrets are masked, and nothing looser', () => {
    expect(covers({ a: '<redacted>' }, { a: 'anything' })).toBe(true);
    expect(covers({ a: '[secret: token from cribl_create_source]' }, { a: 'x' })).toBe(true);
    expect(covers({ a: '<redacted>' }, { a: { nested: 1 } })).toBe(false);
    expect(covers({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(covers({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(covers(null, null)).toBe(true);
    expect(covers(null, { a: 1 })).toBe(false);
  });
});
