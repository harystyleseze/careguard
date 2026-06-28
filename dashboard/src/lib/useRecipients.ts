"use client";

import { useCallback, useEffect, useState } from "react";
import { AGENT_URL } from "./agent-url";
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

  useEffect(() => {
    if (!AGENT_URL) return;
    const token = typeof document !== 'undefined'
      ? document.cookie.split(';').find(c => c.trim().startsWith('caregiver_token='))?.split('=')[1]
      : undefined;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${AGENT_URL}/recipients`, { headers })
      .then((res) => res.ok ? res.json() : [])
      .then((data: RecipientListItem[]) => {
        if (Array.isArray(data) && data.length > 0) setRecipients(data);
      })
      .catch(() => {});
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

  return { recipients, selectedId, selectRecipient };
}
