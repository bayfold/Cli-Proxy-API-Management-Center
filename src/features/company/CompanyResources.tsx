import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import styles from './CompanyApp.module.scss';

const repository = 'https://github.com/bayfold/Cli-Proxy-API-Management-Center';
const resources = [
  ['resources_overview', `${repository}/blob/company/docs/company-gateway.md`],
  ['resources_oidc', `${repository}/blob/company/docs/ci-oidc.md`],
  ['resources_ui', repository],
  ['resources_widget', 'https://github.com/bayfold/CLIProxyPoolWidget'],
] as const;

export function CompanyResourceLinks() {
  const { t } = useTranslation();
  return (
    <nav className={styles.actions} aria-label={t('company.resources_title')}>
      {resources.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer">
          {t(`company.${label}`)}
        </a>
      ))}
    </nav>
  );
}

export function CompanyResources() {
  const { t } = useTranslation();
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <h1>{t('company.resources_title')}</h1>
        <p className={styles.muted}>{t('company.resources_hint')}</p>
      </div>
      <Card title={t('company.resources_components')}>
        <CompanyResourceLinks />
        <p className={styles.muted}>{t('company.resources_access')}</p>
      </Card>
      <Card title={t('company.resources_oidc')}>
        <p>{t('company.resources_oidc_status')}</p>
        <a href={resources[1][1]} target="_blank" rel="noopener noreferrer">
          {t('company.resources_read_spec')}
        </a>
      </Card>
    </div>
  );
}
