import { useAuthStore } from '@/stores/useAuthStore';

// Browser affordances mirror server capabilities. The management proxy is the
// authority and checks every request, including requests outside this UI.
export function useCompanyAccess() {
  const member = useAuthStore((state) => state.companyMember);
  const admin = !!(member?.admin ?? member?.operator);
  return {
    member,
    company: member !== null,
    admin,
    canConfigure: !member || (member.capabilities?.config_write ?? admin),
    canDownloadCredentials: !member || (member.capabilities?.credentials_export ?? admin),
  };
}
