# GitHub Actions OIDC: one reviewed workflow, one short CI lease

Status: proposed, 5 October 2026. **OIDC is not implemented.** Start with one
`workflow_dispatch` job on an existing self-hosted tailnet runner, one repository
and one configured `kind: ci` principal. Add an exchange endpoint and a small
runner helper; reuse the gateway's existing leases and model authorization.

## Initial scope

The job obtains a GitHub-signed identity proof, exchanges it for a 15-minute
gateway lease, and runs its command with that lease. No long-lived gateway
credential belongs in the job environment. The runner is already enrolled in
Tailscale, so this version needs no Tailscale action, public ingress or new node.
A tailnet network grant only reaches the gateway HTTPS listener; it does not
identify the job or grant model access.

The CI principal has one approved model, `allow_shared: true`, concurrency one
and no operator access. It consumes only explicitly permitted shared accounts;
SQLite account ownership and provider credentials in CLIProxyAPI stay
unchanged. Concurrent requests across all leases for this principal still share
its concurrency limit and the gateway's global CI reservation. This limits
concurrency, not total tokens or spending.

Trust the reviewed workflow, not arbitrary repository content. Initially permit
only manual dispatch from `refs/heads/main`, using a protected `agent-ci`
environment. Protect changes to the workflow. Do not execute PR-controlled code
on this runner. Workflow identity does not distinguish a YAML job name: only the
one reviewed job receives `id-token: write` and the protected environment. A
matching environment claim does not establish which reviewer rules GitHub used;
those rules must be configured and checked separately.

## Exchange and private configuration

Add `POST /api/v1/workload-exchanges` to the tailnet-only public listener **before
ordinary authentication and `/api/v1/` dispatch** in `Server.handle`. This is the
only unauthenticated identity-exchange route, and is unavailable when the new
configuration is absent. It accepts JSON only, rejects unknown fields/trailing
JSON, limits the body to 32 KiB and allows no issuer, principal or scope supplied
by the caller:

```json
{"provider":"github_oidc","id_token":"<GitHub JWT>"}
```

Return `201` with the existing `{token,id,expires_at}` lease response and
`Cache-Control: no-store`. `expires_at` is Unix seconds. Issue the existing
HMAC-signed `kind: lease` grant for the mapped principal, using the current
process epoch and exactly 900 seconds of lifetime. Clients treat the token as
opaque; it is not a new GitHub access token. Reuse the signer, authentication,
revocation and stream deadline handling. A valid proof can expire before the
lease; the lease still has its independent hard deadline.

One optional private configuration object describes exactly one workload:

```json
{
  "github_oidc": {
    "audience": "company-gateway-ci",
    "repository_owner_id": "123456",
    "repository_id": "456789",
    "workflow_ref": "example-org/example-repo/.github/workflows/agent-review.yml@refs/heads/main",
    "ref": "refs/heads/main",
    "event_name": "workflow_dispatch",
    "environment": "agent-ci",
    "principal_id": "ci-review"
  }
}
```

These are illustrative values, not deployment configuration. Validate every
field, require exactly the initial ref/event, and resolve `principal_id` to an
enabled configured CI principal with positive global CI capacity. Add `auth_mode: "github_oidc"` to `Member`:
that mode requires `kind: ci`, no `token_sha256`, no `tailscale_login`, no
operator flag, and the matching workload configuration. Other members retain
today's validation. Currently `Config.Validate` rejects any credentialless
principal, so simply adding a rule is insufficient. Use `memberByID` again at
exchange time and on lease authentication; never create a human principal from
GitHub claims. Policy changes use the existing service restart flow.

## Verification and replay protection

