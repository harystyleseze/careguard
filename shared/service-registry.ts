/**
 * Service Discovery Registry
 *
 * Centralizes service name-to-URL resolution with typed access and default ports.
 * Replaces ad hoc *_API_URL env vars scattered across agent/tools.ts with a single
 * source of truth for service endpoints.
 *
 * Trade-off: One layer of indirection for env reads, but easier to add new services
 * and maintain consistency across deploy configs (render.yaml, docker-compose.yml).
 */

export type ServiceName =
  | "pharmacy-api"
  | "bill-audit-api"
  | "drug-interaction-api"
  | "pharmacy-payment-api";

interface ServiceConfig {
  envVar: string;
  defaultUrl: string;
  defaultPort: number;
}

const SERVICE_CONFIGS: Record<ServiceName, ServiceConfig> = {
  "pharmacy-api": {
    envVar: "PHARMACY_API_URL",
    defaultUrl: "http://localhost:3001",
    defaultPort: 3001,
  },
  "bill-audit-api": {
    envVar: "BILL_AUDIT_API_URL",
    defaultUrl: "http://localhost:3002",
    defaultPort: 3002,
  },
  "drug-interaction-api": {
    envVar: "DRUG_INTERACTION_API_URL",
    defaultUrl: "http://localhost:3003",
    defaultPort: 3003,
  },
  "pharmacy-payment-api": {
    envVar: "PHARMACY_PAYMENT_API_URL",
    defaultUrl: "http://localhost:3005",
    defaultPort: 3005,
  },
};

/**
 * Resolve a service URL from environment or fall back to default.
 *
 * @param name - Service identifier
 * @returns Full URL for the service (e.g. "http://localhost:3001")
 */
export function getServiceUrl(name: ServiceName): string {
  const config = SERVICE_CONFIGS[name];
  return process.env[config.envVar] || config.defaultUrl;
}

/**
 * Get the default port for a service (useful for docker-compose port mappings).
 *
 * @param name - Service identifier
 * @returns Default port number
 */
export function getServicePort(name: ServiceName): number {
  return SERVICE_CONFIGS[name].defaultPort;
}

/**
 * Get all registered services (for validation or documentation).
 *
 * @returns Array of service names
 */
export function getAllServices(): ServiceName[] {
  return Object.keys(SERVICE_CONFIGS) as ServiceName[];
}

/**
 * Validate that all required service URLs are either set in env or have defaults.
 * Useful for startup validation in production deployments.
 *
 * @returns Object mapping service name to resolved URL
 */
export function validateServiceConfig(): Record<ServiceName, string> {
  const resolved: Record<string, string> = {};
  for (const name of getAllServices()) {
    resolved[name] = getServiceUrl(name);
  }
  return resolved as Record<ServiceName, string>;
}
