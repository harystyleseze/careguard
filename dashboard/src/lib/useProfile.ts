import { useCallback, useEffect, useState } from "react";
import type { CaregiverProfile, RecipientProfile } from "./types";
import { AGENT_URL } from "./agent-url";
import { fetchProfile, DEFAULT_RECIPIENT, DEFAULT_CAREGIVER } from "./fetchProfile";

export function useProfile() {
  const isServer = typeof window === "undefined";

  const [recipient, setRecipient] = useState<RecipientProfile>(() => {
    if (!isServer) {
      const cached = (window as any).__SERVER_PROFILE__;
      if (cached?.recipient) return cached.recipient;
    }
    const cached = typeof globalThis !== "undefined" ? (globalThis as any).__SERVER_PROFILE__ : null;
    return cached?.recipient || DEFAULT_RECIPIENT;
  });

  const [caregiver, setCaregiver] = useState<CaregiverProfile>(() => {
    if (!isServer) {
      const cached = (window as any).__SERVER_PROFILE__;
      if (cached?.caregiver) return cached.caregiver;
    }
    const cached = typeof globalThis !== "undefined" ? (globalThis as any).__SERVER_PROFILE__ : null;
    return cached?.caregiver || DEFAULT_CAREGIVER;
  });

  useEffect(() => {
    if (isServer) return;
    let mounted = true;
    const load = async () => {
      const data = await fetchProfile();
      if (!mounted) return;
      setRecipient(data.recipient);
      setCaregiver(data.caregiver);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [isServer]);

  const updateProfile = useCallback(
    async (patch: {
      recipient?: Partial<RecipientProfile>;
      caregiver?: Partial<CaregiverProfile>;
    }) => {
      if (isServer) return;
      const prevRecipient = recipient;
      const prevCaregiver = caregiver;
      // Optimistic update
      if (patch.recipient) setRecipient((p) => ({ ...p, ...patch.recipient }));
      if (patch.caregiver) setCaregiver((p) => ({ ...p, ...patch.caregiver }));
      try {
        const res = await fetch(`${AGENT_URL}/agent/profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          setRecipient(prevRecipient);
          setCaregiver(prevCaregiver);
        }
      } catch {
        setRecipient(prevRecipient);
        setCaregiver(prevCaregiver);
      }
    },
    [isServer, recipient, caregiver],
  );

  return { recipient, caregiver, updateProfile };
}
