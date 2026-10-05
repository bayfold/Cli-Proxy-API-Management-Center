import type { TFunction } from 'i18next';
import type { QuotaCacheMetadata } from '@/types';

export function quotaCacheFromError(error: unknown): QuotaCacheMetadata | undefined {
  if (error instanceof Error && 'quotaCache' in error) {
    return error.quotaCache as QuotaCacheMetadata | undefined;
  }
  return undefined;
}

export function notifyQuotaRefresh(
  state: { quotaCache?: QuotaCacheMetadata },
  name: string,
  t: TFunction,
  notify: (message: string, type: 'success' | 'warning') => void
) {
  if (state.quotaCache?.stale) {
    notify(t('quota_management.refresh_cached'), 'warning');
  } else {
    notify(t('auth_files.quota_refresh_success', { name }), 'success');
  }
}
