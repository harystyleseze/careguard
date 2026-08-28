# The Settings Tab — A Guide for Caregivers

This guide explains everything you see in the **Settings** tab of the CareGuard dashboard, in plain language. You do not need any technical background to follow it.

Settings is where you keep the care recipient's details up to date, record how you want to be reached, switch between the people you care for, and pause or resume the CareGuard agent.

Related guides:

- [Getting started for caregivers](getting-started-caregiver.md)
- [Spending policy for caregivers](spending-policy-for-caregivers.md) — the money limits live in the **Policy** tab, not here

---

## Settings at a glance

| Section | What it holds | Can you edit it? |
|---|---|---|
| Care Recipient | Name, age, medications, primary doctor, insurance | Yes — click **Edit** |
| Caregiver | Your name, relationship, location, notifications | Yes — click **Edit** |
| Agent Configuration | Agent status, LLM provider, network, agent wallet address | Status only — pause or resume |

There is one **Edit** button, at the top right of the Care Recipient card. Clicking it unlocks **both** the Care Recipient and Caregiver cards at the same time. **Save** and **Cancel** appear at the bottom of the Caregiver card.

---

## Care Recipient

These details describe the person you are caring for. The agent uses them when it looks up medications, checks bills, and writes to pharmacies or providers on your behalf, so it is worth keeping them accurate.

### Name

The care recipient's full name. It is also shown at the top of the dashboard and in the initials badge next to it.

### Age

The care recipient's age in years. If it has never been filled in, the field shows **N/A**.

### Medications (comma-separated)

The list of medications the person takes, typed as one line with commas between each name — for example:

```
Metformin, Lisinopril, Atorvastatin
```

Spaces around the commas do not matter, and blank entries are ignored. Saving splits the line back into a proper list, so `Metformin,Lisinopril` and `Metformin, Lisinopril` give the same result.

### Primary Doctor

The doctor who oversees the care recipient's treatment. Free text — a name is enough.

### Insurance

The insurance plan or provider name. Free text.

### Switching between care recipients

If your account covers **more than one** care recipient, a small dropdown appears next to the "Care Recipient" heading. Pick a name from it to switch the **whole dashboard** — spending, approvals, bills, medications and activity all follow your choice, not just this tab.

If you care for only one person, the dropdown is hidden and there is nothing to choose.

---

## Caregiver

These details describe **you**, the caregiver.

### Name

Your name, as it should appear on correspondence the agent generates, such as bill dispute letters.

### Relationship

How you are related to the care recipient — for example *Daughter*, *Son*, *Spouse*, *Legal guardian*.

### Location

Where you are based, for example *Phoenix, AZ*. This is a note for your own records; it does not change how limits are calculated.

### Notifications

This field records **how you prefer to be contacted** — for example `Email + SMS`, `Email only`, or `Text me at 555-0142`. New profiles start at **Email + SMS**.

It is important to understand what this field does and does not do:

- It is a **written preference**, so anyone else looking at the account can see how you want to be reached.
- It does **not** switch delivery channels on by itself. Which alerts actually go out by email, text message or Slack is set up once by whoever installed CareGuard, together with the contact details held in the spending policy.

If you change this field and expect the change to take effect, tell whoever set up your CareGuard installation so they can match the delivery settings to it.

### What CareGuard sends alerts about

Once alerts are switched on for your installation, these are the events that raise one:

| Alert | When it fires |
|---|---|
| Agent Paused | You pause the agent (from this tab, or from the header) |
| Agent Resumed | You resume the agent |
| Spending Policy Updated | Any limit in the Policy tab is changed |
| Medication Payment Made | A medication payment above your approval threshold completes |
| Bill Payment Made | A bill payment above your approval threshold completes |
| Low wallet balance | The agent's wallet is running low and needs topping up |

Payments **below** your approval threshold are treated as routine and do not raise an alert. They are still listed in the **Activity** tab, which is the complete record of everything the agent did.

Alerts are not the same as approvals. An alert tells you something already happened; an approval asks you to decide before it happens, and those wait for you in the **Approvals** tab.

---

## Saving your changes

1. Click **Edit** at the top right of the Care Recipient card.
2. Change any field in the Care Recipient or Caregiver cards.
3. Click **Save**. The button reads *Saving…* until it finishes, then the cards return to read-only.

Click **Cancel** instead and nothing is saved — the cards go back to the values that were there before.

