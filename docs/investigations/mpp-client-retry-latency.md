# Investigation: `agent/mpp-client.ts` retry/latency overhead (#1308)

## Question

Does `agent/mpp-client.ts`'s retry logic affect total latency/throughput when
the downstream pharmacy-payment service is slow or intermittently failing?

## Finding 1 — `mpp-client.ts` has no retry logic of its own

`createMppClient` (`agent/mpp-client.ts`) is a thin factory around
`Mppx.create()` (from the `mppx` package), configured with `stellarCharge`
(from `@stellar/mpp/charge/client`) as its only payment method. It doesn't
implement, configure, or override any retry/backoff behavior itself.

## Finding 2 — retries live in `mppx`, scoped to 402 payment-challenge renegotiation only

All retry behavior comes from `mppx`'s `Fetch.from()` client wrapper
(`node_modules/mppx/dist/client/internal/Fetch.js`):

```js
const defaultMaxPaymentRetries = 3;
...
for (let retry = 0; retry < maxPaymentRetries; retry++) { ... }
```

- `createMppClient` never overrides `maxPaymentRetries`, so every MPP client
  in this codebase runs with the library default of **3**.
- The loop has **no backoff or delay** between attempts — no `setTimeout` or
  equivalent appears anywhere in it.
- Critically, this loop only engages when the downstream response is
  `402 Payment Required` (`transport.isPaymentRequired(response)`). A
  generic failure — `500`, a timeout, a dropped connection — is **not** a
  402 response, so the loop is bypassed entirely and the failure (or thrown
  exception) propagates on the very first attempt. **There is no
  retry/backoff protection against a slow-but-failing pharmacy-payment
  service outside of the payment-challenge path.**

## Finding 3 — a separate, unrelated backoff exists downstream of this, for transaction *confirmation*

`@stellar/mpp`'s `dist/shared/poll.js` implements real exponential backoff
with jitter, but for polling Stellar transaction confirmation *after* a
payment has already been submitted — not for the initial pharmacy-payment
request:

```js
export const DEFAULT_POLL_MAX_ATTEMPTS = 30;
export const DEFAULT_POLL_DELAY_MS = 1_000;
export const DEFAULT_POLL_BACKOFF_MULTIPLIER = 1.2;
export const DEFAULT_POLL_JITTER_MS = 200;
export const DEFAULT_POLL_TIMEOUT_MS = 30_000;
```

This is a different mechanism, downstream of the pharmacy-payment request
itself, and doesn't affect the latency question this issue asks about.

## Measured impact

`agent/__tests__/mpp-client-retry-latency.bench.test.ts` drives `mppx`'s
actual `Fetch.from()` retry loop (not a reimplementation) against a
controllable fake downstream, via the `Transport.from()` / `Method.from()`
seams `mppx` exposes for exactly this kind of testing:

| Condition | Downstream calls | Latency | Backoff between calls |
|---|---|---|---|
| Normal (non-402) response | 1 | ~1× downstream delay | n/a |
| Slow payment flow (402 challenge → paid retry) | 2 | ~2× downstream delay, **additive** | none |
| Downstream failing (500/timeout, non-402) | 1 | ~1× downstream delay | n/a — no retry at all |

So: a slow-but-eventually-payable downstream compounds latency additively
(no amortization, no backoff), and a downstream that's actually *failing*
gets zero retry protection from this layer.

## Recommendation

1. **No backoff currently exists in the payment-challenge retry path.** If
   pharmacy-payment returns transient 402s under load, `mpp-client.ts`
   currently hits it 3× back-to-back with no delay, which could add load to
   an already-struggling service rather than relieving it. If backoff here
   is wanted, it would need to be added by wrapping the `fetch` passed into
   `Mppx.create()` before it reaches `mppx`'s own retry loop — the installed
   `mppx` version (0.9.1) doesn't expose a backoff option on
   `maxPaymentRetries` itself.
2. **Generic downstream failures get no retry at all.** If pharmacy-payment
   is expected to fail intermittently (vs. issuing 402 challenges), and
   resilience to that is wanted, it needs to be added explicitly — e.g. a
   small retry-with-backoff wrapper around the `fetch` passed into
   `Mppx.create()`, distinct from and layered outside `mppx`'s existing
   402-scoped retries.
3. Both of the above are genuine behavior changes to the payment path and
   need a decision on acceptable latency budget / retry policy for the
   pharmacy-payment integration specifically — scoped here as a
   recommendation rather than an unreviewed change to production payment
   retry behavior.
