import { describe, expect, it } from "vitest";
import { buildCspDirectives, buildSecurityHeaders } from "../../next.config";

function headerMap(headers: Array<{ key: string; value: string }>) {
  return Object.fromEntries(headers.map((header) => [header.key, header.value]));
}

describe("dashboard security headers (#94)", () => {
  it("builds an enforcing CSP with Stellar and agent connect origins", () => {
    const csp = buildCspDirectives("https://api.careguard.example/v1");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("https://horizon-testnet.stellar.org");
    expect(csp).toContain("https://stellar.expert");
    expect(csp).toContain("https://api.careguard.example");
    expect(csp).not.toContain("https://example.com");
  });

  it("falls back to the local agent origin when NEXT_PUBLIC_API_URL is unset", () => {
    const csp = buildCspDirectives(undefined);

    expect(csp).toContain("http://localhost:3004");
  });

  it("adds HSTS only in production", () => {
    const prodHeaders = headerMap(buildSecurityHeaders("production"));
    const devHeaders = headerMap(buildSecurityHeaders("development"));

    expect(prodHeaders["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(devHeaders["Strict-Transport-Security"]).toBeUndefined();
  });

  it("sets the expected browser hardening headers", () => {
    const headers = headerMap(buildSecurityHeaders("production"));

    expect(headers["Content-Security-Policy"]).toContain("connect-src");
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });
});
