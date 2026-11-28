# CSP connect-src omission drill

## Purpose

Rehearse review of a provider addition where the outbound call is introduced but
`shared/security-middleware.ts` is accidentally left unchanged. The origin below
is reserved for documentation and is not a real service.

## Staged change

The simulated PR adds this call in `services/example-provider.ts`:

```ts
export async function checkExampleProvider() {
  return fetch("https://api.new-provider.invalid/v1/status");
}
```

The PR deliberately has no corresponding change to `connectSrc` in
`shared/security-middleware.ts`. Its proposed diff is therefore the call above
only; the middleware still allows `'self'`, the Stellar origins,
`https://channels.openzeppelin.com`, and `https://api.groq.com`.

## Findings

### Existing unit test: detection gap confirmed by inspection

`shared/__tests__/security-middleware.test.ts` asserts that the response CSP
contains `default-src 'self'` and the three current fixed origins. It does not
inspect outbound call sites or assert that every provider origin is represented
in `connect-src`. The simulated `api.new-provider.invalid` origin is absent from
those assertions, so this test has no assertion that would fail for this
specific omission. The test was not executable in this checkout because the
Vitest binary is not installed (`npm test -- shared/__tests__/security-middleware.test.ts`
returned `vitest: not found`).

### Production curl check: visible in output, not an automatic failure

The runbook command retrieves and prints the deployed CSP header:

```bash
curl -sI https://your-app.onrender.com/ | grep -i content-security-policy
```

With the staged omission deployed, the output would still show a successful
header containing the current origins and no `https://api.new-provider.invalid`.
That makes the missing entry observable during a deliberate comparison, but the
command itself exits successfully whenever a CSP header exists; it does not
know which origin the reviewer expected. This is a post-deploy signal, not a
pre-deploy safeguard.

## Recommendation

Add a pre-deploy CI check that extracts literal external origins from browser
outbound-call configuration and verifies each is present in the effective
`connect-src` origin set (including origins provided by
`getStellarCspOrigins()`). Fail with the missing origin and source file. This
would make the simulated provider-only diff fail before deployment, while the
existing unit test continues checking that middleware emits a CSP header.

Until that check exists, PR review should compare each new browser call's origin
with the connect-src allowlist. A URL listed only in this drill is illustrative;
it should not be added to production configuration.
