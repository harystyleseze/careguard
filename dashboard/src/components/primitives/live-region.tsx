"use client";

import { useEffect, useState } from "react";

export function LiveRegion(props: { message: string }) {
  const [rendered, setRendered] = useState("");

  useEffect(() => {
    if (!props.message) return;
    // Force SR announcement even if the same message repeats.
    setRendered("");
    const t = setTimeout(() => setRendered(props.message), 10);
    return () => clearTimeout(t);
  }, [props.message]);

  return (
    <div className="sr-only" aria-live="polite" role="status">
      {rendered}
    </div>
  );
}

