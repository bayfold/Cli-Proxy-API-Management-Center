export interface Member {
  id: string;
  kind: 'member' | 'ci';
  models: string[];
  account_management: boolean;
  reauthentication: boolean;
  operator: boolean;
  allow_shared: boolean;
  model_providers: Record<string, string>;
}
export interface Account {
  id: string;
  provider: string;
  label: string;
  shared: boolean;
  revision: number;
  health: {
    status: string;
    disabled: boolean;
    unavailable: boolean;
    quota_windows?: {
      name: string;
      remaining_percent: number;
      reset_at: number;
      observed_at: number;
      stale: boolean;
    }[];
  } | null;
}
export interface Accounts {
  accounts: Account[];
  shared_pool: Record<string, number>;
}
export interface Operation {
  id: string;
  status: string;
  login_url?: string;
}

export interface AccessKey {
  id: string;
  account_id: string;
  name: string;
  created_at: number;
  expires_at: number;
  revoked_at: number;
}
export interface UsageSummary {
  requests: number;
  success: number;
  failed: number;
  in_flight: number;
  usage_events: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
}
export interface RequestLog {
  id: string;
  member: string;
  key_id: string;
  account_id: string;
  model: string;
  protocol: string;
  started_at: number;
  status: number;
  latency_ms: number;
}
export interface UsageFilter {
  account_id: string;
  key_id: string;
  period: '24h' | '7d' | '30d';
  scope: 'self' | 'team';
}

export class CompanyError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

// Separate API authority from the upstream instance-management client. Keys
// remain in memory, and only this origin's company API can receive them.
export class CompanyClient {
  private requests = new Set<AbortController>();
  private generation = 0;
  constructor(private key = '') {}
  cancelPending() {
    this.generation++;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/v1/')) throw new CompanyError('invalid_route');
    const controller = new AbortController();
    const generation = this.generation;
    this.requests.add(controller);
    try {
      const headers = new Headers(options.headers);
      if (this.key) headers.set('Authorization', `Bearer ${this.key}`);
      if (options.body) headers.set('Content-Type', 'application/json');
      const response = await fetch(path, {
        ...options,
        headers,
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      const data = await response.json();
      if (generation !== this.generation) throw new DOMException('Session changed', 'AbortError');
      if (!response.ok) throw new CompanyError(data.error?.code ?? 'request_failed');
      return data as T;
    } finally {
      this.requests.delete(controller);
    }
  }
  me() {
    return this.request<Member>('/api/v1/me');
  }
  accounts() {
    return this.request<Accounts>('/api/v1/accounts');
  }
  keys() {
    return this.request<{ keys: AccessKey[] }>('/api/v1/access-keys');
  }
  createKey(name: string, account_id: string) {
    return this.request<{ key: AccessKey; token: string }>('/api/v1/access-keys', {
      method: 'POST',
      body: JSON.stringify({
        name,
        scope: account_id ? 'account' : 'pool',
        account_id,
        expires_in_days: 30,
      }),
    });
  }
  revokeKey(id: string) {
    return this.request(`/api/v1/access-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  }
  usage(filter: UsageFilter) {
    return this.request<{ summary: UsageSummary; retention_days: number }>(
      `/api/v1/usage?${this.query(filter)}`
    );
  }
  logs(filter: UsageFilter) {
    return this.request<{ requests: RequestLog[]; retention_days: number }>(
      `/api/v1/request-logs?${this.query(filter)}`
    );
  }
  private query(filter: UsageFilter) {
    return new URLSearchParams(Object.entries(filter).filter(([, value]) => !!value)).toString();
  }
  share(account: Account, shared: boolean) {
    return this.request(`/api/v1/accounts/${encodeURIComponent(account.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ shared, revision: account.revision }),
    });
  }
  start(provider: string, shared: boolean, account?: Account) {
    return this.request<Operation>('/api/v1/account-operations', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        provider,
        shared,
        ...(account ? { account_id: account.id, revision: account.revision } : {}),
      }),
    });
  }
  operation(id: string) {
    return this.request<Operation>(`/api/v1/account-operations/${encodeURIComponent(id)}`);
  }
  complete(id: string, callback_url: string) {
    return this.request(`/api/v1/account-operations/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ callback_url }),
    });
  }
}
