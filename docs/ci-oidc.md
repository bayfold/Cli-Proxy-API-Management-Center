# GitHub Actions: connected repositories and short CI leases

Implemented, 5 October 2026. Company admins manage multiple exact repository /
workflow policies in **GitHub Actions** in the management UI. Trust lives in the
existing private SQLite database and changes take effect without a restart.
New policies start disabled. With no enabled policy, the exchange returns `404`.

## Admin setup

1. Open **GitHub Actions → GitHub App settings**. Register a GitHub App with
   **Metadata: read-only** repository permission, no other permissions, webhooks
   disabled, and expiring user access tokens enabled. Use the HTTPS callback URL
   shown by the UI. The callback is reached by the admin's browser through the
   existing tailnet; public gateway ingress is unnecessary.
2. Enter the app's Client ID, numeric App ID, slug and client secret, plus the
   gateway's HTTPS origin. Settings are revisioned in SQLite. The secret is
   encrypted on the server and never returned or persisted in browser storage.
   Changing app settings clears existing GitHub connections, not workload rules.
3. Install the app on selected repositories, then **Connect GitHub**. Repository
   selection includes only repositories accessible to both the installed app
   and the connected admin's GitHub account. Use **Refresh repositories** after
   changing installation access. Reconnect after the eight-hour connection
   expires; refresh tokens are deliberately not retained.
4. Select a repository, exact `.github/workflows/*.yml` or `*.yaml` file,
   protected environment, audience and one gateway model. Create the disabled
   policy, review it, then enable it. Enabling rechecks current GitHub access and
   the repository's immutable ID, owner ID and full name. Rename/transfer requires
   recreating the policy rather than silently broadening trust.
5. Install `company-gateway-ci` and the approved command on the existing
   self-hosted tailnet runner. Configure the workflow below and perform a
   separately authorized, bounded real job canary.

