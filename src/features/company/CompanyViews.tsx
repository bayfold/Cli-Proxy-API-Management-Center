import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { Meter } from '@/features/dashboard/components/Meter';
import type {
  Account,
  AccessKey,
  CompanyClient,
  Member,
  RequestLog,
  UsageFilter,
  UsageSummary,
} from './api';
import { connectionCommand } from './connect';
import styles from './CompanyApp.module.scss';

interface Props {
  client: CompanyClient;
  member: Member;
  accounts: Account[];
  report: (error: unknown) => void;
  refreshVersion: number;
}
const ignored = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function CompanyKeys({ client, member, accounts, report }: Props) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [name, setName] = useState('');
  const [account, setAccount] = useState(accounts[0]?.id ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('');
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const reload = useCallback(async () => setKeys((await client.keys()).keys), [client]);
  useEffect(() => {
    let active = true;
    void client
      .keys()
      .then((d) => {
        if (active) setKeys(d.keys);
      })
      .catch((e) => {
        if (active && !ignored(e)) report(e);
      });
    return () => {
      active = false;
    };
  }, [client, report]);
  const models = member.models.filter((m) => member.model_providers?.[m] === provider);
  const selectedModel = models.includes(model) ? model : (models[0] ?? '');
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <h1>{t('company.keys_title')}</h1>
        <p className={styles.muted}>{t('company.keys_hint')}</p>
      </div>
      <Card title={t('company.create_key')}>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              setToken('');
              const created = await client.createKey(name, account);
              setToken(created.token);
              setName('');
              await reload();
            });
          }}
        >
          <Input
            label={t('company.key_name')}
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <label>
            {t('company.key_scope')}
            <select
              className="input"
              aria-label={t('company.key_scope')}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required={!member.allow_shared}
            >
              {!accounts.length && !member.allow_shared && (
                <option value="">{t('company.no_accounts')}</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.provider}
                </option>
              ))}
              {member.allow_shared && <option value="">{t('company.pool_key')}</option>}
            </select>
          </label>
          <p className={styles.muted}>
            {account ? t('company.account_key_hint') : t('company.pool_key_hint')}
          </p>
          <Button type="submit" disabled={busy || (!account && !member.allow_shared)}>
            {t('company.create_key')}
          </Button>
        </form>
      </Card>
      {token && (
        <Card title={t('company.key_once')}>
          <p className={styles.muted}>{t('company.key_once_hint')}</p>
          <code className={styles.secret}>{token}</code>
          <div className={styles.actions}>
            <Button
              onClick={() =>
                void act(async () => {
                  await navigator.clipboard.writeText(token);
                  setCopied(true);
                })
              }
            >
              {t(copied ? 'company.copied' : 'company.copy')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setToken('');
                setCopied(false);
              }}
            >
              {t('company.dismiss')}
            </Button>
          </div>
        </Card>
      )}
      <Card title={t('company.issued_keys')}>
        <Table>
          <TableHeader>
            <TableRow>
              {['key_name', 'key_scope', 'expires', 'state', 'actions'].map((x) => (
                <TableHead key={x}>{t(`company.${x}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell>
                  {k.name}
                  <div className={styles.muted}>{k.id}</div>
                </TableCell>
                <TableCell>
                  {accounts.find((a) => a.id === k.account_id)?.label ?? t('company.pool_key')}
                </TableCell>
                <TableCell>{new Date(k.expires_at * 1000).toLocaleDateString()}</TableCell>
                <TableCell>
                  {t(
                    k.revoked_at
                      ? 'company.revoked'
                      : k.expires_at * 1000 <= clock
                        ? 'company.expired'
                        : 'company.active'
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy || !!k.revoked_at}
                    onClick={() =>
                      void act(async () => {
                        await client.revokeKey(k.id);
                        await reload();
                      })
                    }
                  >
                    {t('company.revoke')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!keys.length && (
              <TableRow>
                <TableCell colSpan={5}>{t('company.no_keys')}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Card title={t('company.launch_agent')}>
        <p className={styles.muted}>{t('company.launch_hint')}</p>
        <div className={styles.actions}>
          <select
            className="input"
            aria-label={t('company.provider')}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          <select
            className="input"
            aria-label={t('company.model')}
            value={selectedModel}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        {selectedModel ? (
          <>
            <pre className={styles.command}>
              {connectionCommand(provider, window.location.origin, selectedModel)}
            </pre>
            <Button
              variant="secondary"
              onClick={() =>
                void act(async () => {
                  await navigator.clipboard.writeText(
                    connectionCommand(provider, window.location.origin, selectedModel)
                  );
                })
              }
            >
              {t('company.copy_command')}
            </Button>
          </>
        ) : (
          <p>{t('company.no_models')}</p>
        )}
        <p className={styles.muted}>{t('company.bash_hint')}</p>
        <a
          href={
            provider === 'claude'
              ? 'https://code.claude.com/docs/en/llm-gateway-connect'
              : 'https://developers.openai.com/codex/config-reference'
          }
          target="_blank"
          rel="noreferrer"
        >
          {t('company.official_setup')}
        </a>
      </Card>
    </div>
  );
}

export function CompanyMetrics({
  client,
  member,
  accounts,
  report,
  refreshVersion,
  logs = false,
}: Props & { logs?: boolean }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<UsageFilter>({
    account_id: '',
    key_id: '',
    period: '24h',
    scope: 'self',
  });
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void client
      .keys()
      .then((d) => {
        if (active) setKeys(d.keys);
      })
      .catch((e) => {
        if (active && !ignored(e)) report(e);
      });
    return () => {
      active = false;
    };
  }, [client, report]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSummary(null);
    setRequests([]);
    void (
      logs
        ? client.logs(filter).then((d) => {
            if (active) setRequests(d.requests);
          })
        : client.usage(filter).then((d) => {
            if (active) setSummary(d.summary);
          })
    )
      .catch((e) => {
        if (active && !ignored(e)) report(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, filter, logs, report, refreshVersion]);
  const select = (field: keyof UsageFilter, value: string) =>
    setFilter((f) => ({
      ...f,
      [field]: value,
      ...(field === 'scope' ? { account_id: '', key_id: '' } : {}),
    }));
  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.label ??
    (id ? t('company.shared_pool') : t('company.not_selected'));
  const keyName = (id: string) => keys.find((k) => k.id === id)?.name ?? id;
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <h1>{t(logs ? 'company.logs_title' : 'company.usage_title')}</h1>
        <p className={styles.muted}>{t(logs ? 'company.logs_hint' : 'company.usage_hint')}</p>
      </div>
      <Card>
        <div className={styles.filters}>
          <label>
            {t('company.account_filter')}
            <select
              className="input"
              aria-label={t('company.account_filter')}
              value={filter.account_id}
              onChange={(e) => select('account_id', e.target.value)}
            >
              <option value="">{t('company.all_accounts')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('company.key_filter')}
            <select
              className="input"
              aria-label={t('company.key_filter')}
              value={filter.key_id}
              onChange={(e) => select('key_id', e.target.value)}
            >
              <option value="">{t('company.all_keys')}</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('company.period')}
            <select
              className="input"
              aria-label={t('company.period')}
              value={filter.period}
              onChange={(e) => select('period', e.target.value)}
            >
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
            </select>
          </label>
          {member.operator && (
            <label>
              {t('company.view_scope')}
              <select
                className="input"
                aria-label={t('company.view_scope')}
                value={filter.scope}
                onChange={(e) => select('scope', e.target.value)}
              >
                <option value="self">{t('company.my_usage')}</option>
                <option value="team">{t('company.company_usage')}</option>
              </select>
            </label>
          )}
        </div>
      </Card>
      {loading ? (
        <div role="status">{t('company.loading')}</div>
      ) : logs ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                {['time', 'model', 'key_name', 'account_filter', 'status', 'latency'].map((x) => (
                  <TableHead key={x}>{t(`company.${x}`)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.started_at * 1000).toLocaleString()}</TableCell>
                  <TableCell>
                    {r.model || '—'}
                    <div className={styles.muted}>{r.protocol}</div>
                  </TableCell>
                  <TableCell>{keyName(r.key_id)}</TableCell>
                  <TableCell>{accountName(r.account_id)}</TableCell>
                  <TableCell>{r.status || t('company.in_flight')}</TableCell>
                  <TableCell>{r.latency_ms} ms</TableCell>
                </TableRow>
              ))}
              {!requests.length && (
                <TableRow>
                  <TableCell colSpan={6}>{t('company.no_requests')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      ) : (
        summary && (
          <>
            <div className={styles.grid}>
              {(
                [
                  'requests',
                  'success',
                  'failed',
                  'total_tokens',
                  'input_tokens',
                  'output_tokens',
                  'cached_tokens',
                  'reasoning_tokens',
                  'usage_events',
                ] as const
              ).map((x) => (
                <Card key={x} title={t(`company.metric.${x}`)}>
                  <div className={styles.number}>{summary[x].toLocaleString()}</div>
                </Card>
              ))}
            </div>
            <Card title={t('company.success_rate')}>
              <Meter
                ariaLabel={t('company.success_rate')}
                value={
                  summary.success + summary.failed
                    ? (100 * summary.success) / (summary.success + summary.failed)
                    : null
                }
              />
              <p className={styles.muted}>{t('company.metrics_note')}</p>
            </Card>
          </>
        )
      )}
    </div>
  );
}
