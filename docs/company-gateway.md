# Company gateway components and integration specification

The [Bayfold Management UI](https://github.com/bayfold/Cli-Proxy-API-Management-Center)
and [macOS quota widget](https://github.com/bayfold/CLIProxyPoolWidget) are public
forks with upstream ancestry and license notices retained. Gateway service code
remains in the private company-gateway monorepo. Neither public component
contains deployment credentials or requires the proxy management key in company
mode.

## Identity and account ownership

The gateway authenticates members through trusted Tailscale Serve identity or
configured member credentials. Human sessions, model keys and CI leases have
different permissions. SQLite owns account custody, revisions, sharing and
operation state; provider tokens remain solely in CLIProxyAPI. Sharing grants
quota access and does not grant management or reset permission.

The native provider SDK determines request eligibility. The gateway preserves
own-account preference, highest native priority and healthy conversation affinity.
Native streaming and continuation semantics are unchanged.

## Personal subscriptions and the permitted pool

Personal subscriptions means accounts the authenticated member owns in the
gateway. The pool contains those accounts and explicitly shared subscriptions
that member is allowed to use, once each. Access counts are not a claim that all
accounts can serve a request now. Do not sum percentages across plans/providers.

The widget reads `GET /api/v1/subscriptions`, with only the gateway HTTPS origin
configured. Providers are discovered automatically. This human-session-only view
returns owned and permitted shared subscriptions, grouped by provider, with
included quota windows and reset times. The server selects exact SQLite-backed
SDK credentials and invokes the same fixed read-only Claude OAuth/Codex WHAM
usage APIs as standalone mode. Its shared one-minute cache coalesces reads and
applies provider backoff. Only public account IDs, labels and numeric windows
are returned; tokens, native credential IDs and raw provider responses stay on
the server. Ownership, sharing and lifecycle are rechecked after each batch.
Missing, failed, unsupported and stale quota remains unknown. No model ID or
management key is required in the widget.

Routing diagnostics still use
`GET /api/v1/capacity?provider=claude|codex&model=<allowed-ID>`.
This requires a human member session; model keys, CI principals and leases are
denied. The capacity endpoint makes no provider quota calls. Its response contains:

- `member_id`, `provider`, `model`, `mode`, `advisory: true`, and `accounts`.
- Account `id` is an opaque custody ID, with `ownership_tier: own|shared`,
  `freshness`, `scoreable`, optional `observed_at`, `headroom`, `limiting_reset`,
  and included-quota `windows`.
- Windows have `id`, `resource: included`, `remaining_fraction`, `observed_at`,
  and optional `duration_seconds`, `reset_at` and source label.
- Times are Unix seconds; fractions are in `[0,1]`. `coverage` and bounded
  aggregate counters are advisory, not token or spending budgets.

Unknown, partial, stale and awaiting-observation windows remain unknown for
ranking. Passing a reset time never establishes recovered quota. The native
widget uses tailnet member identity, clears old responses on connection changes,
and does not persist company summaries. OS timelines follow macOS refresh rules.
See the [widget setup and build instructions](https://github.com/bayfold/CLIProxyPoolWidget#company-subscriptions-mode-bayfold-fork-extension).

## Reset-aware routing

Implemented, off by default. `off` leaves routing unchanged and starts no reader;
`shadow` reads passive SDK observations and simulates decisions independently;
`enabled` can rank new bindings only for explicitly qualified provider/model
schemas. Existing healthy conversations retain their binding. Qualification
requires actual included windows and exact native model mapping; omitted,
ambiguous or additional limits are not guessed. Read-only observations do not
spend reset grants, clear cooldowns, refresh provider quota or buy credits.

Claude reset grants and Codex reset credits can be redeemed manually by company
admins when the provider says they are eligible. Clearing native cooldown is a
separate local operation and does not reset provider limits. No component
promises unlimited or automatically restored quota.

## GitHub Actions identity

[GitHub Actions OIDC specification](ci-oidc.md): implemented. Company admins
connect a metadata-only GitHub App, select repositories and manage exact
workflow/environment/model policies in the **GitHub Actions** UI section.
Multiple policies and generated CI identities live in SQLite, with disabled-first
creation, revision checks and immediate lease/stream revocation on policy changes.
GitHub connection tokens are encrypted server-side and used only for repository
selection; jobs receive short gateway leases. Workflow trust and membership
remain separate. See the spec for app registration, runner setup and migration.

## Builds, testing and upstream contributions

The deployable UI remains a pinned subtree in the gateway monorepo. A single
checkout contains the portal and contract tests, and `git archive` contains the
source needed for release staging. This avoids an additional submodule fetch in
CI/deployment while retaining a public fork for independent review. API and UI
changes are tested together before UI-only history is exported to the fork.

Standalone UI: Bun 1.3.14, `bun run verify`. Company artifact:
`VITE_COMPANY_GATEWAY=true bun run build`, after standalone verification.
The artifact is one self-contained HTML file. Gateway checks also cover both Go
modules, Playwright Chromium against a mocked authenticated API and the native
SDK fixture with synthetic providers/private temporary state. Automated tests
never use live provider credentials or quota.

Propose reusable layout hooks, session handling and quota display changes in
small upstream branches; keep company-specific adapters optional and preserve
standalone behavior. Upstream synchronization uses reviewed revisions and retains
licenses. Releases keep config/credentials/state outside Git, verify checksums,
back up private state, and retain a tested rollback release.
