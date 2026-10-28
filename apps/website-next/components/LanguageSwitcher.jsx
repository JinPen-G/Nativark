"use client";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  return (
    <nav
      className="ds-locale-toggle"
      aria-label={locale === "en" ? "Language" : "语言"}
    >
      {[
        ["zh", "中文", "/harness/"],
        ["en", "EN", "/en/harness/"],
      ].map(([value, label, href]) => (
        <button
          type="button"
          key={value}
          lang={value === "zh" ? "zh-CN" : "en"}
          className={
            "ds-locale-toggle-item " + (locale === value ? "is-active" : "")
          }
          aria-pressed={locale === value}
          onClick={() => {
            document.cookie =
              "NEXT_LOCALE=" +
              value +
              "; path=/; max-age=31536000; SameSite=Lax";
            if (locale !== value)
              router.replace(
                href + window.location.search + window.location.hash,
              );
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
