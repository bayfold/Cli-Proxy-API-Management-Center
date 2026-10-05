import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { apiCallApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { QuotaCacheNotice } from '@/features/quota/components/QuotaCacheNotice';
import { notifyQuotaRefresh, quotaCacheFromError } from '@/features/quota/cacheMetadata';
import type { QuotaCacheMetadata } from '@/types';

const english = i18n.cloneInstance({ lng: 'en' });
const request = apiCallApi.request;
const post = apiClient.post;
const t = ((key: string) => key) as TFunction;
const cache: QuotaCacheMetadata = {
  fetchedAt: Date.now() - 120000,
  stale: true,
  retryAt: Date.now() + 120000,
  refreshStatus: 429,
};
afterEach(() => {
  apiCallApi.request = request;
  apiClient.post = post;
});
beforeAll(async () => {
  await english.changeLanguage('en');
});

describe('quota refresh metadata', () => {
  test('normalizes the guarded envelope and ignores malformed cache metadata', async () => {
    apiClient.post = (async () => ({
      status_code: 200,
      body: '{}',
      quota_cache: {
        fetched_at: cache.fetchedAt,
        stale: true,
        retry_at: cache.retryAt,
        refresh_status: 429,
      },
    })) as typeof post;
    const result = await apiCallApi.request({ method: 'GET', url: 'synthetic' });
    expect(result.quotaCache).toEqual(cache);
    apiClient.post = (async () => ({
      status_code: 200,
      body: '{}',
      quota_cache: {
        fetched_at: 'invalid',
        stale: true,
      },
    })) as typeof post;
    expect(
      (await apiCallApi.request({ method: 'GET', url: 'synthetic' })).quotaCache
    ).toBeUndefined();
  });

  test('Claude keeps windows with stale metadata and propagates cold 429 retry information', async () => {
    apiCallApi.request = async () => ({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: { five_hour: { utilization: 40, resets_at: null } },
      quotaCache: cache,
    });
    const file = { name: 'synthetic.json', auth_index: 'idx-test' };
    const data = await CLAUDE_CONFIG.fetchQuota(file, t);
    const state = CLAUDE_CONFIG.buildSuccessState(data);
    expect(state.windows[0].usedPercent).toBe(40);
    expect(state.quotaCache).toEqual(cache);
    apiCallApi.request = async () => ({
      statusCode: 429,
      header: {},
      bodyText: '',
      body: { error: 'rate limited' },
      quotaCache: { ...cache, stale: false, fetchedAt: 0 },
    });
    try {
      await CLAUDE_CONFIG.fetchQuota(file, t);
      throw new Error('expected 429');
    } catch (error) {
      expect(quotaCacheFromError(error)?.retryAt).toBe(cache.retryAt);
    }
  });

  test('Codex retains cache metadata along with quota windows', async () => {
    apiCallApi.request = async () => ({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: { rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000 } } },
      quotaCache: cache,
    });
    const data = await CODEX_CONFIG.fetchQuota(
      { name: 'synthetic.json', auth_index: 'idx-test' },
      t
    );
    expect(CODEX_CONFIG.buildSuccessState(data).quotaCache).toEqual(cache);
  });

  test('stale quota warns instead of reporting a successful refresh', () => {
    const notifications: unknown[] = [];
    notifyQuotaRefresh({ quotaCache: cache }, 'synthetic.json', t, (message, type) =>
      notifications.push([message, type])
    );
    expect(notifications).toEqual([['quota_management.refresh_cached', 'warning']]);
  });

  test('shows the last success, retry time and the distinction from inference exhaustion', () => {
    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: english }, createElement(QuotaCacheNotice, { cache }))
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Showing the last successful quota');
    expect(markup).toContain('Quota refresh is paused until');
    expect(markup).toContain('This does not mean inference quota is exhausted');
    expect(
      renderToStaticMarkup(
        createElement(QuotaCacheNotice, { cache: { fetchedAt: 1, stale: false } })
      )
    ).toBe('');
  });
});
