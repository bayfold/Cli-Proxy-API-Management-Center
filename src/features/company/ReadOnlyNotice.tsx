import { useTranslation } from 'react-i18next';
import { useCompanyAccess } from './access';

export function ReadOnlyNotice() {
  const { t } = useTranslation();
  const { company, canConfigure } = useCompanyAccess();
  return company && !canConfigure ? (
    <p className="status-badge" role="note">
      {t('company.global_read_only')}
    </p>
  ) : null;
}
