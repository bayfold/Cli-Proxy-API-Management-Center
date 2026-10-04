import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter } from 'react-router-dom';
import { MainLayout, type CompanyLayout } from '@/components/layout/MainLayout';
import {
  IconSidebarDashboard,
  IconSidebarAuthFiles,
  IconSidebarQuickStart,
  IconSidebarLogs,
} from '@/components/ui/icons';
import { CompanyKeys, CompanyMetrics } from './CompanyViews';
import { Meter } from '@/features/dashboard/components/Meter';
import { useLanguageStore } from '@/stores/useLanguageStore';
import { useTranslation } from 'react-i18next';
import '@/i18n';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useThemeStore } from '@/stores/useThemeStore';
import {
  CompanyClient,
  CompanyError,
  type Account,
  type Accounts,
  type Member,
  type Operation,
} from './api';
import styles from './CompanyApp.module.scss';

const pending = (o: Operation | null) =>
  o && ['starting', 'pending', 'submitted', 'prepared'].includes(o.status);
const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export default function CompanyApp() {
  return (
    <HashRouter>
      <CompanySession />
    </HashRouter>
  );
}

function CompanySession() {
  const { t } = useTranslation();
  const initializeTheme = useThemeStore((s) => s.initializeTheme);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  useEffect(() => {
    setLanguage(language);
    document.documentElement.lang = language;
  }, [language, setLanguage]);
  const [key, setKey] = useState('');
  const [entry, setEntry] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [data, setData] = useState<Accounts>({ accounts: [], shared_pool: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [provider, setProvider] = useState('claude');
  const [shared, setShared] = useState(true);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [callback, setCallback] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const client = useMemo(() => new CompanyClient(key), [key]);
  const report = useCallback(
    (error: unknown) => {
      if (aborted(error)) return;
      if (error instanceof CompanyError && error.code === 'unauthorized') setMember(null);
      setMessage(
        t(`company.errors.${error instanceof CompanyError ? error.code : 'request_failed'}`, {
          defaultValue: t('company.errors.request_failed'),
        })
      );
    },
    [t]
  );
  const refresh = useCallback(async () => {
    const m = await client.me();
    if (!m.account_management) throw new CompanyError('member_login_required');
    const accounts = m.account_management
      ? await client.accounts()
      : { accounts: [], shared_pool: {} };
    setMember(m);
    setData(accounts);
    setRefreshVersion((v) => v + 1);
    const id = sessionStorage.getItem(`company-operation:${m.id}`);
    if (id) {
      try {
        setOperation(await client.operation(id));
      } catch (error) {
        if (error instanceof CompanyError && error.code === 'not_found')
          sessionStorage.removeItem(`company-operation:${m.id}`);
        else throw error;
      }
    }
  }, [client]);
  useEffect(() => initializeTheme(), [initializeTheme]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setMember(null);
    setOperation(null);
    setMessage('');
    void refresh()
      .catch(report)
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      client.cancelPending();
    };
  }, [client, refresh, report]);
  useEffect(() => {
    if (!pending(operation) || !member) return;
    const timer = setTimeout(() => {
      void client
        .operation(operation!.id)
        .then(async (next) => {
          setOperation(next);
          if (!pending(next)) {
            sessionStorage.removeItem(`company-operation:${member.id}`);
            await refresh();
          }
        })
        .catch((error) => {
          report(error);
          if (!aborted(error)) setPollRetry((n) => n + 1);
        });
    }, 1500);
    return () => clearTimeout(timer);
  }, [client, member, operation, refresh, report, pollRetry]);
  const action = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await task();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  const start = async (account?: Account) => {
    if (!member || pending(operation)) return;
    const next = await client.start(
      account?.provider ?? provider,
      account?.shared ?? shared,
      account
    );
    sessionStorage.setItem(`company-operation:${member.id}`, next.id);
    setOperation(next);
    setCallback('');
  };
  const health = (account: Account) =>
    !account.health
      ? 'unknown'
      : account.health.disabled
        ? 'disabled'
        : account.health.unavailable
          ? 'unavailable'
          : account.health.status === 'active'
            ? 'connected'
            : 'unknown';

  const accountsPage = (
    <>
      <div className={styles.intro}>
        <h1>{t('company.accounts_title')}</h1>
        <p className={styles.muted}>{t('company.accounts_hint')}</p>
      </div>
      <div className={styles.stack}>
        <Card title={t('company.shared_pool')}>
          <p className={styles.muted}>
            {Object.entries(data.shared_pool)
              .map(([name, count]) => `${count} ${name}`)
              .join(' · ') || t('company.no_shared')}
          </p>
        </Card>
        <div className={styles.grid}>
          {!data.accounts.length && (
            <Card>
              <p>{t('company.no_accounts')}</p>
            </Card>
          )}
          {data.accounts.map((account) => (
            <Card key={account.id} className={styles.card}>
              <div className={styles.provider}>{account.provider}</div>
              <h2>{account.label}</h2>
              <div>
                <span className={styles.badge}>{t(`company.health.${health(account)}`)}</span>
              </div>
              {account.health?.quota_windows?.length ? (
                account.health.quota_windows.map((window) => (
                  <div key={window.name}>
                    <div className={styles.muted}>
                      {window.name} · {window.remaining_percent.toFixed(1)}%{' '}
                      {t('company.remaining')}
                      {window.stale ? ` · ${t('company.stale')}` : ''}
                    </div>
                    <Meter
                      ariaLabel={`${account.label} ${window.name}`}
                      value={window.stale ? null : window.remaining_percent}
                    />
                    <p className={styles.muted}>
                      {t('company.observed')} {new Date(window.observed_at * 1000).toLocaleString()}
                      {window.reset_at
                        ? ` · ${t('company.reset')} ${new Date(window.reset_at * 1000).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                ))
              ) : (
                <p className={styles.muted}>{t('company.quota_unknown')}</p>
              )}
              <ToggleSwitch
                checked={account.shared}
                label={t('company.share')}
                disabled={busy}
                onChange={(value) =>
                  void action(async () => {
                    await client.share(account, value);
                    await refresh();
                  })
                }
              />
              <Button
                variant="secondary"
                disabled={busy || !member?.reauthentication || !!pending(operation)}
                onClick={() => void action(() => start(account))}
              >
                {t('company.reconnect')}
              </Button>
            </Card>
          ))}
        </div>
        {member?.account_management && (
          <Card title={t('company.add_account')}>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => start());
              }}
            >
              <label>
                {t('company.provider')}
                <select
                  className="input"
                  aria-label={t('company.provider')}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </label>
              <ToggleSwitch checked={shared} label={t('company.share')} onChange={setShared} />
              <Button
                type="submit"
                disabled={busy || !member?.reauthentication || !!pending(operation)}
              >
                {t('company.connect_account')}
              </Button>
              {!member?.reauthentication && <p className={styles.muted}>{t('company.offline')}</p>}
            </form>
          </Card>
        )}
        {operation && (
          <Card title={t('company.sign_in')}>
            <div className={styles.form}>
              <span className={styles.badge}>
                {t(`company.operation.${operation.status}`, {
                  defaultValue: operation.status,
                })}
              </span>
              {operation.login_url && pending(operation) && (
                <a href={operation.login_url} target="_blank" rel="noreferrer">
                  {t('company.provider_sign_in')}
                </a>
              )}
              {operation.status === 'pending' && (
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await client.complete(operation.id, callback);
                      setCallback('');
                      setOperation(await client.operation(operation.id));
                    });
                  }}
                >
                  <p className={styles.muted}>{t('company.callback_hint')}</p>
                  <Input
                    label={t('company.callback_url')}
                    value={callback}
                    onChange={(e) => setCallback(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <Button type="submit" loading={busy}>
                    {t('company.complete')}
                  </Button>
                </form>
              )}
            </div>
          </Card>
        )}
        <p className={styles.muted}>{t('company.quota_hint')}</p>
      </div>
    </>
  );
  const views = { client, member: member!, accounts: data.accounts, report, refreshVersion };
  const layout: CompanyLayout = {
    member: member?.id ?? '',
    refresh: async () => {
      await action(refresh);
    },
    navGroups: [
      {
        id: 'company',
        labelKey: 'company.navigation',
        items: [
          { path: '/', labelKey: 'company.usage', icon: <IconSidebarDashboard size={18} /> },
          {
            path: '/auth-files',
            labelKey: 'company.accounts',
            badge: data.accounts.length,
            icon: <IconSidebarAuthFiles size={18} />,
          },
          { path: '/connect', labelKey: 'company.keys', icon: <IconSidebarQuickStart size={18} /> },
          { path: '/request-logs', labelKey: 'company.logs', icon: <IconSidebarLogs size={18} /> },
        ],
      },
    ],
    render: (location) => (
      <>
        {message && (
          <div role="status" className={styles.status}>
            {message}
          </div>
        )}
        {location.pathname === '/auth-files' ? (
          accountsPage
        ) : location.pathname === '/connect' ? (
          <CompanyKeys {...views} />
        ) : (
          <CompanyMetrics {...views} logs={location.pathname === '/request-logs'} />
        )}
      </>
    ),
  };
  if (loading)
    return (
      <div className={styles.shell} role="status">
        {t('company.loading')}
      </div>
    );
  if (member) return <MainLayout company={layout} />;
  return (
    <div className={styles.shell}>
      <div className={styles.brand}>Company Gateway</div>
      {message && (
        <div role="status" className={styles.status}>
          {message}
        </div>
      )}
      <div className={styles.login}>
        <Card title={t('company.login')}>
          <p className={styles.muted}>{t('company.login_hint')}</p>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (entry) {
                setKey(entry);
                setEntry('');
              }
            }}
          >
            <Input
              label={t('company.access_key')}
              type="password"
              autoComplete="off"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              required
            />
            <Button type="submit">{t('company.connect')}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
