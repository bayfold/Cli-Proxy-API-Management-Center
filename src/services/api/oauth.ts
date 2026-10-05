/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import { COMPANY_MODE } from '@/features/company/mode';
import { CompanyClient, type Operation } from '@/features/company/api';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'kimi-ai' | 'xai' | 'devin' | 'meta';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  user_code?: string;
  flow?: string;
  expires_in?: number;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthCancelResponse {
  status: 'ok';
  cancelled: boolean;
}

const WEBUI_SUPPORTED = new Set<string>(['codex', 'claude', 'antigravity', 'xai', 'devin']);
const companyClient = new CompanyClient();
const companyOperationKey = (provider: string) =>
  `company-oauth:${useAuthStore.getState().companyMember?.id ?? ''}:${provider}`;
const asCompanyLogin = (operation: Operation): OAuthStartResponse => ({
  url: operation.login_url ?? '',
  state: operation.id,
});

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key === 'anthropic' ? 'claude' : key;
};

export const oauthApi = {
  startAuth: async (provider: string, signal?: AbortSignal, accountId?: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    if (COMPANY_MODE) {
      if (!['claude', 'codex'].includes(providerKey))
        throw new Error('Provider sign-in is not supported by account custody');
      const account = accountId
        ? (await companyClient.accounts()).accounts.find((item) => item.id === accountId)
        : undefined;
      if (
        accountId &&
        (!account || account.can_manage !== true || account.provider !== providerKey)
      )
        throw new Error('Account cannot be managed by this identity');
      const operation = await companyClient.start(providerKey, account?.shared ?? true, account);
      sessionStorage.setItem(companyOperationKey(providerKey), operation.id);
      return asCompanyLogin(operation);
    }
    const params: Record<string, string | boolean> = { provider: providerKey };
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    return apiClient.get<OAuthStartResponse>('/oauth/auth-url', {
      params,
      ...(signal ? { signal } : {}),
    });
  },

  getAuthStatus: async (
    state: string,
    signal?: AbortSignal
  ): Promise<{ status: 'ok' | 'wait' | 'error'; error?: string }> => {
    if (COMPANY_MODE) {
      const operation = await companyClient.operation(state);
      const waiting = ['starting', 'pending', 'submitted', 'prepared'].includes(operation.status);
      if (!waiting)
        for (const provider of ['claude', 'codex']) {
          const key = companyOperationKey(provider);
          if (sessionStorage.getItem(key) === state) sessionStorage.removeItem(key);
        }
      return {
        status: waiting ? 'wait' : operation.status === 'complete' ? 'ok' : 'error',
        ...(!waiting && operation.status !== 'complete' ? { error: operation.status } : {}),
      };
    }
    return apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/oauth/status`, {
      params: { state },
      ...(signal ? { signal } : {}),
    });
  },

  resumeCompanyAuth: async (provider: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const key = companyOperationKey(providerKey);
    const id = sessionStorage.getItem(key);
    if (!id) return null;
    const operation = await companyClient.operation(id);
    if (!['starting', 'pending', 'submitted', 'prepared'].includes(operation.status)) {
      sessionStorage.removeItem(key);
      return null;
    }
    return asCompanyLogin(operation);
  },

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth/session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: async (
    provider: string,
    redirectUrl: string,
    signal?: AbortSignal,
    operationId?: string
  ) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    if (COMPANY_MODE) {
      if (!operationId) throw new Error('Missing account operation');
      await companyClient.complete(operationId, redirectUrl);
      return { status: 'ok' as const };
    }
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth/callback',
      { provider: providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
  },
};
