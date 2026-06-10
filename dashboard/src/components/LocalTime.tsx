"use client";

import { useEffect, useState } from "react";

/**
 * Renders an ISO timestamp in the VIEWER's local timezone (IST for an Indian
 * visitor, whatever the judge's browser says for them). Server-renders a UTC
 * fallback, swaps to local time after hydration.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => iso.replace("T", " ").slice(0, 19) + " UTC");
  useEffect(() => {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      setText(
        d.toLocaleString(undefined, {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    }
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}
