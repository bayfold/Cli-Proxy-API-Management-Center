// Company builds authenticate the browser with the trusted Tailscale identity.
// Provider and instance-management credentials never enter browser storage.
export const COMPANY_MODE = import.meta.env?.VITE_COMPANY_GATEWAY === 'true';
