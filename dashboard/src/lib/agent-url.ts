const DEFAULT_AGENT_URL = "http://localhost:3004";
const REQUIRED_ENV_NAME = "NEXT_PUBLIC_API_URL";

export type AgentUrlConfig =
  | {
      agentUrl: string;
      missingRequiredEnv: false;
      warning?: string;
    }
  | {
      agentUrl: null;
      missingRequiredEnv: true;
      envName: typeof REQUIRED_ENV_NAME;
      message: string;
    };

export function resolveAgentUrl(
  env = process.env.NODE_ENV,
  configuredUrl = process.env.NEXT_PUBLIC_API_URL,
  logger: Pick<Console, "warn"> = console,
): AgentUrlConfig {
  const trimmedUrl = configuredUrl?.trim();
  if (trimmedUrl) {
    return { agentUrl: trimmedUrl, missingRequiredEnv: false };
  }

  if (env === "production") {
    return {
      agentUrl: null,
      missingRequiredEnv: true,
      envName: REQUIRED_ENV_NAME,
      message:
        "CareGuard dashboard is missing NEXT_PUBLIC_API_URL. Set it to the deployed CareGuard API base URL before using this production build.",
    };
  }

  const warning = `${REQUIRED_ENV_NAME} is not set; using ${DEFAULT_AGENT_URL} for local development.`;
  logger.warn(warning);

  return {
    agentUrl: DEFAULT_AGENT_URL,
    missingRequiredEnv: false,
    warning,
  };
}

export const agentUrlConfig = resolveAgentUrl();
