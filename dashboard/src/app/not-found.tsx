import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-slate-400">404</span>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Page Not Found</h2>
        <p className="text-sm text-slate-600 mb-6">
          We couldn't find that page — no harm done. Your care
          recipient's dashboard is safe and unchanged. Head back to pick up
          right where you left off.
        </p>
        <Link
          href="/"
          className="inline-block w-full py-2 px-4 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600 active:bg-sky-700 transition-all cursor-pointer"
        >
          Go to Dashboard
        </Link>
        <p className="mt-3 text-xs text-slate-500">
          Looking for something recent?{" "}
          <Link
            href="/?tab=activity"
            className="text-sky-600 hover:text-sky-700 hover:underline active:text-sky-800 cursor-pointer"
          >
            Open the Activity log
          </Link>
        </p>
      </div>
    </div>
  );
}
