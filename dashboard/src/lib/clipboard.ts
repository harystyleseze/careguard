export type CopyResult = "ok" | "fallback" | "failed";

export async function copyText(text: string): Promise<CopyResult> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.writeText &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return "ok";
    } catch {
      // fall through to legacy path
    }
  }

  if (typeof document !== "undefined" && typeof document.execCommand === "function") {
    let ta: HTMLTextAreaElement | null = null;
    try {
      ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      if (ok) return "fallback";
    } catch {
      // fall through to failed
    } finally {
      if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    }
  }

  return "failed";
}
