import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import type { Member } from '@/features/company/api';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const events: Event[] = [];
const memory = new Map<string, string>();
const identity: Member = {
  id: 'alice',
  kind: 'member',
  models: [],
  model_providers: {},
  allow_shared: true,
  account_management: true,
  reauthentication: true,
  operator: true,
  admin: true,
};
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://company.invalid' },
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
    },
  });
});
afterEach(() => {
  useAuthStore.getState().logout();
  events.length = 0;
  memory.clear();
});
afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

for (const [name, next] of [
  ['principal change', { ...identity, id: 'bob', operator: false, admin: false }],
  ['same-principal role reduction', { ...identity, operator: false, admin: false }],
] as const) {
  test(`${name} rejects an old admin response even when the URL and key stay the same`, async () => {
    useAuthStore.getState().activateCompanySession(identity);
    const before = apiClient.getConnectionRevision();
    let finish!: (response: AxiosResponse) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const adapter: AxiosAdapter = (config) =>
      new Promise((resolve) => {
        finish = (response) => resolve({ ...response, config });
        started();
      });
    const pending = apiClient.get('/config', { adapter });
    await ready;
    useAuthStore.getState().activateCompanySession(next);
    expect(apiClient.getConnectionRevision()).toBeGreaterThan(before);
    finish({
      data: { secret: 'old-admin-data' },
      status: 200,
      statusText: 'OK',
      config: {} as never,
      headers: { 'x-cpa-support-plugin': 'true', 'x-cpa-version': 'old-admin' },
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual([]);
    expect(useAuthStore.getState().companyMember?.admin).toBe(false);
  });
}

test('a stale unauthorized response cannot log out the replacement identity', async () => {
  useAuthStore.getState().activateCompanySession(identity);
  let fail!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const adapter: AxiosAdapter = (config) =>
    new Promise((_resolve, reject) => {
      fail = () =>
        reject(
          new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
            data: {},
            status: 401,
            statusText: 'Unauthorized',
            headers: {},
            config,
          })
        );
      started();
    });
  const pending = apiClient.get('/config', { adapter });
  await ready;
  useAuthStore
    .getState()
    .activateCompanySession({ ...identity, id: 'bob', admin: false, operator: false });
  fail();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(events).toEqual([]);
  expect(useAuthStore.getState().companyMember?.id).toBe('bob');
});

test('logout invalidates same-origin work before clearing cached identity', async () => {
  useAuthStore.getState().activateCompanySession(identity);
  const before = apiClient.getConnectionRevision();
  useAuthStore.getState().logout();
  expect(apiClient.getConnectionRevision()).toBeGreaterThan(before);
  expect(useAuthStore.getState().companyMember).toBeNull();
});
