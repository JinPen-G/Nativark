import { useEffect, useState } from "react";
import { useLocale } from "@/app/locale";

/** Local device time only; no business polling or shell-wide refresh timer. */
export function WorkspaceClock() {
  const { locale } = useLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  return <time className="workspace-clock" dateTime={now.toISOString()}>
    <span className="workspace-clock-date">{new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(now)}<span aria-hidden="true"> · </span></span>
    <span>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now)}</span>
  </time>;
}
