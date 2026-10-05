import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useNow } from '@/hooks/useNow';
import { CompanyClient, type Capacity } from '@/features/company/api';
import { capacityFreshness } from '@/features/company/capacity';
import type { AuthFileItem } from '@/types';
import styles from '@/features/company/CompanyApp.module.scss';

// One passive company read for the selected model. No provider probes or per-card timers.
export function CompanyCapacity({ files }: { files: AuthFileItem[] }) {
  const { t, i18n } = useTranslation();
  const member = useAuthStore((state) => state.companyMember);
  const generation = useAuthStore((state) => state.connectionStatus);
  const client = useMemo(() => new CompanyClient(), []);
  const [model, setModel] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<Capacity | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow(Boolean(member));
  const models =
    member?.models.filter((m) => ['claude', 'codex'].includes(member.model_providers[m])) ?? [];
  const selected = models.includes(model) ? model : (models[0] ?? '');
  const provider = member?.model_providers[selected] ?? '';
  useEffect(() => {
    let active = true;
    setResult(null);
    setFailed(false);
    if (member && selected && provider) {
      void client
        .capacity(provider, selected)
        .then((data) => {
          if (active && data.member_id === member.id) setResult(data);
        })
        .catch((error: unknown) => {
          if (active && !(error instanceof DOMException && error.name === 'AbortError'))
            setFailed(true);
        });
    }
    return () => {
      active = false;
      client.cancelPending();
    };
  }, [client, member, selected, provider, refresh, generation]);
  if (!member || !selected) return null;
  const format = (value: number) => new Date(value * 1000).toLocaleString(i18n.resolvedLanguage);
  return (
    <Card title={t('company.capacity_title')}>
      <p className={styles.muted}>{t('company.capacity_hint')}</p>
      <div className={styles.actions}>
        <label>
          {t('company.capacity_model')}
          <select
            className="input"
            aria-label={t('company.capacity_model')}
            value={selected}
            onChange={(event) => setModel(event.target.value)}
          >
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={() => setRefresh((value) => value + 1)}>
          {t('company.capacity_refresh')}
        </Button>
      </div>
      {failed && <p role="status">{t('company.capacity_unavailable')}</p>}
      {result && <p>{t(`company.capacity_mode_${result.mode}`)}</p>}
      {result?.accounts.map((account) => {
        const state = capacityFreshness(account, now);
        const file = files.find((item) => item.companyAccountId === account.id);
        return (
          <div key={account.id} className={styles.intro}>
            <strong>{file?.name || account.id}</strong> ·{' '}
            {t(`company.capacity_${account.ownership_tier}`)}
            <p>
              {t(`company.capacity_${state}`)}
              {state === 'fresh' &&
                account.headroom !== undefined &&
                ` · ${Math.round(account.headroom * 100)}%`}
            </p>
            {state === 'fresh' &&
              account.windows.map((window) => (
                <p key={`${window.source ?? 'credential'}-${window.id}-${window.observed_at}`}>
                  {t('company.capacity_window', {
                    window: window.id,
                    percent: Math.round(window.remaining_fraction * 100),
                  })}
                </p>
              ))}
            {account.observed_at && (
              <p>{t('company.capacity_observed', { time: format(account.observed_at) })}</p>
            )}
            {account.limiting_reset && (
              <p>{t('company.capacity_reset', { time: format(account.limiting_reset) })}</p>
            )}
          </div>
        );
      })}
    </Card>
  );
}
