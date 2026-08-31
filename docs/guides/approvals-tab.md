# The Approvals Tab — A Guide for Caregivers

This guide explains the **Approvals** tab of the CareGuard dashboard: why a payment ends up waiting there, what the countdown next to it means, and what happens when you approve it, cancel it, or do nothing at all.

It is written for caregivers. You do not need any technical background to follow it.

Related guides:

- [Getting started for caregivers](getting-started-caregiver.md)
- [Spending policy for caregivers](spending-policy-for-caregivers.md) — where the threshold and hold time are set
- [How to submit and audit a medical bill](submitting-a-bill.md)

---

## What this tab is for

CareGuard's agent pays for medications and medical bills on your behalf, inside the limits you set in the **Policy** tab. Small, routine payments go through on their own so you are not interrupted all day.

Larger payments are different. When a single payment reaches the amount you said you wanted to see first, the agent does **not** pay. It writes the payment down as *pending* and puts it in the Approvals tab for you to decide on.

Nothing in the Approvals tab has been paid yet.

---

## What puts a payment here

One thing, and only one thing: the payment **reaches your Caregiver Approval Threshold**.

That threshold is a dollar amount you choose in the **Policy** tab. It is a per-payment figure, not a running total, and it is checked as "this amount or more" — a payment for exactly the threshold is held, not paid. (The note at the bottom of the tab says "above the approval threshold"; the exact rule is *at or above*.)

**Example.** With the threshold at $75:

| The agent wants to pay | What happens |
|---|---|
| $42 for a refill | Paid straight away. It appears in the Activity tab, not here. |
| $75 exactly | Held. A payment that lands exactly on the threshold needs your decision too. |
| $120 for a hospital bill | Held. It appears here and waits for you. |

Two things this tab is **not**:

- **It is not the list of payments that were blocked.** If a payment would break your daily limit, monthly limit or a category budget, the agent refuses it outright — it is never offered to you here. Approvals are for payments that are within your budgets but large enough that you asked to see them first.
- **It is not a receipt list.** Everything that actually completed, whether it needed approval or not, belongs in the **Activity** tab.

To see fewer items here, raise the threshold. To see more, lower it.

---

## Reading a pending item

Each waiting payment shows as an amber card with four lines and two buttons:

```
Atorvastatin 20mg from Walgreens #4021          [ Approve ] [ Cancel ]
Amount: $120.00 | Category: medications
3/14/2026, 9:41:07 AM
Auto-approve in 2840s
```

| Line | What it tells you |
|---|---|
| Description | What is being bought, and from whom |
| Amount | The exact dollar amount that will leave the agent's wallet |
| Category | `medications` or `bills` — which budget it will be counted against |
| Date and time | When the agent asked for your decision |
| Auto-approve in _n_ s | How many seconds are left before the decision is made for you |

The list refreshes by itself every few seconds while you are on this tab, so a payment the agent raises while you are looking will appear without you needing to reload the page.

If the tab says **"Agent not connected"**, the dashboard cannot reach the agent right now, so it cannot tell you what is pending. Nothing is lost — check your connection and come back. If it says **"No pending approvals"**, there is genuinely nothing waiting.

---

## The auto-approve countdown

A pending payment does not wait forever. It waits for the **Hold Time Before Auto-Approval** you set in the Policy tab, and the countdown on the card is that hold time ticking away.

**If you do nothing, the payment goes through when the countdown reaches zero.** No response means yes.

This is deliberate. It means an urgent refill is not stuck waiting because you were asleep or at work, while still giving you a window to step in. But it does mean the countdown is worth understanding before you rely on it.

### Choosing a hold time that suits you

The hold time is a single number of seconds, and it applies to every held payment.

| Hold time | What it means in practice |
|---|---|
| 0 seconds (the starting value) | The countdown is already finished. The payment is approved within a few seconds. You will rarely see the item at all. |
| 900 (15 minutes) | Useful only if you watch the dashboard closely. |
| 3600 (1 hour) | A reasonable middle ground during the working day. |
| 28800 (8 hours) | Survives a night's sleep or a working day. |
| 86400 (24 hours) | The maximum, and the safest if you want a real chance to review everything. |

If you want approvals to be a genuine checkpoint rather than a notice, **set a hold time long enough that you will realistically see the item**. Leaving it at 0 means every payment that reaches your threshold is approved automatically almost immediately.

The countdown starts when the agent raises the payment, not when you open the tab. Opening the tab later does not give you more time.

### Reading the countdown

