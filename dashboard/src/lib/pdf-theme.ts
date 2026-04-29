export type PdfTheme = {
  headerColor: [number, number, number];
  accentColor: [number, number, number];
  mutedColor: [number, number, number];
};

export const DEFAULT_PDF_THEME: PdfTheme = {
  headerColor: [14, 165, 233], // sky-500
  accentColor: [34, 197, 94], // green-500
  mutedColor: [100, 116, 139], // slate-500
};

