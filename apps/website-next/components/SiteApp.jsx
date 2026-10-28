import { LocaleProvider } from "./LocaleProvider";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { LandingPage } from "./LandingPage";
import { DemoForm } from "./forms/DemoForm";
import { LanguageBootstrap } from "./LanguageBootstrap";
export function SiteApp({ locale }) {
  return (
    <LocaleProvider locale={locale} messages={locale === "en" ? en : zh}>
      <LanguageBootstrap locale={locale} />
      <LandingPage />
      <DemoForm />
    </LocaleProvider>
  );
}
