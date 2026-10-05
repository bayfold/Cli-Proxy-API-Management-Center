/**
 * Generic API call helper (proxied via management API).
 */

import type { AxiosRequestConfig } from 'axios';
import type { QuotaCacheMetadata } from '@/types';
import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export interface ApiCallRequest {
  authIndex?: string;
  proxy_url?: string;
  method: string;
  url: string;
  header?: Record<string, string>;
  data?: string;
}

export interface ApiCallResult<T = unknown> {
  quotaCache?: QuotaCacheMetadata;
  statusCode: number;
  header: Record<string, string[]>;
  bodyText: string;
  body: T | null;
}

const normalizeQuotaCache = (value: unknown): QuotaCacheMetadata | undefined => {
  if (
    !isRecord(value) ||
    typeof value.stale !== 'boolean' ||
    typeof value.fetched_at !== 'number' ||
    !Number.isSafeInteger(value.fetched_at) ||
    value.fetched_at < 0
  )
    return undefined;
  return {
    fetchedAt: value.fetched_at,
    stale: value.stale,
    retryAt:
      typeof value.retry_at === 'number' &&
      Number.isSafeInteger(value.retry_at) &&
      value.retry_at > 0
        ? value.retry_at
        : undefined,
    refreshStatus:
      typeof value.refresh_status === 'number' &&
      Number.isInteger(value.refresh_status) &&
      value.refresh_status >= 100 &&
      value.refresh_status <= 599
        ? value.refresh_status
        : undefined,
  };
};

const normalizeBody = (input: unknown): { bodyText: string; body: unknown | null } => {
  if (input === undefined || input === null) {
    return { bodyText: '', body: null };
  }

  if (typeof input === 'string') {
    const text = input;
    const trimmed = text.trim();
    if (!trimmed) {
      return { bodyText: text, body: null };
    }
    try {
      return { bodyText: text, body: JSON.parse(trimmed) };
    } catch {
      return { bodyText: text, body: text };
    }
  }

  try {
    return { bodyText: JSON.stringify(input), body: input };
  } catch {
    return { bodyText: String(input), body: input };
  }
};

export const getApiCallErrorMessage = (result: ApiCallResult): string => {
  const status = result.statusCode;
  const body = result.body;
  const bodyText = result.bodyText;
  let message = '';

  if (isRecord(body)) {
    const errorValue = body.error;
    if (isRecord(errorValue) && typeof errorValue.message === 'string') {
      message = errorValue.message;
    } else if (typeof errorValue === 'string') {
      message = errorValue;
    }
    if (!message && typeof body.message === 'string') {
      message = body.message;
    }
  } else if (typeof body === 'string') {
    message = body;
  }

  if (!message && bodyText) {
    message = bodyText;
  }

  if (status && message) return `${status} ${message}`.trim();
  if (status) return `HTTP ${status}`;
  return message || 'Request failed';
};

export const apiCallApi = {
  request: async (payload: ApiCallRequest, config?: AxiosRequestConfig): Promise<ApiCallResult> => {
    const response = await apiClient.post<Record<string, unknown>>(
      '/requests/api-call',
      payload,
      config
    );
    const statusCode = Number(response?.status_code ?? 0);
    const header = (response?.header ?? {}) as Record<string, string[]>;
    const { bodyText, body } = normalizeBody(response?.body);

    return {
      statusCode,
      ...(response?.quota_cache ? { quotaCache: normalizeQuotaCache(response.quota_cache) } : {}),
      header,
      bodyText,
      body,
    };
  },
};
