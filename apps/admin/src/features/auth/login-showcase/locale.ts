/** Website demo message adapter. Reuses the admin language; no Next.js provider or runtime. */
import { useLocale as useAdminLocale } from "@/app/locale";
import zh from "./source/zh.json";
import en from "./source/en.json";

export function useLocale() {
  return useAdminLocale().locale === "en-US" ? "en" : "zh";
}

export function useTranslations(namespace: string) {
  const locale = useLocale();
  const messages = (locale === "en" ? en : zh) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
    }
    if (typeof value !== "string") return key;
    return value.replace(/\{(\w+)\}/g, (token, name: string) => values?.[name] === undefined ? token : String(values[name]));
  };
}
