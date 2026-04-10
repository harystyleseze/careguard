"use client";

import { useState, useEffect, useCallback } from "react";
import { downloadBillAuditPDF, downloadMedicationPDF, downloadTransactionPDF } from "./pdf";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

interface Transaction {
  id: string;
  timestamp: string;
  type: "medication" | "bill" | "service_fee";
  description: string;
  amount: number;
  recipient: string;
  stellarTxHash?: string;
  status: string;
  category: string;
}

interface SpendingData {
  policy: {
    dailyLimit: number;
    monthlyLimit: number;
    medicationMonthlyBudget: number;
    billMonthlyBudget: number;
    approvalThreshold: number;
  };
  spending: {
    medications: number;
    bills: number;
    serviceFees: number;
    total: number;
  };
  budgetRemaining: {
    medications: number;
    bills: number;
  };
  transactionCount: number;
  recentTransactions: Transaction[];
}

interface AgentResult {
  response: string;
  toolCalls: Array<{ tool: string; input: any; result: any }>;
  spending: SpendingData;
}

interface AgentInfo {
  service: string;
  agentWallet: string;
  llm: string;
  network: string;
}

export default function Dashboard() {
  const [spending, setSpending] = useState<SpendingData | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTask, setActiveTask] = useState("");
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "medications" | "bills" | "policy" | "activity" | "wallet" | "settings">("overview");
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [billShowErrorsOnly, setBillShowErrorsOnly] = useState(false);
  const [walletXlm, setWalletXlm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const [policyForm, setPolicyForm] = useState({
    dailyLimit: 100,
    monthlyLimit: 500,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
  });

  const fetchAgentInfo = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/`);
      if (res.ok) {
        const data = await res.json();
        setAgentInfo(data);
        setAgentConnected(true);
        setAgentPaused(data.paused || false);
        // Fetch wallet balance from Horizon
        if (data.agentWallet) {
          try {
            const hres = await fetch(`https://horizon-testnet.stellar.org/accounts/${data.agentWallet}`);
            if (hres.ok) {
              const acc = await hres.json();
              const usdc = acc.balances?.find((b: any) => b.asset_code === "USDC");
              const xlm = acc.balances?.find((b: any) => b.asset_type === "native");
              setWalletBalance(usdc ? parseFloat(usdc.balance).toFixed(2) : "0.00");
              setWalletXlm(xlm ? parseFloat(xlm.balance).toFixed(2) : "0.00");
            }
          } catch {}
        }
      }
    } catch { setAgentConnected(false); }
  }, []);

  const fetchSpending = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/spending`);
      if (res.ok) {
        const data = await res.json();
        setSpending(data);
        // Only sync policy form from server when NOT on the Policy tab
        // (prevents overwriting user's in-progress edits every 3 seconds)
        if (activeTab !== "policy") {
          setPolicyForm(data.policy);
        }
      }
    } catch {}
  }, [activeTab]);

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/transactions`);
      if (res.ok) { const data = await res.json(); setAllTransactions(data.transactions || []); }
    } catch {}
  }, []);

  useEffect(() => {
    fetchAgentInfo(); fetchSpending(); fetchTransactions();
    const i = setInterval(() => { fetchSpending(); fetchTransactions(); }, 3000);
    const j = setInterval(fetchAgentInfo, 10000);
    return () => { clearInterval(i); clearInterval(j); };
  }, [fetchAgentInfo, fetchSpending, fetchTransactions]);

  const runAgentTask = async (task: string, label: string) => {
    if (!agentConnected) {
      setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Agent not connected. Start services with: npm run dev`]);
      return;
    }
    setLoading(true); setActiveTask(label);
    setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Starting: ${label}`]);
    try {
      const res = await fetch(`${AGENT_URL}/agent/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task }),
      });
      if (!res.ok) {
        const errText = await res.text();
        const errMsg = (() => { try { return JSON.parse(errText).error; } catch { return errText.slice(0, 200); } })();
        setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Error (${res.status}): ${errMsg}`]);
        return;
      }
      const data: AgentResult = await res.json();
      setAgentResult(data); setSpending(data.spending);
      for (const tc of data.toolCalls) {
        const resultPreview = tc.result?.error ? `ERROR: ${tc.result.error.slice(0, 60)}` : "OK";
        setAgentLog(p => [...p, `  -> ${tc.tool} ${resultPreview}`]);
      }
      setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Done: ${data.toolCalls.length} tool calls`]);
      fetchTransactions();
      fetchAgentInfo(); // refresh wallet balance
    } catch (err: any) {
      setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Connection error: ${err.message}`]);
      setAgentConnected(false);
    } finally { setLoading(false); setActiveTask(""); }
  };

  const [policySaved, setPolicySaved] = useState(false);

  const updatePolicy = async () => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/policy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policyForm) });
      if (res.ok) {
        const spendingRes = await fetch(`${AGENT_URL}/agent/spending`);
        if (spendingRes.ok) {
          const data = await spendingRes.json();
          setSpending(data);
          setPolicyForm(data.policy);
        }
        setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Policy updated: daily=$${policyForm.dailyLimit}, monthly=$${policyForm.monthlyLimit}, meds=$${policyForm.medicationMonthlyBudget}, bills=$${policyForm.billMonthlyBudget}, approval=$${policyForm.approvalThreshold}`]);
        setPolicySaved(true);
        setTimeout(() => setPolicySaved(false), 3000);
      }
    } catch (err: any) {
      setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Failed to update policy: ${err.message}`]);
    }
  };

  const resetAgent = async () => {
    await fetch(`${AGENT_URL}/agent/reset`, { method: "POST" });
    setAllTransactions([]); setAgentResult(null); setAgentLog([]); fetchSpending();
  };

  const togglePause = async () => {
    const endpoint = agentPaused ? "/agent/resume" : "/agent/pause";
    try {
      const res = await fetch(`${AGENT_URL}${endpoint}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAgentPaused(data.paused);
        setAgentLog(p => [...p, `[${new Date().toLocaleTimeString()}] Agent ${data.paused ? "paused" : "resumed"}`]);
      }
    } catch {}
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500 flex items-center justify-center text-white font-bold text-sm">CG</div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">CareGuard</h1>
              <p className="text-xs text-slate-500">AI Healthcare Agent on Stellar</p>
            </div>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${agentConnected ? (agentPaused ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700") : "bg-red-50 text-red-600"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${agentConnected ? (agentPaused ? "bg-amber-500" : "bg-green-500") : "bg-red-500"}`} />
              {!agentConnected ? "Disconnected" : agentPaused ? "Paused" : "Active"}
            </div>
            {agentConnected && (
              <button onClick={togglePause} className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${agentPaused ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}>
                {agentPaused ? "Resume" : "Pause"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {walletBalance && agentInfo?.agentWallet && (
              <a href={`https://stellar.expert/explorer/testnet/account/${agentInfo.agentWallet}`} target="_blank" rel="noopener noreferrer" className="text-right group">
                <div className="text-xs text-slate-500">Agent Wallet (USDC)</div>
                <div className="font-semibold text-sm group-hover:text-sky-600">${walletBalance}</div>
              </a>
            )}
            <div className="h-6 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="text-right text-xs">
                <div className="text-slate-500">Care Recipient</div>
                <div className="font-medium">Rosa Garcia, 78</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-sm font-medium">RG</div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <nav className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-slate-200 w-fit">
          {(["overview", "medications", "bills", "policy", "wallet", "activity", "settings"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${activeTab === tab ? "bg-sky-500 text-white" : "text-slate-600 hover:bg-slate-100 active:bg-slate-200"}`}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card label="Monthly Spending" value={`$${spending?.spending.total.toFixed(2) || "0.00"}`} sub={`of $${spending?.policy.monthlyLimit || 500} limit`} color="sky" />
              <Card label="Savings Found" value={agentResult ? `$${agentResult.toolCalls.filter(t => t.tool === "compare_pharmacy_prices").reduce((s, t) => s + (t.result?.potentialSavings || 0), 0).toFixed(2)}/mo` : "$0.00/mo"} sub="by switching pharmacies" color="green" />
              <Card label="Billing Errors Caught" value={agentResult ? `$${agentResult.toolCalls.filter(t => t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill").reduce((s, t) => s + (t.result?.totalOvercharge || 0), 0).toFixed(2)}` : "$0.00"} sub="in overcharges identified" color="amber" />
              <Card label="Agent API Costs" value={`$${spending?.spending.serviceFees.toFixed(4) || "0.0000"}`} sub={`${spending?.transactionCount || 0} queries via x402`} color="slate" />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Budget Status</h2>
              <div className="space-y-4">
                <Bar label="Medications" spent={spending?.spending.medications || 0} budget={spending?.policy.medicationMonthlyBudget || 300} />
                <Bar label="Medical Bills" spent={spending?.spending.bills || 0} budget={spending?.policy.billMonthlyBudget || 500} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Btn label="Compare Medication Prices" desc={agentPaused ? "Agent is paused" : "Find cheapest pharmacies for Rosa's 4 medications"} busy={(loading && activeTask === "meds") || agentPaused}
                  onClick={() => runAgentTask("Compare prices for all of Rosa's medications (lisinopril, metformin, atorvastatin, amlodipine) and order from the cheapest pharmacies. Also check for drug interactions.", "meds")} />
                <Btn label="Audit Hospital Bill" desc={agentPaused ? "Agent is paused" : "Scan Rosa's bill for errors and overcharges"} busy={(loading && activeTask === "bill") || agentPaused}
                  onClick={() => runAgentTask("Audit Rosa's hospital bill from General Hospital and pay the corrected amount if errors are found.", "bill")} />
                <Btn label="Try Over-Budget Payment" desc={agentPaused ? "Agent is paused" : "Demo: agent attempts $600 payment (over $500 bill limit)"} busy={(loading && activeTask === "block") || agentPaused}
                  onClick={() => runAgentTask("Pay a $600 medical bill to General Hospital for Rosa's recent surgery follow-up.", "block")} />
              </div>
              {loading && <div className="mt-4 flex items-center gap-2 text-sm text-sky-600"><div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />Agent working...</div>}
            </div>

            {agentResult && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Agent Response</h2>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{agentResult.response}</p>
                <div className="mt-4 text-xs text-slate-400">{agentResult.toolCalls.length} tool calls | API cost: ${agentResult.spending.spending.serviceFees.toFixed(4)}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "medications" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">Rosa&apos;s Medications</h2>
                {agentResult?.toolCalls.some(t => t.tool === "compare_pharmacy_prices") && (
                  <button onClick={() => downloadMedicationPDF(agentResult!.toolCalls)} className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all">Download PDF</button>
                )}
              </div>
              <div className="space-y-3">
                {["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"].map(drug => {
                  const r = agentResult?.toolCalls.find(t => t.tool === "compare_pharmacy_prices" && t.result?.drug?.toLowerCase() === drug.toLowerCase())?.result;
                  return (
                    <div key={drug} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div><div className="font-medium text-sm">{drug}</div><div className="text-xs text-slate-500">{r ? `Best: ${r.cheapest.pharmacyName} at $${r.cheapest.price}` : "Not yet compared"}</div></div>
                      {r && <div className="text-right"><div className="text-sm font-medium text-green-600">Save ${r.potentialSavings}/mo</div><div className="text-xs text-slate-400">{r.savingsPercent}% savings</div></div>}
                    </div>
                  );
                })}
              </div>
            </div>
            {agentResult?.toolCalls.some(t => t.tool === "check_drug_interactions") && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-sm font-semibold text-slate-700 mb-4">Drug Interactions</h2>
                {agentResult.toolCalls.filter(t => t.tool === "check_drug_interactions").map((t, i) => (
                  <div key={i} className="space-y-2">
                    <p className="text-sm text-slate-600">{t.result.summary}</p>
                    {t.result.interactions?.map((ix: any, j: number) => (
                      <div key={j} className={`p-3 rounded-lg text-sm ${ix.severity === "severe" ? "bg-red-50 border border-red-200" : ix.severity === "moderate" ? "bg-amber-50 border border-amber-200" : "bg-blue-50 border border-blue-200"}`}>
                        <div className="font-medium">{ix.drug1} + {ix.drug2} ({ix.severity})</div>
                        <div className="text-xs mt-1 text-slate-600">{ix.recommendation}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "bills" && (
          <div className="space-y-6">
            {agentResult?.toolCalls.some(t => t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill") ? (
              agentResult.toolCalls.filter(t => t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill").map((t, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-slate-700">Bill Audit Results</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => downloadBillAuditPDF(t.result)} className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all">Download PDF</button>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${t.result.errorCount > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{t.result.errorCount} errors found</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-slate-50 rounded-lg p-3 text-center"><div className="text-lg font-bold">${t.result.totalCharged}</div><div className="text-xs text-slate-500">Total Charged</div></div>
                    <div className="bg-red-50 rounded-lg p-3 text-center"><div className="text-lg font-bold text-red-600">${t.result.totalOvercharge}</div><div className="text-xs text-slate-500">Overcharges</div></div>
                    <div className="bg-green-50 rounded-lg p-3 text-center"><div className="text-lg font-bold text-green-600">${t.result.totalCorrect}</div><div className="text-xs text-slate-500">Correct Amount</div></div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">{t.result.lineItems.length} line items</span>
                    <button onClick={() => setBillShowErrorsOnly(!billShowErrorsOnly)} className="text-xs text-sky-600 hover:text-sky-800 cursor-pointer">
                      {billShowErrorsOnly ? "Show all items" : "Show errors only"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {t.result.lineItems.filter((item: any) => !billShowErrorsOnly || item.status !== "valid").map((item: any, j: number) => (
                      <div key={j} className={`flex items-center justify-between p-3 rounded-lg text-sm ${item.status === "valid" ? "bg-slate-50" : item.status === "duplicate" ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-200"}`}>
                        <div className="flex-1">
                          <div className="font-medium">{item.description}</div>
                          <div className="text-xs text-slate-500">CPT: {item.cptCode}</div>
                          {item.errorDescription && <div className="text-xs text-red-600 mt-1">{item.errorDescription}</div>}
                        </div>
                        <div className="text-right ml-4">
                          <div className={item.status !== "valid" ? "line-through text-red-500" : ""}>${item.chargedAmount}</div>
                          {item.status !== "valid" && <div className="text-green-600 font-medium">${item.suggestedAmount}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-700">{t.result.recommendation}</p>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">No bills audited yet. Run &quot;Audit Hospital Bill&quot; from Overview.</div>
            )}
          </div>
        )}

        {activeTab === "policy" && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Spending Policy for Rosa</h2>
            <p className="text-xs text-slate-500 mb-6">These limits are enforced by Soroban smart contracts on Stellar. The agent cannot exceed them.</p>
            <div className="space-y-4">
              {([["dailyLimit","Daily Spending Limit ($)"],["monthlyLimit","Monthly Spending Limit ($)"],["medicationMonthlyBudget","Medication Monthly Budget ($)"],["billMonthlyBudget","Bill Monthly Budget ($)"],["approvalThreshold","Caregiver Approval Threshold ($)"]] as const).map(([key, label]) => (
                <div key={key}><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                  <input type="number" value={policyForm[key]} onChange={e => setPolicyForm(p => ({...p, [key]: Number(e.target.value)}))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              ))}
              <button onClick={updatePolicy} className={`w-full py-2 rounded-lg text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${policySaved ? "bg-green-500 text-white" : "bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700"}`}>
                {policySaved ? "Policy Saved" : "Update Policy"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "activity" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Transaction Log</h2>
              <div className="flex items-center gap-3">
                {allTransactions.length > 0 && (
                  <button onClick={() => downloadTransactionPDF(allTransactions, spending)} className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all">Download Report</button>
                )}
                <button onClick={resetAgent} className="text-xs text-red-500 hover:text-red-700 hover:underline active:text-red-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 rounded px-1">Reset All</button>
              </div>
            </div>
            <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-green-400 max-h-48 overflow-y-auto">
              {agentLog.length === 0 ? <span className="text-slate-500">No agent activity yet...</span> : agentLog.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {allTransactions.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">No transactions yet</div> : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200"><tr>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Time</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Description</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Amount</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Status</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Stellar Tx</th>
                  </tr></thead>
                  <tbody>{[...allTransactions].reverse().map(tx => (
                    <tr key={tx.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-xs text-slate-400">{new Date(tx.timestamp).toLocaleTimeString()}</td>
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${tx.type === "medication" ? "bg-blue-100 text-blue-700" : tx.type === "bill" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"}`}>{tx.type}</span></td>
                      <td className="px-4 py-2 text-xs">{tx.description}</td>
                      <td className="px-4 py-2 text-right text-xs font-mono">${tx.amount < 0.01 ? tx.amount.toFixed(4) : tx.amount.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right"><span className={`px-2 py-0.5 rounded text-xs ${tx.status === "completed" ? "bg-green-100 text-green-700" : tx.status === "blocked" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{tx.status}</span></td>
                      <td className="px-4 py-2 text-right"><TxLink hash={tx.stellarTxHash} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === "wallet" && (
          <div className="space-y-6 max-w-2xl">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Wallet</h2>
              <p className="text-xs text-slate-500 mb-4">This is the AI agent&apos;s Stellar wallet. It holds USDC for paying pharmacies, medical bills, and API query fees. All balances are on Stellar testnet.</p>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-sky-50 rounded-lg p-4 text-center border border-sky-200">
                  <div className="text-2xl font-bold text-sky-700">${walletBalance || "0.00"}</div>
                  <div className="text-xs text-slate-500 mt-1">USDC Balance</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 text-center border border-slate-200">
                  <div className="text-2xl font-bold text-slate-700">{walletXlm || "0.00"}</div>
                  <div className="text-xs text-slate-500 mt-1">XLM Balance</div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Wallet Address</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono break-all">{agentInfo?.agentWallet || "Not connected"}</code>
                    {agentInfo?.agentWallet && (
                      <button onClick={() => copyToClipboard(agentInfo.agentWallet)} className={`px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${copied ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                        {copied ? "Copied" : "Copy"}
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Network</label>
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">Stellar Testnet</div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">LLM Provider</label>
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">{agentInfo?.llm || "Not connected"}</div>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                {agentInfo?.agentWallet && (
                  <a href={`https://stellar.expert/explorer/testnet/account/${agentInfo.agentWallet}`} target="_blank" rel="noopener noreferrer" className="flex-1 text-center px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600 active:bg-sky-700 cursor-pointer transition-all">View on Stellar Explorer</a>
                )}
                <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="flex-1 text-center px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 active:bg-slate-300 cursor-pointer transition-all">Fund with USDC</a>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">How Payments Work</h2>
              <div className="space-y-3 text-xs text-slate-600">
                <div className="flex gap-3 items-start"><span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium shrink-0">x402</span><span>API queries (pharmacy prices, bill audits, drug interactions) are paid per-request via x402. The agent signs a Soroban authorization entry, and the OZ Facilitator settles the payment on Stellar.</span></div>
                <div className="flex gap-3 items-start"><span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium shrink-0">MPP</span><span>Medication orders are paid via MPP Charge mode. The agent signs a Soroban SAC transfer, and the pharmacy server broadcasts the transaction.</span></div>
                <div className="flex gap-3 items-start"><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium shrink-0">USDC</span><span>Bill payments are direct Stellar USDC transfers. The agent builds a payment transaction, signs it, and submits to Horizon.</span></div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6 max-w-2xl">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Care Recipient</h2>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Name</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Rosa Garcia</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Age</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">78</div></div>
                <div className="col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Medications</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Lisinopril, Metformin, Atorvastatin, Amlodipine</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Primary Doctor</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Dr. Chen, General Hospital</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Insurance</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Medicare Part D</div></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Caregiver</h2>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Name</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Maria Garcia</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Relationship</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Daughter</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Location</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Phoenix, AZ (800 miles from Rosa)</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Notifications</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">Email + SMS</div></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Configuration</h2>
              <div className="space-y-3">
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Agent Status</label>
                  <div className="flex items-center gap-2">
                    <div className={`px-3 py-2 flex-1 bg-slate-50 border border-slate-200 rounded-lg text-sm ${agentPaused ? "text-amber-600" : "text-green-600"}`}>{agentPaused ? "Paused" : "Active"}</div>
                    <button onClick={togglePause} className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all ${agentPaused ? "bg-green-500 text-white hover:bg-green-600" : "bg-amber-500 text-white hover:bg-amber-600"}`}>{agentPaused ? "Resume Agent" : "Pause Agent"}</button>
                  </div>
                </div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">LLM Provider</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono">{agentInfo?.llm || "Not connected"}</div></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Network</label><div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">{agentInfo?.network || "stellar:testnet"}</div></div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Agent Wallet</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono break-all">{agentInfo?.agentWallet || "Not connected"}</code>
                    {agentInfo?.agentWallet && (
                      <button onClick={() => copyToClipboard(agentInfo.agentWallet)} className={`px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${copied ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                        {copied ? "Copied" : "Copy"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="mt-auto border-t border-slate-200 bg-white py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between text-xs text-slate-400">
          <span>CareGuard v1.0 | Stellar Testnet | x402 + MPP</span>
          <div className="flex items-center gap-3">
            {agentInfo?.agentWallet && (
              <a href={`https://stellar.expert/explorer/testnet/account/${agentInfo.agentWallet}`} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-700 underline">Agent Wallet on Explorer</a>
            )}
            <span>Stellar Hacks: Agents 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const c: Record<string,string> = { sky: "border-sky-200 bg-sky-50", green: "border-green-200 bg-green-50", amber: "border-amber-200 bg-amber-50", slate: "border-slate-200 bg-white" };
  return <div className={`rounded-xl border p-4 ${c[color] || c.slate}`}><div className="text-xs font-medium text-slate-500 mb-1">{label}</div><div className="text-xl font-bold">{value}</div><div className="text-xs text-slate-400 mt-1">{sub}</div></div>;
}

function Bar({ label, spent, budget }: { label: string; spent: number; budget: number }) {
  const pct = Math.min((spent / budget) * 100, 100);
  const c = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-sky-500";
  return <div><div className="flex items-center justify-between text-xs mb-1"><span className="font-medium text-slate-600">{label}</span><span className="text-slate-400">${spent.toFixed(2)} / ${budget}</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-500 ${c}`} style={{width:`${pct}%`}} /></div></div>;
}

function Btn({ label, desc, busy, onClick }: { label: string; desc: string; busy: boolean; onClick: () => void }) {
  return <button onClick={onClick} disabled={busy} className="text-left p-4 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 rounded-lg border border-slate-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"><div className="text-sm font-medium">{label}</div><div className="text-xs text-slate-500 mt-1">{desc}</div></button>;
}

const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";

function TxLink({ hash }: { hash?: string }) {
  if (!hash) return <span className="text-xs text-slate-300">-</span>;

  // Clean up hash — might be base64 encoded receipt, raw hash, or order ID
  let displayHash = hash;
  let explorerHash = hash;

  // If it looks like base64 (x402 SettleResponse or MPP receipt), decode and extract tx hash
  if (hash.length > 64 && !hash.match(/^[0-9a-f]{64}$/i)) {
    try {
      const decoded = JSON.parse(atob(hash));
      // x402 SettleResponse has "transaction" field
      // MPP receipt has "reference" field
      const txId = decoded.transaction || decoded.reference || decoded.hash;
      if (txId) {
        explorerHash = txId;
        displayHash = txId;
      }
    } catch {
      // Not decodable, use as-is
    }
  }

  // Only link if it looks like a valid 64-char hex hash
  const isValidHash = /^[0-9a-f]{64}$/i.test(explorerHash);

  if (isValidHash) {
    return (
      <a
        href={`${EXPLORER_URL}/${explorerHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-sky-600 hover:text-sky-800 underline font-mono"
        title={`View on Stellar Explorer: ${explorerHash}`}
      >
        {explorerHash.slice(0, 8)}...
      </a>
    );
  }

  // Non-hash identifier (order ID, etc.)
  return <span className="text-xs text-slate-400 font-mono" title={hash}>{displayHash.slice(0, 12)}...</span>;
}
