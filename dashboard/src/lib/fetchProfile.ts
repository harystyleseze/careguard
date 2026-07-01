import { AGENT_URL } from "./agent-url";
import type { RecipientProfile, CaregiverProfile } from "./types";
import { agentFetch } from "./agent-fetch";

export const DEFAULT_RECIPIENT: RecipientProfile = {
  name: "Rosa Garcia",
  age: 78,
  facility: "General Hospital",
  medications: ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"],
  doctor: "Dr. Chen, General Hospital",
  insurance: "Medicare Part D",
};

export const DEFAULT_CAREGIVER: CaregiverProfile = {
  name: "Maria Garcia",
  relationship: "Daughter",
  location: "Phoenix, AZ (800 miles from Rosa)",
  notifications: "Email + SMS",
};

export interface ProfileData {
  recipient: RecipientProfile;
  caregiver: CaregiverProfile;
}

export async function fetchProfile(): Promise<ProfileData> {
  if (!AGENT_URL) {
    return { recipient: DEFAULT_RECIPIENT, caregiver: DEFAULT_CAREGIVER };
  }
  try {
    const res = await agentFetch(`${AGENT_URL}/agent/profile`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return { recipient: DEFAULT_RECIPIENT, caregiver: DEFAULT_CAREGIVER };
    }
    const data = await res.json();
    const r = data.recipient ?? {};
    const c = data.caregiver ?? {};
    return {
      recipient: {
        name: r.name?.trim() || DEFAULT_RECIPIENT.name,
        age: typeof r.age === "number" ? r.age : DEFAULT_RECIPIENT.age,
        facility: r.facility?.trim() || DEFAULT_RECIPIENT.facility,
        medications: Array.isArray(r.medications) ? r.medications : DEFAULT_RECIPIENT.medications,
        doctor: r.doctor?.trim() || DEFAULT_RECIPIENT.doctor,
        insurance: r.insurance?.trim() || DEFAULT_RECIPIENT.insurance,
        avatar: r.avatar?.trim() || undefined,
      },
      caregiver: {
        name: c.name?.trim() || DEFAULT_CAREGIVER.name,
        relationship: c.relationship?.trim() || DEFAULT_CAREGIVER.relationship,
        location: c.location?.trim() || DEFAULT_CAREGIVER.location,
        notifications: c.notifications?.trim() || DEFAULT_CAREGIVER.notifications,
      },
    };
  } catch {
    return { recipient: DEFAULT_RECIPIENT, caregiver: DEFAULT_CAREGIVER };
  }
}