GitHub documents [GitHub App user authorization and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
and the [installation repository listing](https://docs.github.com/en/rest/apps/installations).
Connecting GitHub selects repositories; it does not sign users into the gateway
or automatically grant Actions jobs access. Company membership and admin roles
still come from the gateway's existing authenticated Tailscale identity.

## Workload policy and isolation

Each policy has a generated CI principal, one allowed model, concurrency one,
shared-account access and no management privileges. Multiple repositories and
workflows are supported, with up to 128 nondeleted policies. Their requests also
share the existing global CI concurrency reservation. This controls concurrency,
not total tokens or spending. Enabling requires positive `max_ci_concurrent` in
host capacity configuration; global capacity/model enrollment remain host policy.

The initial restrictions remain explicit: `refs/heads/main`,
`workflow_dispatch`, a protected GitHub environment and
`runner_environment: self-hosted`. Hosted runners, reusable workflows, wildcard
trust, renewal and spending caps are not enabled by this change. Protect workflow
changes and execute only reviewed code. A workflow identity does not identify
an individual YAML job: only the approved job should receive `id-token: write`
and the protected environment. Configure GitHub environment protection rules
separately; a matching claim does not establish its reviewer rules.

Changing, disabling or deleting a policy increments its revision, invalidates
existing leases/routing tickets and cancels active requests. Disabling/deleting
works without GitHub connectivity. Disconnecting GitHub removes repository
selection credentials; existing policies remain until explicitly changed.
SQLite preserves custody and sharing, while AI provider credentials remain only
in CLIProxyAPI.

## Exchange contract

`POST /api/v1/workload-exchanges` is the only unauthenticated identity exchange,
on the existing tailnet listener. It runs before normal `/api/v1` authentication.
JSON only, 32 KiB maximum, unknown fields/trailing JSON rejected:

```json
{"provider":"github_oidc","id_token":"<GitHub JWT>"}
```

After signature verification, the gateway finds one enabled SQLite policy that
matches the exact repository ID, owner ID, workflow ref, git ref, event,
environment and single audience. Repository/owner identity is obtained from
GitHub API metadata during selection, never browser-supplied labels or IDs other
than the selected repository selector. Immutable metadata is rechecked when
creating/enabling trust, with connection revisions checked inside the database
transaction. Policy verification and proof consumption/signing are serialized
against policy changes.

Success is `201 {token,id,expires_at}`, `Cache-Control: no-store`; `expires_at`
is Unix seconds. The opaque HMAC lease lasts exactly 900 seconds, uses the
current process epoch, and carries policy ID/revision. Ordinary authentication,
model restrictions, revocation and native stream deadlines are reused. A proof
can expire before its lease. No GitHub access token reaches the job or client.

Errors: `400 invalid_exchange`, `401 invalid_identity_proof`,
`403 workload_not_allowed`, `409 proof_already_used`, `429 exchange_limited`,
`503 identity_verifier_unavailable`; no active policy returns `404 not_found`.

## Proof verification and replay

Issuer and JWKS URL are pinned to `https://token.actions.githubusercontent.com`
and `/.well-known/jwks`. RS256 only; bounded nonempty `kid`; no token-supplied
key/discovery URL. Pinned `coreos/go-oidc/v3` v3.21.0 and `go-jose/v4` v4.1.4
verify issuer, signature and expiry. Because policies can have different
audiences, exactly one audience is checked against the matched SQLite rule
before signing. No audience membership or wildcard grants are accepted.

Require well-typed `exp`, `iat`, `nbf`, `jti`, nonempty bounded `sub` and numeric
bounded run/attempt IDs. No already-expired proof is accepted, including at
atomic consumption. Future issuance/not-before allowance is 30 seconds; proof
age maximum ten minutes and lifetime maximum twenty minutes. Hosted and reusable
workflow claims fail closed. Qualify real GitHub claim shapes/time bounds before
rollout without logging the proof. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

JWKS fetches: two-second HTTPS timeout, no redirects, 256 KiB response, at most
sixteen RSA signing keys, serialized refresh, ten-minute freshness and at most
one fetch attempt per minute (including failures/unknown-key floods). Matching
fresh keys work offline; stale keys cannot authorize. Four concurrent exchanges
and sixty starts per minute process-wide bound verifier work.

Atomically consume proof `jti` under the fixed issuer until expiry, before
signing, in a bounded 4,096-entry map shared by all workloads/audiences. Concurrent
replay returns `409`; expired entries are pruned and a full map fails closed.
If the response is lost, obtain a fresh proof. Restart invalidates leases but
forgets consumed proofs, so a still-valid captured proof can be re-exchanged.
A compromised approved job can request fresh proofs. Durable replay, one lease
per run and total spending caps remain separate extensions.

## GitHub Connect security and storage

The GitHub App OAuth flow uses PKCE S256, ten-minute single-use state, an HttpOnly
Secure SameSite cookie, and the authenticated company admin. State and callbacks
are bound to settings revisions and persistent operation generations. A
connection change supersedes in-flight callbacks and repository selection;
stale disconnect/update revisions return `412`. API access requires an unscoped
admin identity, never a CI lease or subscription access key. Mutations require
same-origin JSON.

GitHub client secrets, user access tokens and PKCE verifiers are AES-GCM encrypted
with separate purpose/member binding. The key is derived from the existing
private signing key with a distinct purpose. Back up the private config and
SQLite together. Signing-key rotation requires reentering the GitHub client
secret and reconnecting accounts; no encrypted credentials are exported to UI
responses or logs. App user tokens expire after eight hours; no refresh token is
stored. GitHub HTTP uses fixed service endpoints, no redirects, eight-second
request timeouts, two MiB response bounds, explicit pagination limits and a
fifteen-second overall repository lookup deadline.

SQLite schema 4 adds workload policies/import metadata/audit and GitHub settings,
connections, OAuth state/generations/audit tables. AI provider tokens remain in
CLIProxyAPI. The old single `github_oidc` private-config policy is imported once,
with a durable marker and deletion tombstones; a deleted policy is never
resurrected by restart. Legacy config is bootstrap compatibility, not live
policy authority. New UI policies need no private-config member entries.

## Runner helper

Release packages include the helper; build independently for a runner with:

```sh
go build -trimpath -o company-gateway-ci ./cmd/company-gateway-ci
```

It uses the runner's `ACTIONS_ID_TOKEN_REQUEST_URL` / token and URL-encoded
`COMPANY_GATEWAY_AUDIENCE` to obtain a proof, exchanges it, and starts the command.
Proof/lease stay in memory and are masked with GitHub workflow commands before
output. Bounded HTTPS requests prohibit redirects/URL credentials and avoid
secrets in argv/files. The child receives `OPENAI_API_KEY=<lease>` and
`OPENAI_BASE_URL=<gateway>/v1`; GitHub proof-request variables are removed.
Approved job code still has its own GitHub privileges. No long-lived fallback,
automatic renewal, job outputs or token artifacts are created.

The helper forwards termination signals, preserves the child's exit status and
best-effort revokes on exit through `DELETE /api/leases/{id}` using its own lease.
Hard expiry handles killed/cancelled runners.

```yaml
name: agent-review
on:
  workflow_dispatch:
jobs:
  review:
    runs-on: [self-hosted, linux, tailnet]
    environment: agent-ci
    timeout-minutes: 12
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Bounded agent review
        env:
          COMPANY_GATEWAY_URL: ${{ vars.COMPANY_GATEWAY_URL }}
          COMPANY_GATEWAY_AUDIENCE: company-gateway-ci
        run: company-gateway-ci run -- agent-review-command
```

## Validation

Tests use generated RSA keys, synthetic private SQLite/state, fake clocks,
local TLS GitHub/JWKS APIs and mocked company browser boundaries. They cover
exact multi-repository policies/models/audiences; all identity/time/replay/key
bounds; migration atomicity/legacy import/deletion; revision races; native stream
cancellation; admin isolation; OAuth PKCE/cookie/member/state/reconnect races;
encryption, HTTP bounds and secret-free UI persistence. Both Go modules,
Playwright company pages and real native SDK adapter fixtures remain required.
No automated test obtains a real GitHub proof, spends live provider quota or
modifies a remote service.
