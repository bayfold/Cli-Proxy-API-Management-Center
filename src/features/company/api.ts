export interface Member {
  id: string;
  kind: 'member' | 'ci';
  models: string[];
  account_management: boolean;
  reauthentication: boolean;
}
export interface Account {
  id: string;
  provider: string;
  label: string;
  shared: boolean;
  revision: number;
  health: { status: string; disabled: boolean; unavailable: boolean } | null;
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
