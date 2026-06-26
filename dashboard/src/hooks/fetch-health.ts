export interface FetchSourceHealth {
  id: string;
  label: string;
  error: string | null;
  lastSuccessAt: number | null;
}

export interface FetchHealthSummary {
  ok: boolean;
  label: string;
  title: string;
  failingSources: FetchSourceHealth[];
}

export function getFetchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown error";
}

export function buildFetchHealthSummary(
  sources: FetchSourceHealth[],
): FetchHealthSummary {
  const failingSources = sources.filter((source) => source.error);

  if (failingSources.length === 0) {
    return {
      ok: true,
      label: "Data healthy",
      title: "Agent info, spending, and transactions are updating.",
      failingSources,
    };
  }

  return {
    ok: false,
    label: "Data issue",
    title: failingSources
      .map((source) => `${source.label}: ${source.error}`)
      .join("\n"),
    failingSources,
  };
}
