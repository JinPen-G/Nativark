"use client";
import Link from "next/link";
import { useLocale } from "next-intl";
export function LocalizedLink({ href, ...props }) {
  const locale = useLocale();
  return <Link href={locale === "en" ? "/en" + href : href} {...props} />;
}
