import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { APP_ROUTES } from "@/app/navigation";
import { rentalDesktopHost } from "@/features/agent-desktop/desktop-host";
import { useAuthStore } from "@/features/auth/authStore";
import { RestContext } from "./RestContext";
import { RestExperience } from "./RestExperience";
import { createRestSession, restSecondsRemaining, type RestMinutes, type RestSession } from "./restSession";

/** One break belongs to the current authenticated AppShell. Ordinary navigation
 * preserves it; the existing account/tenant/workspace shell key tears it down. */
export function RestProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const eligible = useAuthStore(state => Boolean(state.sessionVerified && state.user && state.tenant && !state.user.isSaasAdmin));
  const available = eligible && pathname !== APP_ROUTES.aiOperator.path && !rentalDesktopHost();
  const [session, setSession] = useState<RestSession | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [finished, setFinished] = useState(false);
  const nextId = useRef(0);
  const entryRef = useRef<HTMLButtonElement>(null);
  const focusEntry = useCallback(() => { entryRef.current?.focus({ preventScroll: true }); }, []);
  const close = useCallback(() => {
    setSession(null);
    focusEntry();
  }, [focusEntry]);
  const minimize = useCallback(() => {
    setExpanded(false);
  }, []);
  const expand = useCallback(() => { setExpanded(true); }, []);
  const start = useCallback((minutes: RestMinutes) => {
    if (!available) return;
    const at = Date.now();
    setFinished(false);
    setNow(at);
    setSession(createRestSession(++nextId.current, minutes, at));
    setExpanded(true);
  }, [available]);

  useEffect(() => {
    if (!available) close();
  }, [available, close]);
  useEffect(() => {
    if (!session) return;
    // Recompute from the deadline after tab throttling or sleep; never decrement
    // a counter once per callback and silently extend the break.
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= session.endsAt) { setFinished(true); window.clearInterval(timer); }
    };
    const timer = window.setInterval(tick, 1000);
    const deadline = window.setTimeout(tick, Math.max(0, session.endsAt - Date.now()));
    window.addEventListener("pageshow", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(deadline);
      window.removeEventListener("pageshow", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [session]);

  const value = { available, session, remaining: session && !finished ? restSecondsRemaining(session, now) : 0,
    expanded, entryRef, start, close, minimize, expand };
  return <RestContext.Provider value={value}>
    {children}
    {available && session && <RestExperience key={session.id} />}
  </RestContext.Provider>;
}