One thing to know: if you clear a text field and save, CareGuard keeps the **previous** value rather than storing a blank. Fields cannot be emptied from this screen. To correct a value, type the new one over the old one.

---

## Agent Configuration

This card describes the CareGuard agent itself. Only the first item can be changed.

### Agent Status

Shows **Active** (green) or **Paused** (amber), with a button beside it:

- **Pause** — the agent stops. It makes no payments, orders no refills and pays no bills until you resume it. Anything already waiting in the Approvals tab stays there.
- **Resume** — the agent starts working again under your existing spending policy.

Pausing is the fastest way to stop everything if something looks wrong. It is fully reversible, and both pausing and resuming raise an alert, so there is a record of who stopped what and when. The same control also appears in the dashboard header, and both do exactly the same thing.

### LLM Provider

The AI service the agent uses to read bills and reason about medications. Read-only, shown for transparency. If it says **Not connected**, the dashboard cannot currently reach the agent — see [the troubleshooting guide](../troubleshooting.md).

### Network

The payment network the agent settles on, normally `stellar:testnet`. On testnet the money is **practice money**, not real funds. See [Testnet explained for caregivers](testnet-explained.md).

### Agent Wallet

The agent's wallet address — a long string of letters and numbers. The **Copy** button puts it on your clipboard (the button reads *Copied* for a moment afterwards) so you can paste it into a funding tool or a block explorer and see the payment history for yourself.

The address is safe to share. It is like an account number: people can send funds to it and look up its history, but nobody can spend from it without the agent's private key, which is never shown in the dashboard.

If copying fails — some browsers block it — a small message appears with the address ready to select, and you can press **Ctrl+C** (or **Cmd+C** on a Mac) to copy it manually.

---

## Language: viewing the dashboard in English or Spanish

The CareGuard dashboard is available in **English (`en`)** and **Spanish (`es`)**. English is used unless you ask for Spanish.

### How to switch

The language is part of the dashboard's web address. Add `locale=es` to the end of it:

| Language | Address |
|---|---|
| English (default) | `http://localhost:3000/?tab=settings` |
| Spanish | `http://localhost:3000/?tab=settings&locale=es` |

If the address already contains a `?`, join the new part on with `&` as shown above; if it does not, start with `?` — for example `http://localhost:3000/?locale=es`.

Bookmark the Spanish address and the dashboard opens in Spanish every time. Moving between tabs keeps the language you chose. An unrecognised value — `locale=fr`, say — is ignored, and the dashboard falls back to English rather than showing an error.

### What changes when you choose Spanish

- **Labels and headings.** Tab names and field labels are translated: *Settings* becomes *Ajustes*, *Care Recipient* becomes *Paciente*, *Approvals* becomes *Aprobaciones*, *Notifications* becomes *Notificaciones*, and *Active* / *Paused* become *Activo* / *Pausado*.
- **Dates and times.** Spanish puts the day before the month, so 3 March 2026 shows as `3 mar 2026` rather than `Mar 3, 2026`.
- **Numbers and amounts.** Spanish formatting uses a comma for the decimal mark and a dot for thousands, so `$1,234.56` shows as `1.234,56 US$`.

### What does not change

- **The currency is still US dollars.** Only the way the amount is written changes, never the amount itself or the currency.
- **Your own data stays as you typed it.** Names, medication lists, doctor and insurance names, bill descriptions and notes are shown exactly as entered — translation covers the dashboard's own labels, not your content.
- **Nothing about the agent's behaviour changes.** Limits, approvals and payments work identically in both languages.
- **The choice is personal to your browser.** It is carried in the address you opened, so it does not change what anyone else sees, and it is not saved into the care recipient's profile.

---

## Questions caregivers often ask

**Do I have to save the language choice anywhere?**
No. It lives in the web address. Bookmark the Spanish address if you want Spanish every time.

**I changed the Notifications field but I am not getting texts.**
That field records your preference; it does not switch text messaging on by itself. Ask whoever set up your CareGuard installation to enable the channel and to confirm the phone number held in the spending policy.

**Why can I not edit the wallet address, network or LLM provider?**
Those are set when CareGuard is installed and are shown here only so you can check them. Changing them would point the agent at a different wallet or service, so it is deliberately not something the dashboard allows.

**I emptied a field and saved, but the old value came back.**
That is expected — a blank entry is treated as "no change". Type the new value over the old one instead.

**Where do I set spending limits?**
In the **Policy** tab, not here. See [Spending policy for caregivers](spending-policy-for-caregivers.md).
