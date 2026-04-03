# CareGuard Demo Video Script (3 Minutes)

Target: 2:30-3:00. Hackathon submission requires 2-3 minute demo video.

---

## [0:00 - 0:25] THE PROBLEM

**Screen:** Title card or simple slide.

> "63 million Americans are caregivers for aging family members. They spend $7,200 a year out of pocket and 27 hours a week managing healthcare for their loved ones."

> "The same medication costs 10x different at pharmacies 2 miles apart. 80% of medical bills contain errors. And caregivers — often working full-time, often hundreds of miles away — have no way to manage this."

> "This is CareGuard."

---

## [0:25 - 0:45] MEET MARIA AND ROSA

**Screen:** Dashboard at `http://localhost:3000` — show the header with "Rosa Garcia, 78" and the Overview tab with empty state.

> "Meet Maria. She lives 800 miles from her 78-year-old mother, Rosa. Rosa takes 4 medications — lisinopril, metformin, atorvastatin, and amlodipine."

> "Maria just set up CareGuard — an AI agent with a Stellar wallet. She's set spending limits: $300 a month for medications, $500 for bills, and anything over $75 needs her approval."

**Action:** Show the Policy tab briefly with the spending limits.

---

## [0:45 - 1:30] MEDICATION PRICE COMPARISON + PAYMENT

**Screen:** Back to Overview tab.

> "Watch what happens when Maria asks the agent to manage Rosa's medications."

**Action:** Click "Compare Medication Prices" button.

> "The agent is now autonomously calling 5 pharmacies for each of Rosa's 4 medications. Every price query is a real x402 payment on Stellar — the agent signs a Soroban authorization entry, the OpenZeppelin facilitator settles the transaction, and the pharmacy API returns pricing data."

**Screen:** Wait for results. Show the agent response and tool calls.

> "It found Lisinopril at $3.50 at Costco versus $18.99 at Rite Aid. That's $15 saved on just one medication. Across all four, the agent found $69 a month in savings."

**Action:** Click the Medications tab — show the price comparison results and drug interaction checks.

> "It also checked for drug interactions — 3 mild interactions found, all safe at standard doses. Now it's ordering from the cheapest pharmacies via MPP Charge — real USDC payments on Stellar."

---

## [1:30 - 2:10] BILL AUDITING

**Action:** Go back to Overview. Click "Audit Hospital Bill."

> "Rosa received a hospital bill for $2,500. Let's see what the agent finds."

**Screen:** Wait for results.

> "The agent paid $0.01 via x402 to run the audit. It found 5 errors totaling $1,195 — that's 48% of the entire bill. A duplicate CBC charge, an upcoded office visit billed at $1,250 instead of the fair market rate of $318, and overcharges on a chest X-ray."

**Action:** Click the Bills tab — show the line-by-line audit with red-highlighted errors and corrected amounts.

> "The corrected amount is $1,305 instead of $2,500. Rosa was about to pay an extra $1,195 for errors she'd never have caught."

---

## [2:10 - 2:35] SPENDING POLICY ENFORCEMENT

**Action:** Go back to Overview. Click "Try Over-Budget Payment."

> "Now watch what happens when the agent tries to pay a $600 bill — above Rosa's $500 monthly bill limit."

**Screen:** Wait for result — should show the policy block.

> "Blocked. The Soroban spending policy stops the payment and alerts Maria for approval. The agent cannot override the caregiver's limits. This is the trust layer — caregivers can delegate financial tasks to an AI agent knowing it will never spend more than they've authorized."

---

## [2:35 - 2:55] THE TRANSACTIONS

**Action:** Click the Activity tab — show the transaction table with Stellar Explorer links.

> "Every action is a real Stellar transaction. Click any link — it opens on Stellar Explorer. You can verify every payment the agent made."

**Action:** Click one of the tx hash links — show it opening in Stellar Expert.

> "x402 for API queries. MPP Charge for medication orders. Direct USDC transfers for bills. All on Stellar testnet, all verifiable on-chain."

---

## [2:55 - 3:00] CLOSE

**Screen:** Back to Overview showing the stat cards.

> "CareGuard. $69 a month in medication savings. $1,195 in billing errors caught. $0.03 in agent costs. For 63 million caregivers and their families."

---

## Technical Notes for Recording

- **Before recording:** Fund agent with fresh USDC (at least $20). Reset spending: click Reset All in Activity tab.
- **Services running:** `npm run dev` in one terminal, `cd dashboard && npm run dev` in another.
- **Dashboard URL:** `http://localhost:3000`
- **Screen resolution:** 1920x1080 recommended.
- **Browser:** Chrome or Firefox, clean profile, no extensions visible.
- **If Groq rate-limits mid-demo:** The agent returns tool results even if the LLM fails on follow-up. Results still show in the dashboard.
- **Backup:** If the live demo has issues, pre-record each section separately and edit together.

## DoraHacks Submission Checklist

- [ ] Public GitHub repo
- [ ] Demo video (2-3 min, uploaded to YouTube/Loom/similar)
- [ ] Project description on DoraHacks
- [ ] Link to live dashboard (optional) or screenshots
- [ ] Stellar testnet transactions verifiable on stellar.expert
