/**
 * Chaos test: Sentry beforeSend must fail closed when redaction throws (Issue #980).
 *
 * docs/observability/sentry.md promises that a thrown redact() drops the event
 * entirely instead of risking an unredacted payload reaching the transport.
 * This test forces the failure on a documented redaction target (event.request,
 * and separately a breadcrumb's data) and observes what would be transported.
 */

const { sentryMock, redactMock } = vi.hoisted(() => {
  const state: { sent: any[]; beforeSend?: (event: any, hint: any) => any } = {
    sent: [],
  };

  return {
    state,
    sentryMock: {
      state,
      init: vi.fn((options: any) => {
        state.beforeSend = options.beforeSend;
      }),
      // Simulate the SDK pipeline: captureException builds an event, runs
      // beforeSend, and only hands a non-null event to the transport.
      captureException: vi.fn((err: unknown) => {
        const event = {
          exception: { values: [{ value: String(err) }] },
          request: {
            headers: { authorization: "Bearer super-secret-token" },
            data: { AGENT_SECRET_KEY: "S-SHOULD-NEVER-LEAVE-THE-PROCESS" },
          },
          extra: { note: "unredacted extra" },
          breadcrumbs: [{ message: "before_send", data: { task: "secret task" } }],
        };
        const processed = state.beforeSend ? state.beforeSend(event, {}) : event;
        if (processed !== null && processed !== undefined) {
          state.sent.push(processed);
        }
      }),
      requestDataIntegration: vi.fn(() => ({ name: "mock-request-data" })),
      expressIntegration: vi.fn(() => ({ name: "mock-express" })),
    },
    redactMock: vi.fn((value: any) => value),
  };
});

vi.mock("@sentry/node", () => sentryMock);
vi.mock("../redact.ts", () => ({ redact: redactMock }));
vi.mock("dotenv/config", () => ({}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initSentry } from "../sentry.ts";

const ORIGINAL_DSN = process.env.SENTRY_DSN;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("Sentry beforeSend fail-closed chaos (Issue #980)", () => {
  let beforeSend: (event: any, hint: any) => any;
  let handle: Awaited<ReturnType<typeof initSentry>>;

  beforeEach(async () => {
    process.env.SENTRY_DSN = "https://public@example.test/1";
    process.env.NODE_ENV = "test";

    sentryMock.init.mockClear();
    sentryMock.captureException.mockClear();
    sentryMock.state.sent.length = 0;
    sentryMock.state.beforeSend = undefined;
    redactMock.mockReset();
    redactMock.mockImplementation((value: any) => value);

    handle = await initSentry({ service: "sentry-fail-closed-chaos" });
    expect(handle.enabled).toBe(true);
    expect(sentryMock.init).toHaveBeenCalledTimes(1);

    beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
    expect(typeof beforeSend).toBe("function");
  });

  afterEach(() => {
    if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = ORIGINAL_DSN;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("drops the event when redact() throws while processing event.request", () => {
    redactMock.mockImplementation(() => {
      throw new Error("redact() exploded on event.request");
    });

    const event = {
      request: {
        headers: { authorization: "Bearer super-secret-token" },
        data: { AGENT_SECRET_KEY: "S-SHOULD-NEVER-LEAVE" },
      },
    };

    expect(beforeSend(event, {})).toBeNull();
    expect(redactMock).toHaveBeenCalledWith(event.request);
  });

  it("no unredacted payload reaches the transport when redaction throws", () => {
    redactMock.mockImplementation(() => {
      throw new Error("redact() exploded");
    });

    // Drive the real capture path from the initialized handle.
    handle.captureException(new Error("captured failure"));

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.state.sent).toHaveLength(0);
  });

  it("also fails closed when a breadcrumb's data redaction throws", () => {
    const breadcrumbData = { task: "secret task" };
    redactMock.mockImplementation((value: any) => {
      if (value === breadcrumbData) throw new Error("redact() exploded on breadcrumb");
      return value;
    });

    const event = {
      request: { headers: {} },
      breadcrumbs: [{ message: "payment", data: breadcrumbData }],
    };

    expect(beforeSend(event, {})).toBeNull();
    expect(redactMock).toHaveBeenCalledWith(breadcrumbData);
  });

  it("still returns the (redacted) event when redaction succeeds", () => {
    const event = {
      request: { headers: { authorization: "Bearer super-secret-token" } },
    };

    const result = beforeSend(event, {});

    expect(result).toBe(event);
    expect(result).not.toBeNull();
  });
});
