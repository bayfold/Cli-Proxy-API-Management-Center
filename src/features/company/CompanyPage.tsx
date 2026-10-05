import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { CompanyClient, type Account } from './api';
import { CompanyKeys, CompanyMetrics } from './CompanyViews';

export function CompanyPage({ view }: { view: 'keys' | 'usage' | 'logs' }) {
  const { t } = useTranslation();
  const member = useAuthStore((state) => state.companyMember);
  const notify = useNotificationStore((state) => state.showNotification);
  const client = useMemo(() => new CompanyClient(), []);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const report = useCallback(
    (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      notify(t('company.errors.request_failed'), 'error');
    },
    [notify, t]
  );
  useEffect(() => {
    let current = true;
    void client
      .accounts()
      .then((data) => {
        if (current) setAccounts(data.accounts);
      })
      .catch(report);
    return () => {
      current = false;
      client.cancelPending();
    };
  }, [client, report]);
  if (!member) return null;
  const props = { client, member, accounts, report, refreshVersion: 0 };
  return view === 'keys' ? (
    <CompanyKeys {...props} />
  ) : (
    <CompanyMetrics {...props} logs={view === 'logs'} />
  );
}
