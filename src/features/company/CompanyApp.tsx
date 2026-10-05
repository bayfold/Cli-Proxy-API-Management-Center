import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '@/i18n';
import { MainLayout } from '@/components/layout/MainLayout';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore, useConfigStore, useLanguageStore, useThemeStore } from '@/stores';
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
  const [retry, setRetry] = useState(0);
  const refreshGeneration = useRef(0);

  useEffect(() => initializeTheme(), [initializeTheme]);
  useEffect(() => {
    setLanguage(language);
    document.documentElement.lang = language;
  }, [language, setLanguage]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    client.cancelPending();
    setLoading(true);
    const assertCurrent = () => {
      if (generation !== refreshGeneration.current) {
        throw new DOMException('Company bootstrap was superseded', 'AbortError');
      }
    };
    try {
      const identity = await client.me();
      assertCurrent();
      if (!identity.account_management) throw new CompanyError('member_login_required');
      activate(identity);
      // Discover server capabilities before routing a cold direct plugin URL.
      await useConfigStore.getState().fetchConfig(true);
      assertCurrent();
    } catch (failure) {
      assertCurrent();
      if (
        failure instanceof CompanyError &&
        ['unauthorized', 'member_login_required'].includes(failure.code)
      ) {
        useAuthStore.getState().logout();
      }
      throw failure;
    } finally {
      // A canceled language/identity bootstrap must not expose conditional routes
      // while its replacement is still discovering the server's capabilities.
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [activate, client]);

  useEffect(() => {
    // Authentication does not depend on the current translation function. A
    // language change updates the view without restarting the identity request.
    void refresh().catch(() => undefined);
    return () => {
      refreshGeneration.current += 1;
      client.cancelPending();
    };
  }, [client, refresh, retry]);

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
          <p role="alert">{t('company.tailscale_required')}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>{t('company.retry')}</Button>
        </Card>
      </div>
    );
  }
  const binding = JSON.stringify([member.id, member.admin ?? member.operator, member.capabilities]);
  return <MainLayout key={binding} company={{ member: member.login || member.id, refresh }} />;
}
