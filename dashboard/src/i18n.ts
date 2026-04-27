import en from "../messages/en.json";
import es from "../messages/es.json";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];

export const translations: Record<Locale, typeof en> = { en, es };

export function getTranslations(locale: Locale) {
  return translations[locale] || translations.en;
}

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

export function formatCurrency(amount: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US", {
    style: "currency",
    currency: "USD",
  });
  return formatter.format(amount);
}

export function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatNumber(num: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US").format(num);
}