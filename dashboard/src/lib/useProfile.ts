import { useEffect, useState } from "react";
import type { RecipientProfile } from "./types";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

const DEFAULT_PROFILE: RecipientProfile = {
  name: "Rosa Garcia",
  age: 78,
  facility: "General Hospital",
};

export function useProfile() {
  const [recipient, setRecipient] = useState<RecipientProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    let mounted = true;
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${AGENT_URL}/agent/profile`);
        if (!res.ok) return;
        const data = (await res.json()) as Partial<RecipientProfile>;
        if (!mounted) return;
        setRecipient({
          name: data.name?.trim() || DEFAULT_PROFILE.name,
          age: typeof data.age === "number" ? data.age : DEFAULT_PROFILE.age,
          facility: data.facility?.trim() || DEFAULT_PROFILE.facility,
        });
      } catch {
        // Keep default profile for dashboard demo mode.
      }
    };
    fetchProfile();
    return () => {
      mounted = false;
    };
  }, []);

  return { recipient };
}