Pin issuer `https://token.actions.githubusercontent.com` and JWKS URL
`https://token.actions.githubusercontent.com/.well-known/jwks` in code. Require
RS256, a bounded nonempty `kid`, valid signature, exact issuer and exactly one
configured audience. Ignore token-supplied key/discovery URLs. GitHub currently
advertises these endpoints and RS256 in its [discovery
metadata](https://token.actions.githubusercontent.com/.well-known/openid-configuration).

Require well-typed `exp`, `iat`, `nbf`, `jti` and nonempty `sub`. Reject expiration,
future use/issuance beyond 30 seconds, proofs older than ten minutes and
lifetimes over twenty minutes. Never accept an already expired proof through a
skew allowance. Qualify the age/lifetime bounds with a real job before rollout.
Use a reviewed, pinned `coreos/go-oidc/v3` version, with ordinary issuer,
audience and expiry checks enabled plus these stricter checks: its [verifier
source](https://github.com/coreos/go-oidc/blob/v3/oidc/verify.go) accepts audience
membership and a five-minute not-before allowance by default.

After signature verification, match every configured claim exactly: immutable
owner/repository IDs, workflow ref, git ref, event and environment. Do not
identify the workload by actor, repository display name or parsing `sub`. Also
require `runner_environment: self-hosted` in this first version and bounded
`run_id`/`run_attempt` for audit. Reject reusable-workflow claims initially;
caller/called workflow policy is a separate extension. GitHub documents these
claims and custom audiences in its [OIDC
reference](https://docs.github.com/en/actions/reference/security/oidc).

Keep verifier work bounded: two-second HTTPS timeout, no redirects, 256 KiB JWKS
response, at most sixteen signing keys, single-flight refresh, ten-minute key
freshness, and at most one forced refresh per minute for an unknown key. A
fresh cached matching key can verify without network I/O; without one, refresh
failure returns `503` and issues no lease. Limit verification concurrency to
four and exchange starts to sixty per minute process-wide. These are server
constants, not an initial configuration surface. The library's [key-set
source](https://github.com/coreos/go-oidc/blob/v3/oidc/jwks.go) supplies caching
and concurrent-fetch suppression; enforce the remaining bounds in its adapter.

After all checks, atomically consume `(issuer,jti)` until proof expiry **before
signing**. Use a bounded in-memory map of 4,096 entries, prune expired entries
and fail closed when full. Concurrent reuse returns `409 proof_already_used`.
If a successful response is lost, obtain a fresh proof rather than store lease
tokens for idempotency. This is deliberately single-process replay control:
restart invalidates issued leases but forgets consumed proofs, so a captured
still-valid proof can be exchanged again after restart. An approved compromised
job can also request fresh proofs. Durable replay storage, one lease per run
and spending caps are outside this first version.

## Runner helper and workflow

Add a small Go command, `company-gateway-ci run -- <command> [args...]`, built
and installed through the repository's normal release process. It reads
`COMPANY_GATEWAY_URL` and `COMPANY_GATEWAY_AUDIENCE`, obtains the GitHub proof
using `ACTIONS_ID_TOKEN_REQUEST_URL`/`ACTIONS_ID_TOKEN_REQUEST_TOKEN` with a
URL-encoded custom audience, exchanges it, and starts the requested child.
GitHub documents this token-request mechanism and job-scoped permissions in its
[OIDC setup guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers).

Keep proof and lease in memory; mask both through GitHub's `add-mask` workflow
command before any diagnostic output. Use HTTP library headers/bodies, never
shell commands or token-bearing argv/files. Use the runner-provided HTTPS token-request URL; it is distinct from the
issuer/JWKS URL pinned by the gateway. Reject URL credentials/fragments, verify
gateway HTTPS and prohibit redirects for both requests. Set an explicit request
timeout and response bound. The child receives `OPENAI_API_KEY=<lease>` and
`OPENAI_BASE_URL=<gateway>/v1`; initially use an OpenAI-compatible client for the
one approved model. Remove the GitHub token-request variables from the child's
environment, and do not publish the lease through job outputs or artifacts.
This reduces accidental exposure; approved workflow code still has its own
GitHub token-request privileges.

The helper forwards termination signals, preserves the child's exit code, and
best-effort revokes on exit using `DELETE /api/leases/{id}`, the lease as bearer
and `{token:<lease>}` as JSON. Current authentication permits this self-revocation;
no bootstrap credential is needed. Expiry handles killed/cancelled runners.
There is no automatic renewal. Reject malformed exchange responses and abort if
exchange fails; do not fall back to a long-lived credential.

Illustrative workflow, **not executable with today's gateway/helper**:

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

## Implementation and acceptance

1. Add configuration validation, bounded verifier/key adapter and consumed-proof
   map. Reuse the existing lease grant and enabled-principal lookup.
2. Add the exchange route. Errors are `400 invalid_exchange`, `401
   invalid_identity_proof`, `403 workload_not_allowed`, `409 proof_already_used`,
   `429 exchange_limited` and `503 identity_verifier_unavailable`. Audit only
   principal, verified repository/run/attempt IDs, lease ID/expiry and outcome;
   never JWTs, headers, tokens or arbitrary claim dumps.
3. Add the helper and fake end-to-end job fixture. Run required repository
   checks, then a separately authorized, bounded real workflow canary.

Automated tests use generated RSA keys, local fake JWKS, fake clocks and private
temporary state. Cover valid identity; wrong/missing issuer, audience, algorithm,
signature and claims; every workload mismatch; rejected hosted/reusable/PR jobs;
key rotation, redirects, timeout, response limits and unknown-key floods;
concurrent replay, replay-map exhaustion and documented restart behavior.
Verify helper masking, child environment, signal/exit forwarding, self-revocation
and absence of token-bearing argv/logs. Existing lease tests must still prove
no lease chaining, forbidden-model denial, member/management isolation,
expiry/revocation stream cancellation and aggregate CI admission across leases.
No automated test obtains a real GitHub proof, uses provider quota or modifies a
remote service.

Before rollout, supply the actual immutable repository IDs, approved workflow,
protected environment, CI principal/model and installed command. Verify GitHub
claim shapes/time bounds without logging the proof, then remove any old
bootstrap credential from that job's environment. These are deployment choices,
not reasons to expand the implementation.

Later additions are independent: more allowlisted workloads/events, longer-job
renewal, reusable workflows with exact caller and `job_workflow_ref`/SHA checks,
or hosted runners with separately configured Tailscale federation. Hosted
network enrollment and gateway identity exchange require separate audiences.
No federation registry, general OAuth server, new database, policy UI or hosted
runner enrollment is required to ship the first version.
