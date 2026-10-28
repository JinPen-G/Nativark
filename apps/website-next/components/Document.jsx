import "../styles/foundation.css";
import "../styles/site.css";
import "../styles/consent.css";
import "../styles/demos.css";
import "../styles/dropdown.css";
import "../styles/rentalos.css";
import "../styles/integrations.css";
export function SiteDocument({ locale, children }) {
  // Match the original site's root-only tolerance for browser extension attributes.
  // Hydration checks inside the page remain enabled.
  return (
    <html lang={locale === "en" ? "en" : "zh-CN"} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
