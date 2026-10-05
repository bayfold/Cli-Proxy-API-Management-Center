import { CompanyClient } from './api';

export interface GitHubConnection {
  configured: boolean;
  revision: number;
  client_id: string;
  app_id: string;
  app_slug: string;
  origin: string;
  callback_url: string;
  install_url: string;
  connected: boolean;
  connection_revision: number;
  login: string;
  expires_at: number;
}
export interface GitHubRepository {
  id: string;
  owner_id: string;
  full_name: string;
}
export interface WorkloadPolicy {
  workflow_path: string;
  ref: string;
  event_name: string;
  environment: string;
  audience: string;
  model: string;
}
export interface GitHubWorkload extends WorkloadPolicy {
  id: string;
  repository_id: string;
  repository_owner_id: string;
  repository_full_name: string;
  principal_id: string;
  enabled: boolean;
  revision: number;
}
export class CompanyCIClient extends CompanyClient {
  github() {
    return this.request<GitHubConnection>('/api/v1/oidc/github');
  }
  repositories() {
    return this.request<{ repositories: GitHubRepository[] }>('/api/v1/oidc/github/repositories');
  }
  configure(settings: {
    revision: number;
    client_id: string;
    client_secret: string;
    app_id: string;
    app_slug: string;
    origin: string;
  }) {
    return this.request('/api/v1/oidc/github/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }
  connect() {
    return this.request<{ authorize_url: string }>('/api/v1/oidc/github/connect', {
      method: 'POST',
      body: '{}',
    });
  }
  disconnect(revision: number) {
    return this.request('/api/v1/oidc/github', {
      method: 'DELETE',
      body: JSON.stringify({ revision }),
    });
  }
  workloads() {
    return this.request<{
      workloads: GitHubWorkload[];
      models: string[];
      max_ci_concurrent: number;
    }>('/api/v1/oidc/workloads');
  }
  createWorkload(repository_id: string, policy: WorkloadPolicy) {
    return this.request('/api/v1/oidc/workloads', {
      method: 'POST',
      body: JSON.stringify({ repository_id, ...policy }),
    });
  }
  updateWorkload(workload: GitHubWorkload, policy: WorkloadPolicy, enabled: boolean) {
    return this.request(`/api/v1/oidc/workloads/${encodeURIComponent(workload.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...policy, revision: workload.revision, enabled }),
    });
  }
  deleteWorkload(workload: GitHubWorkload) {
    return this.request(`/api/v1/oidc/workloads/${encodeURIComponent(workload.id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ revision: workload.revision }),
    });
  }
}
