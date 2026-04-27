export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500 animate-pulse flex items-center justify-center text-white font-bold text-sm">CG</div>
            <div>
              <div className="h-5 w-24 bg-slate-200 rounded animate-pulse mb-1"></div>
              <div className="h-3 w-32 bg-slate-100 rounded animate-pulse"></div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <nav className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-slate-200 w-fit">
          {["Overview", "Medications", "Bills", "Policy", "Wallet", "Activity", "Settings"].map((tab) => (
            <div key={tab} className="px-4 py-2 rounded-md text-sm font-medium text-slate-300 animate-pulse">
              {tab}
            </div>
          ))}
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="h-3 w-20 bg-slate-100 rounded animate-pulse mb-2"></div>
              <div className="h-6 w-16 bg-slate-200 rounded animate-pulse"></div>
              <div className="h-3 w-24 bg-slate-100 rounded animate-pulse mt-1"></div>
            </div>
          ))}
        </div>

        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
          <div className="h-4 w-32 bg-slate-100 rounded animate-pulse mb-4"></div>
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 bg-slate-50 rounded-lg">
                <div className="h-4 w-full bg-slate-200 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
          <div className="h-4 w-28 bg-slate-100 rounded animate-pulse mb-4"></div>
          <div className="flex gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1 p-4 bg-slate-50 rounded-lg">
                <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-full bg-slate-100 rounded animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}