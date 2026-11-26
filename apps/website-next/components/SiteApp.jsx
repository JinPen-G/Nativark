import { LocaleProvider } from "./LocaleProvider";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { LandingPage } from "./LandingPage";
import { DemoForm } from "./forms/DemoForm";
import { siteStructuredData } from "../lib/seo";
export function SiteApp({ locale }) {
  return (
    <LocaleProvider locale={locale} messages={locale === "en" ? en : zh}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteStructuredData(locale)).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage />
      <DemoForm />
    </LocaleProvider>
  );
}
