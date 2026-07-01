/**
 * Rendered in production when NEXT_PUBLIC_API_URL is not configured (#222).
 * Provides a clear, actionable error instead of a confusing connection failure.
 */
export function ConfigErrorPage() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-screen flex items-center justify-center bg-slate-50 px-4"
    >
      <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-4">
          <span
            aria-hidden="true"
            className="text-5xl"
          >
            ⚙️
          </span>
        </div>
        <h1 className="text-xl font-semibold text-slate-800 mb-2">
          Configuration Error
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          The dashboard is missing a required environment variable. This
          deployment cannot connect to the CareGuard agent.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left mb-6">
          <p className="text-xs font-mono font-semibold text-red-700 mb-1">
            Missing environment variable:
          </p>
          <code className="text-sm text-red-800 break-all">
            NEXT_PUBLIC_API_URL
          </code>
        </div>

        <p className="text-sm text-slate-600 mb-2">
          Add this to your deployment environment or{" "}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
            dashboard/.env.local
          </code>{" "}
          file:
        </p>
        <pre className="bg-slate-800 text-green-400 text-xs rounded-lg px-4 py-3 text-left overflow-x-auto mb-6">
          {"NEXT_PUBLIC_API_URL=https://your-agent-host.example.com"}
        </pre>

        <p className="text-xs text-slate-400">
          See{" "}
          <code className="bg-slate-100 px-1 py-0.5 rounded">
            dashboard/.env.example
          </code>{" "}
          for all required environment variables.
        </p>
      </div>
    </div>
  );
}
