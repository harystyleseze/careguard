export function createPdfRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pdf-${crypto.randomUUID()}`;
  }

  return `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function reportPdfDownloadFailure(error: unknown) {
  const requestId = createPdfRequestId();
  console.error(`PDF generation failed (${requestId})`, error);
  return `Couldn't generate PDF — try again. Request ID: ${requestId}`;
}
