import { afterEach, expect, test } from 'bun:test';
import { CompanyClient, CompanyError } from '../src/features/company/api';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('company credentials never use the upstream management client', async () => {
  let seen = false;
  globalThis.fetch = (async (path, options) => {
    expect(path).toBe('/api/v1/me');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer synthetic-member-key');
    expect(options?.redirect).toBe('error');
    seen = true;
    return Response.json({ id: 'alice' });
  }) as typeof fetch;
  const client = new CompanyClient('synthetic-member-key');
  await expect(client.request('/v8/management/credentials')).rejects.toBeInstanceOf(CompanyError);
  expect(seen).toBe(false);
  expect((await client.me()).id).toBe('alice');
});

test('a response from a previous session is rejected even if transport ignores abort', async () => {
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = (() =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    })) as typeof fetch;
  const client = new CompanyClient('synthetic-member-key');
  const result = client.me();
  client.cancelPending();
  finish!(Response.json({ id: 'previous-member' }));
  try {
    await result;
    throw new Error('stale response accepted');
  } catch (error) {
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  }
});

test('sharing and reconnect carry opaque account identity and revision', async () => {
  const account = {
    id: 'acct_opaque',
    label: 'Own account',
    provider: 'codex',
    shared: true,
    revision: 7,
    health: null,
  };
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_path, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json({ id: 'op_fixture', status: 'pending' });
  }) as typeof fetch;
  const client = new CompanyClient();
  await client.share(account, false);
  await client.start('codex', true, account);
  expect(bodies).toEqual([
    { shared: false, revision: 7 },
    { provider: 'codex', shared: true, account_id: 'acct_opaque', revision: 7 },
  ]);
});
