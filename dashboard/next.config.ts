const DEFAULT_AGENT_ORIGIN = "http://localhost:3004";
type SecurityHeader = { key: string; value: string };
type DashboardNextConfig = {
  output: "standalone";
  headers(): Promise<Array<{ source: string; headers: SecurityHeader[] }>>;
};

function originFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function buildCspDirectives(agentUrl = process.env.NEXT_PUBLIC_API_URL) {
  const agentOrigin = originFromUrl(agentUrl) ?? DEFAULT_AGENT_ORIGIN;
  const connectSrc = [
    "'self'",
    "https://horizon-testnet.stellar.org",
    "https://stellar.expert",
    agentOrigin,
  ].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `connect-src ${connectSrc}`,
    "img-src 'self' data: blob: https://*.amazonaws.com https://*.minio.io",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
  ].join("; ");
}

export function buildSecurityHeaders(
  nodeEnv = process.env.NODE_ENV,
  agentUrl = process.env.NEXT_PUBLIC_API_URL,
): SecurityHeader[] {
  const headers = [
    { key: "Content-Security-Policy", value: buildCspDirectives(agentUrl) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];

  if (nodeEnv === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}

const nextConfig: DashboardNextConfig = {
  // Self-contained output for Docker (issue #111). `next build` produces
  // .next/standalone/ with a minimal server.js. The dev server is unaffected.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
