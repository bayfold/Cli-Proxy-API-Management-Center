import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '@/i18n';
import { MainLayout } from '@/components/layout/MainLayout';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore, useLanguageStore, useThemeStore } from '@/stores';
import { CompanyClient, CompanyError } from './api';
import styles from './CompanyApp.module.scss';

// The company build is the upstream management application. Only its login
// boundary changes: Serve supplies the caller identity to the company backend.
function CompanyRootShell() {
  return (
    <>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </>
  );
}

const companyRouter = createHashRouter([
  { element: <CompanyRootShell />, children: [{ path: '/*', element: <CompanySession /> }] },
]);

export default function CompanyApp() {
  return <RouterProvider router={companyRouter} />;
}

function CompanySession() {
  const { t } = useTranslation();
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const member = useAuthStore((state) => state.companyMember);
  const activate = useAuthStore((state) => state.activateCompanySession);
  const client = useMemo(() => new CompanyClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => initializeTheme(), [initializeTheme]);
  useEffect(() => {
    setLanguage(language);
    document.documentElement.lang = language;
  }, [language, setLanguage]);

  const refresh = useCallback(async () => {
    const identity = await client.me();
    if (!identity.account_management) throw new CompanyError('member_login_required');
    activate(identity);
  }, [activate, client]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void refresh()
      .catch((failure: unknown) => {
        if (!current || (failure instanceof DOMException && failure.name === 'AbortError')) return;
        setError(t('company.tailscale_required'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      client.cancelPending();
    };
  }, [client, refresh, retry, t]);

  if (loading) {
    return (
      <div className={styles.shell} role="status">
        <LoadingSpinner />
        <p>{t('company.loading')}</p>
      </div>
    );
  }
  if (!member) {
    return (
      <div className={styles.shell}>
        <Card title={t('company.identity_login')}>
          <p role="alert">{error || t('company.tailscale_required')}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>{t('company.retry')}</Button>
        </Card>
      </div>
    );
  }
  return <MainLayout company={{ member: member.login || member.id, refresh }} />;
}
