import type { CapacityAccount } from './api';

export function capacityFreshness(account: CapacityAccount, now: number) {
  if (account.windows.some((window) => window.reset_at && window.reset_at * 1000 <= now)) {
    return 'awaiting_observation';
  }
  if (account.observed_at && now - account.observed_at * 1000 > 300_000) return 'stale';
  return account.freshness;
}
