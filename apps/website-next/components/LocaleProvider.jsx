"use client";
import { NextIntlClientProvider } from "next-intl";
export function LocaleProvider({ locale, messages, children }) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      {children}
    </NextIntlClientProvider>
  );
}
