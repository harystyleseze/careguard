import { useCallback, useState } from "react";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

export interface RecipientProfile {
  name: string;
  age: number;
  medications: string[];
  doctor: string;
  insurance: string;
}

export interface CaregiverProfile {
  name: string;
  relationship: string;
  location: string;
  notifications: string;
}

export interface AgentProfile {
  recipient: RecipientProfile;
  caregiver: CaregiverProfile;
}

export function useProfile() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AGENT_URL}/agent/profile`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      } else {
        setError(`Failed to fetch profile: ${res.status}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { profile, loading, error, fetchProfile };
}