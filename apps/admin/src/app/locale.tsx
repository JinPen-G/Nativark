/** 原 Rental 宿主沿正式业务词典消费公共语言 Context。 */
import { LocaleProvider as SharedLocaleProvider, translateAdminText as translateSharedText, type AdminLocale } from "@rental-os/platform-admin/locale";
import type { ReactNode } from "react";
import { rentalAdminMessages } from "@rental-os/rental-core/admin/messages";

export { useLocale } from "@rental-os/platform-admin/locale";
export type { AdminLocale, AdminTranslate } from "@rental-os/platform-admin/locale";
export type AdminMessageValues = import("@rental-os/platform-admin/locale").AdminMessageValues;

export function translateAdminText(value: string, locale: AdminLocale, values?: AdminMessageValues) {
  return translateSharedText(value, locale, values, rentalAdminMessages);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  return <SharedLocaleProvider messages={rentalAdminMessages}>{children}</SharedLocaleProvider>;
}