The number is in seconds and drops once a second: `3600s` is an hour, `120s` is two minutes. Once it reaches `0s` the payment is picked up on the next sweep, which runs every few seconds — so an item can sit at `0s` briefly before it disappears from the list. If you are using a screen reader, the remaining time is announced in rounded steps rather than every single second, so it does not talk over you.

---

## Cancelling before the countdown runs out

**Cancel** is how you stop a payment. To cancel one, press **Cancel** on its card before the countdown reaches zero.

The payment is marked cancelled and the money is never sent. The item disappears from the list. There is no confirmation prompt, so read the card before you press the button.

A few things worth knowing:

- **Cancelling is final.** There is no undo and no "un-cancel". If you cancel by mistake, ask the agent to do the task again — for example, "order Rosa's atorvastatin refill" — and a fresh payment will be raised for you to approve.
- **Cancelling one payment does not stop the agent.** It will keep working on other tasks, and could raise a similar payment again later. If you want everything to stop, pause the agent instead: use the **Pause** button in the dashboard header or in the **Settings** tab. Pausing prevents new work, but it does **not** freeze the countdown on items already waiting here — cancel those separately if you do not want them to go through.
- **You cannot cancel a payment once it has been sent.** After the countdown fires, or after you approve, the payment settles on the payment network and cannot be reversed from the dashboard. If a completed payment was wrong, that becomes a refund or dispute with the pharmacy or provider — see [how to submit and audit a medical bill](submitting-a-bill.md).

Cancelling costs nothing and blocks nothing else, so when a payment looks wrong, cancel it and re-run the task once you are sure.

---

## Approving early

**Approve** simply means "do it now, do not wait for the countdown". Press it and the agent makes the payment immediately.

Use it when you have looked at the payment and you are happy with it — there is no reason to leave a legitimate refill waiting an hour.

While a decision is being processed, both buttons are greyed out for a moment so a payment cannot be sent twice by accident.

Once it succeeds, the item leaves this tab and appears in **Activity** as a completed transaction, with a link to its record on the payment network. Approving also spends against your budgets: the amount is added to the relevant category and to your daily and monthly totals.

If the payment cannot be completed — the wallet is short of funds, or the pharmacy is unreachable — the item leaves the pending list without any money moving. Nothing is charged; the task simply did not happen, and you can ask the agent to try again.

---

## Approving or cancelling several at once

There is currently **no bulk approve or bulk cancel** in the Approvals tab. Every pending payment has its own **Approve** and **Cancel** buttons, and each has to be decided individually.

In everyday use this is rarely a burden, because only payments above your threshold arrive here. If you regularly find yourself with a long list to work through, that usually means the threshold is set lower than it needs to be — see [Spending policy for caregivers](spending-policy-for-caregivers.md).

If you need to stop everything quickly, pausing the agent from the header or the **Settings** tab is faster than cancelling items one by one — but remember that items already waiting here keep their countdowns, so cancel any you do not want.

---

## The life of a pending payment

```
Agent wants to pay $120  (your threshold is $75)
            |
            v
      Held as pending  ---->  shown in the Approvals tab
            |
   +--------+--------+-----------------------+
   |                 |                       |
 You press        You press            You do nothing
 Approve          Cancel               and the countdown
   |                 |                 reaches zero
   v                 v                       |
 Paid now       Never paid                   v
 (Activity)     (no money moves)         Paid automatically
                                          (Activity)
```

---

## Questions caregivers often ask

**Why is a $40 refill not showing up here?**
It is below your approval threshold, so the agent paid it without asking. It is in the **Activity** tab.

**Nothing ever reaches the Approvals tab. Is it broken?**
Most likely your approval threshold is higher than anything the agent is spending, so nothing needs your decision. Lower the threshold in the Policy tab if you want to see more.

**Items vanish from the list almost as soon as they appear.**
Your hold time is probably 0 seconds, which means the countdown has already expired when the item is raised. Set a longer hold time in the Policy tab.

**I was away for the weekend and payments went through without me.**
That is the auto-approve rule working as configured. If you would rather payments wait for you, raise the hold time — up to 24 hours — and consider pausing the agent while you are away.

**Can I get a message when something needs approving?**
CareGuard can send alerts by email, text message or Slack, but that has to be switched on when CareGuard is installed. Ask whoever set up your installation, and record how you want to be reached in the **Notifications** field of the **Settings** tab.

**I cancelled the wrong one. Now what?**
Ask the agent to run the task again. A new pending payment is raised and you can approve that one.
