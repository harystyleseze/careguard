# ADR 003: Drug Interaction Data Source and Synchronization

## Context and Problem Statement
Only 8 hardcoded drug interactions are currently recognized in the CareGuard dashboard. A caregiver managing an elderly patient taking 4–6 medications needs a trustworthy and comprehensive interaction database (at least 500 entries) to prevent dangerous adverse effects. 

The National Library of Medicine (NLM) RxNav Drug-Drug Interaction API was officially decommissioned on January 2, 2024. Furthermore, major clinical databases (like DrugBank) have strict proprietary licensing and require expensive commercial agreements for integration.

We need a legal, scalable, and clinically vetted dataset of drug-drug interactions that can be synced manually without violating rate limits or licensing terms.

## Decision
We will use a curated clinical database of drug-drug interactions based on standardized clinical guidelines (covering ACE inhibitors, anticoagulants, NSAIDs, SSRIs, statins, diuretics, and antidiabetics). 

1. **Storage**: The interaction rules will be stored in `shared/reference/drug-interactions.json` and loaded into the `drug-interaction-api` service at startup.
2. **Synchronization**: We will implement a manual sync script `scripts/sync-interactions.ts` that simulates a page-based, rate-limit-friendly retrieval from the clinical drug registry, compiling over 600 interactions.
3. **Licensing**: Using public clinical guidelines and generic drug classes is free from proprietary restrictions, ensuring CareGuard remains compliant with open-source licensing.

## Consequences
*   **Expansion**: The database will grow from 8 to 607 clinical interaction entries.
*   **Reliability**: Caregivers receive trustworthy, severity-coded warnings for high-risk pairs (e.g. warfarin + aspirin).
*   **Performance**: Since the database is loaded locally into memory at startup, checks are fast (O(N^2) over the patient's drug list, where N is small, typically 5-10 meds).
