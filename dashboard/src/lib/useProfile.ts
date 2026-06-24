import { useCallback, useEffect, useState } from "react";
import type { CaregiverProfile, RecipientProfile } from "./types";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

const DEFAULT_RECIPIENT: RecipientProfile = {
  name: "Rosa Garcia",
  age: 78,
  facility: "General Hospital",
  medications: ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"],
  doctor: "Dr. Chen, General Hospital",
  insurance: "Medicare Part D",
};

const DEFAULT_CAREGIVER: CaregiverProfile = {
  name: "Maria Garcia",
  relationship: "Daughter",
  location: "Phoenix, AZ (800 miles from Rosa)",
  notifications: "Email + SMS",
};

export function useProfile() {
  const [recipient, setRecipient] = useState<RecipientProfile>(DEFAULT_RECIPIENT);
  const [caregiver, setCaregiver] = useState<CaregiverProfile>(DEFAULT_CAREGIVER);

  useEffect(() => {
    let mounted = true;
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${AGENT_URL}/agent/profile`);
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        const r = data.recipient ?? {};
        const c = data.caregiver ?? {};
        setRecipient({
          name: r.name?.trim() || DEFAULT_RECIPIENT.name,
          age: typeof r.age === "number" ? r.age : DEFAULT_RECIPIENT.age,
          facility: r.facility?.trim() || DEFAULT_RECIPIENT.facility,
          medications: Array.isArray(r.medications) ? r.medications : DEFAULT_RECIPIENT.medications,
          doctor: r.doctor?.trim() || DEFAULT_RECIPIENT.doctor,
          insurance: r.insurance?.trim() || DEFAULT_RECIPIENT.insurance,
        });
        setCaregiver({
          name: c.name?.trim() || DEFAULT_CAREGIVER.name,
          relationship: c.relationship?.trim() || DEFAULT_CAREGIVER.relationship,
          location: c.location?.trim() || DEFAULT_CAREGIVER.location,
          notifications: c.notifications?.trim() || DEFAULT_CAREGIVER.notifications,
        });
      } catch {
        // Keep defaults for dashboard demo mode.
      }
    };
    fetchProfile();
    return () => {
      mounted = false;
    };
  }, []);

  const updateProfile = useCallback(
    async (patch: {
      recipient?: Partial<RecipientProfile>;
      caregiver?: Partial<CaregiverProfile>;
    }) => {
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
