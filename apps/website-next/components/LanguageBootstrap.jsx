"use client";
import { useEffect } from "react";
import { sitePath } from "../lib/site";
export function LanguageBootstrap({ locale = "zh", home = false }) {
  useEffect(() => {
    const stored = document.cookie.match(
      /(?:^|;\s*)NEXT_LOCALE=(zh|en)(?:;|$)/,
    )?.[1];
    const preferred =
      stored ||
      (/^zh(?:-|$)/i.test(navigator.languages?.[0] || navigator.language || "")
        ? "zh"
        : "en");
    if (home || preferred !== locale)
      location.replace(
        sitePath(preferred === "en" ? "/en/harness/" : "/harness/") + location.search + location.hash,
      );
  }, [locale, home]);
  return null;
}
