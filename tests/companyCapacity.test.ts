import { describe, expect, test } from 'bun:test';
import { capacityFreshness } from '../src/features/company/capacity';
import type { CapacityAccount } from '../src/features/company/api';

const account: CapacityAccount = {
  id: 'opaque',
  ownership_tier: 'own',
  priority: 0,
  reason: 'quota_ranked',
  freshness: 'fresh',
  observed_at: 1000,
  headroom: 0.4,
  scoreable: true,
  windows: [
    {
      id: 'weekly',
      resource: 'included',
      remaining_fraction: 0.4,
      observed_at: 1000,
      reset_at: 1100,
    },
  ],
};
describe('passive capacity display', () => {
  test('reset expiry awaits observation without inventing recovery', () => {
    expect(capacityFreshness(account, 1099_000)).toBe('fresh');
    expect(capacityFreshness(account, 1100_000)).toBe('awaiting_observation');
    expect(account.headroom).toBe(0.4);
  });
  test('old observations remain stale even while their reset is in the future', () => {
    expect(capacityFreshness({ ...account, windows: [] }, 1301_000)).toBe('stale');
    expect(capacityFreshness({ ...account, freshness: 'partial', windows: [] }, 1100_000)).toBe(
      'partial'
    );
  });
});
