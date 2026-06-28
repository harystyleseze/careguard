import { useCallback, useEffect, useState } from "react";
import type { CaregiverProfile, RecipientProfile } from "./types";
import { AGENT_URL } from "./agent-url";
import { fetchProfile, DEFAULT_RECIPIENT, DEFAULT_CAREGIVER } from "./fetchProfile";

type ProfilePatch = {
  recipient?: Partial<RecipientProfile>;
  caregiver?: Partial<CaregiverProfile>;
};

type ProfileState = {
  recipient: RecipientProfile;
  caregiver: CaregiverProfile;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
};

export function useProfile(): ProfileState {
  // If running on the server (e.g. Next.js Server Components or test environments where window is undefined),
  // return the cached server profile if available, otherwise return defaults.
  if (typeof window === "undefined") {
    const cached = typeof globalThis !== "undefined"
      ? (globalThis as typeof globalThis & { __SERVER_PROFILE__?: Partial<ProfileState> }).__SERVER_PROFILE__
      : null;
    return {
      recipient: cached?.recipient || DEFAULT_RECIPIENT,
      caregiver: cached?.caregiver || DEFAULT_CAREGIVER,
      updateProfile: async () => {},
    };
  }

  const [recipient, setRecipient] = useState<RecipientProfile>(DEFAULT_RECIPIENT);
  const [caregiver, setCaregiver] = useState<CaregiverProfile>(DEFAULT_CAREGIVER);

  useEffect(() => {
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
  }, []);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
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
    [recipient, caregiver],
  );

  return { recipient, caregiver, updateProfile };
}
