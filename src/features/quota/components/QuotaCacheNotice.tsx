import { useTranslation } from 'react-i18next';
import type { QuotaCacheMetadata } from '@/types';
import { useNow } from '@/hooks/useNow';
import styles from './QuotaCacheNotice.module.scss';

export function QuotaCacheNotice({ cache }: { cache?: QuotaCacheMetadata }) {
  const { t, i18n } = useTranslation();
  const now = useNow(Boolean(cache?.retryAt));
  if (!cache || (!cache.stale && !cache.retryAt)) return null;
  const format = (time: number) => new Date(time).toLocaleString(i18n.resolvedLanguage);
  return (
    <div className={styles.notice} role="status">
      {cache.stale && (
        <div>
          {t('quota_management.stale_result', {
            time: format(cache.fetchedAt),
          })}
        </div>
      )}
      {cache.refreshStatus === 429 && <div>{t('quota_management.refresh_rate_limited')}</div>}
      {cache.retryAt && cache.retryAt > now && (
        <div>
          {t('quota_management.retry_after', {
            time: format(cache.retryAt),
          })}
        </div>
      )}
    </div>
  );
}
