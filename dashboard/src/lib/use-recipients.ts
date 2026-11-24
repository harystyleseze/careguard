"use client";

import { useCallback, useEffect, useState } from "react";
import { AGENT_URL } from "./agent-url";
import { caregiverFetch } from "./caregiver-fetch";
import type { RecipientProfile } from "./types";

export interface RecipientListItem {
  id: string;
  name: string;
  age: number | null;
  medications: string[];
  primary_doctor: string | null;
  insurance: string | null;
}

export function useRecipients(onSelect: (profile: RecipientProfile) => void) {
  const [recipients, setRecipients] = useState<RecipientListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('rosa_garcia');
  // Per-source health (Issue #1112, following the #213 pattern in
  // use-agent-state.ts): null = healthy, string = error message. Previously a
  // failed /recipients request was swallowed and treated identically to "no
  // recipients", leaving a caregiver with multiple recipients no indication
  // that the switcher data failed to load.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!AGENT_URL) return;
    caregiverFetch('/recipients')
      .then((res) => {
        if (!res.ok) throw new Error(`Recipients returned ${res.status}`);
        return res.json();
      })
      .then((data: RecipientListItem[]) => {
        if (Array.isArray(data) && data.length > 0) setRecipients(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Recipients unavailable');
      });
  }, []);

  const selectRecipient = useCallback(
    (id: string) => {
      const found = recipients.find((r) => r.id === id);
      if (!found) return;
      setSelectedId(id);
      onSelect({
        name: found.name,
        age: found.age ?? undefined,
        medications: found.medications,
        doctor: found.primary_doctor ?? undefined,
        insurance: found.insurance ?? undefined,
      });
    },
    [recipients, onSelect],
  );

  return { recipients, selectedId, selectRecipient, error };
}
