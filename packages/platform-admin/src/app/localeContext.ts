/** Stable context identity across translation hot updates. Locale storage,
 * translation and the provider remain in locale.tsx. */
import { createContext } from "react";
import type { AdminLocale, AdminTranslate } from "./locale";

interface LocaleContextValue {
  locale: AdminLocale;
  setLocale: (locale: AdminLocale) => void;
  t: AdminTranslate;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);
