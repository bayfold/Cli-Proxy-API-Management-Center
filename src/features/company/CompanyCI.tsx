import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores';
import { CompanyError } from './api';
import {
  CompanyCIClient,
  type GitHubConnection,
  type GitHubRepository,
  type GitHubWorkload,
  type WorkloadPolicy,
} from './ciApi';
import styles from './CompanyApp.module.scss';

const initialPolicy: WorkloadPolicy = {
  workflow_path: '.github/workflows/agent-review.yml',
  ref: 'refs/heads/main',
  event_name: 'workflow_dispatch',
  environment: 'agent-ci',
  audience: 'company-gateway-ci',
  model: '',
};
const spec =
  'https://github.com/bayfold/Cli-Proxy-API-Management-Center/blob/company/docs/ci-oidc.md';

export function CompanyCI() {
  const { t } = useTranslation();
  const member = useAuthStore((state) => state.companyMember);
  const admin = !!(member?.admin ?? member?.operator);
  const client = useMemo(() => new CompanyCIClient(), [member?.id, admin]);
  const epoch = useRef(0);
  const [github, setGitHub] = useState<GitHubConnection | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [workloads, setWorkloads] = useState<GitHubWorkload[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [capacity, setCapacity] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<GitHubWorkload | null>(null);
  const [repository, setRepository] = useState('');
  const [policy, setPolicy] = useState(initialPolicy);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    client_id: '',
    client_secret: '',
    app_id: '',
    app_slug: '',
    origin: location.origin,
  });
  const report = useCallback(
    (failure: unknown) => {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      const code = failure instanceof CompanyError ? failure.code : 'request_failed';
      setError(
        t(`company.ci_errors.${code}`, { defaultValue: t('company.ci_errors.request_failed') })
      );
    },
    [t]
  );
  const load = useCallback(async () => {
    const generation = epoch.current;
    const [connection, data] = await Promise.all([client.github(), client.workloads()]);
    if (generation !== epoch.current) return;
    setGitHub(connection);
    setWorkloads(data.workloads);
    setModels(data.models);
    setCapacity(data.max_ci_concurrent);
    setSettings({
      client_id: connection.client_id,
      client_secret: '',
      app_id: connection.app_id,
      app_slug: connection.app_slug,
      origin: connection.origin || location.origin,
    });
    setPolicy((current) => ({ ...current, model: current.model || data.models[0] || '' }));
    if (connection.connected) {
      const catalog = await client.repositories();
      if (generation === epoch.current) setRepositories(catalog.repositories);
    } else {
      setRepositories([]);
    }
  }, [client]);
  useEffect(() => {
    const generation = ++epoch.current;
    setGitHub(null);
    setRepositories([]);
    setWorkloads([]);
    setError('');
    setSettingsOpen(false);
    setEditing(null);
    setBusy(false);
    setModels([]);
    setCapacity(0);
    setRepository('');
    setPolicy(initialPolicy);
    setSettings({
      client_id: '',
      client_secret: '',
      app_id: '',
      app_slug: '',
      origin: location.origin,
    });
    if (admin) void load().catch((failure) => generation === epoch.current && report(failure));
    return () => {
      epoch.current++;
      client.cancelPending();
    };
  }, [admin, client, load, report]);
  const act = async (operation: () => Promise<unknown>) => {
    const generation = epoch.current;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (generation === epoch.current) await load();
    } catch (failure) {
      if (generation === epoch.current) report(failure);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  };
  const rowPolicy = (row: GitHubWorkload): WorkloadPolicy => ({
    workflow_path: row.workflow_path,
    ref: row.ref,
    event_name: row.event_name,
    environment: row.environment,
    audience: row.audience,
    model: row.model,
  });
  if (!admin) {
    return <Card title={t('company.ci_title')}>{t('company.ci_admin_only')}</Card>;
  }
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <h1>{t('company.ci_title')}</h1>
        <p className={styles.muted}>{t('company.ci_hint')}</p>
        <a href={spec} target="_blank" rel="noopener noreferrer">
          {t('company.resources_read_spec')}
        </a>
      </div>
      {error && (
        <div role="alert" className={styles.status}>
          {error}
        </div>
      )}
      {!github && <p>{t('company.ci_loading')}</p>}
      {github && (
        <Card title={t('company.ci_github')}>
          <p>
            {github.connected
              ? t('company.ci_connected', { login: github.login })
              : t('company.ci_not_connected')}
          </p>
          <p className={styles.muted}>{t('company.ci_connect_hint')}</p>
          <div className={styles.actions}>
            <Button
              disabled={busy || !github.configured}
              onClick={() =>
                void act(async () => {
                  const generation = epoch.current;
                  const result = await client.connect();
                  const target = new URL(result.authorize_url);
                  if (
                    target.origin !== 'https://github.com' ||
                    target.pathname !== '/login/oauth/authorize'
                  )
                    throw new CompanyError('request_failed');
                  if (generation === epoch.current) location.assign(target.href);
                })
              }
            >
              {t('company.ci_connect')}
            </Button>
            {github.connected && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(async () => {})}>
                {t('company.ci_refresh_repos')}
              </Button>
            )}
            {github.connected && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() => client.disconnect(github.connection_revision))}
              >
                {t('company.ci_disconnect')}
              </Button>
            )}
            {github.configured && (
              <a href={github.install_url} target="_blank" rel="noopener noreferrer">
                {t('company.ci_install')}
              </a>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => setSettingsOpen(!settingsOpen)}>
              {t('company.ci_app_settings')}
            </Button>
          </div>
          {settingsOpen && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  const generation = epoch.current;
                  await client.configure({ ...settings, revision: github.revision });
                  if (generation !== epoch.current) return;
                  setSettings((current) => ({ ...current, client_secret: '' }));
                  setSettingsOpen(false);
                });
              }}
            >
              <p className={styles.muted}>{t('company.ci_app_hint')}</p>
              <a
                href="https://github.com/settings/apps/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('company.ci_register_app')}
              </a>
              <Input
                label={t('company.ci_client_id')}
                value={settings.client_id}
                required
                autoComplete="off"
                onChange={(event) => setSettings({ ...settings, client_id: event.target.value })}
              />
              <Input
                label={t('company.ci_app_id')}
                value={settings.app_id}
                required
                inputMode="numeric"
                onChange={(event) => setSettings({ ...settings, app_id: event.target.value })}
              />
              <Input
                label={t('company.ci_app_slug')}
                value={settings.app_slug}
                required
                onChange={(event) => setSettings({ ...settings, app_slug: event.target.value })}
              />
              <Input
                label={t('company.ci_origin')}
                type="url"
                value={settings.origin}
                required
                onChange={(event) => setSettings({ ...settings, origin: event.target.value })}
              />
              <Input
                label={t('company.ci_client_secret')}
                type="password"
                value={settings.client_secret}
                autoComplete="new-password"
                required={!github.configured}
                hint={t('company.ci_secret_hint')}
                onChange={(event) =>
                  setSettings({ ...settings, client_secret: event.target.value })
                }
              />
              <p>
                {t('company.ci_callback')}:{' '}
                <code>{settings.origin.replace(/\/$/, '')}/api/v1/oidc/github/callback</code>
              </p>
              <p className={styles.muted}>{t('company.ci_settings_warning')}</p>
              <Button type="submit" disabled={busy}>
                {t('company.ci_save_app')}
              </Button>
            </form>
          )}
        </Card>
      )}
      <Card title={editing ? t('company.ci_edit_policy') : t('company.ci_new_policy')}>
        <p className={styles.muted}>{t('company.ci_policy_hint')}</p>
        {capacity === 0 && <p role="status">{t('company.ci_capacity_warning')}</p>}
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const generation = epoch.current;
              if (editing) await client.updateWorkload(editing, policy, editing.enabled);
              else await client.createWorkload(repository, policy);
              if (generation !== epoch.current) return;
              setEditing(null);
              setRepository('');
              setPolicy({ ...initialPolicy, model: models[0] || '' });
            });
          }}
        >
          <label>
            {t('company.ci_repository')}
            <select
              className="input"
              aria-label={t('company.ci_repository')}
              required
              disabled={!!editing || busy}
              value={editing?.repository_id || repository}
              onChange={(event) => setRepository(event.target.value)}
            >
              <option value="">{t('company.ci_select_repository')}</option>
              {editing && !repositories.some((repo) => repo.id === editing.repository_id) && (
                <option value={editing.repository_id}>{editing.repository_full_name}</option>
              )}
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.full_name}
                </option>
              ))}
            </select>
          </label>
          <Input
            label={t('company.ci_workflow')}
            value={policy.workflow_path}
            required
            onChange={(event) => setPolicy({ ...policy, workflow_path: event.target.value })}
          />
          <Input
            label={t('company.ci_environment')}
            value={policy.environment}
            required
            onChange={(event) => setPolicy({ ...policy, environment: event.target.value })}
          />
          <Input
            label={t('company.ci_audience')}
            value={policy.audience}
            required
            onChange={(event) => setPolicy({ ...policy, audience: event.target.value })}
          />
          <label>
            {t('company.ci_model')}
            <select
              className="input"
              aria-label={t('company.ci_model')}
              required
              value={policy.model}
              onChange={(event) => setPolicy({ ...policy, model: event.target.value })}
            >
              <option value="">{t('company.ci_select_model')}</option>
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <p>{t('company.ci_fixed_policy')}</p>
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || (!editing && !github?.connected)}>
              {editing ? t('company.ci_save_policy') : t('company.ci_create_policy')}
            </Button>
            {editing && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setPolicy({ ...initialPolicy, model: models[0] || '' });
                }}
              >
                {t('company.ci_cancel')}
              </Button>
            )}
          </div>
        </form>
      </Card>
      <Card title={t('company.ci_policies')}>
        {!workloads.length && <p>{t('company.ci_no_policies')}</p>}
        <div className={styles.stack}>
          {workloads.map((row) => (
            <div key={row.id} className={styles.status}>
              <h3>{row.repository_full_name}</h3>
              <p>
                <code>{row.workflow_path}</code> · {row.environment} · {row.model}
              </p>
              <p>{row.enabled ? t('company.ci_enabled') : t('company.ci_disabled')}</p>
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(row);
                    setPolicy(rowPolicy(row));
                  }}
                >
                  {t('company.ci_edit')}
                </Button>
                <Button
                  disabled={busy || (!row.enabled && capacity === 0)}
                  onClick={() =>
                    void act(() => client.updateWorkload(row, rowPolicy(row), !row.enabled))
                  }
                >
                  {row.enabled ? t('company.ci_disable') : t('company.ci_enable')}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void act(() => client.deleteWorkload(row))}
                >
                  {t('company.ci_delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className={styles.muted}>{t('company.ci_revocation_hint')}</p>
      </Card>
      <Card title={t('company.ci_runner')}>
        <p>{t('company.ci_runner_hint')}</p>
        <code>company-gateway-ci run -- your-agent-command</code>
      </Card>
    </div>
  );
}
