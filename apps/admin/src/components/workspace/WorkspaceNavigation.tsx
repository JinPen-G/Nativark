/** Sidebar-only route snapshots. React keeps one live page; snapshots never
 * retain another page's forms, effects or business requests. Stack geometry is
 * adapted from Animate UI PageTransition (source/permission in sources.json).
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import "./WorkspaceNavigation.css";

const NavigationContext = createContext({ suppressPageEnter: false, ready: (_path: string) => {} });
export const WorkspaceNavigationProvider = NavigationContext.Provider;
export function useWorkspaceEntry() { return useContext(NavigationContext).suppressPageEnter; }

/** Inside Suspense: resolve only after the destination's route module commits,
 * not when the lazy-loading fallback first replaces the old page. */
export function WorkspaceRouteReady({ children }: { children: ReactNode }) {
  const { pathname } = useLocation(), { ready } = useContext(NavigationContext);
  useLayoutEffect(() => { ready(pathname); }, [pathname, ready]);
  return children;
}

type Capture = { finished: Promise<void>; skipTransition: () => void };
type Pending = { target: string; from: string; release: () => void };
const ROOT_MARK = "data-workspace-navigation";

export function useWorkspaceNavigation(container: RefObject<HTMLElement | null>) {
  const navigate = useNavigate(), { pathname } = useLocation(), reduced = useReducedMotion();
  const owner = useId();
  const [running, setRunning] = useState(false);
  const mounted = useRef(true), generation = useRef(0), navigationRequest = useRef(0);
  const capture = useRef<Capture | null>(null), pending = useRef<Pending | null>(null);
  const restore = useRef<(() => void) | null>(null), deadline = useRef<number | undefined>(undefined);
  const stop = useCallback(() => {
    ++generation.current;
    capture.current?.skipTransition(); capture.current = null;
    pending.current?.release(); pending.current = null;
    window.clearTimeout(deadline.current); deadline.current = undefined;
    restore.current?.(); restore.current = null;
    if (document.documentElement.getAttribute(ROOT_MARK) === owner) document.documentElement.removeAttribute(ROOT_MARK);
    if (mounted.current) setRunning(false);
  }, [owner]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) stop(); };
    window.addEventListener("resize", stop);
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; ++navigationRequest.current; stop(); window.removeEventListener("resize", stop); document.removeEventListener("visibilitychange", hide); };
  }, [stop]);

  const ready = useCallback((path: string) => {
    const waiting = pending.current;
    if (!waiting) return;
    if (path === waiting.target) {
      container.current?.scrollTo({ top: 0, left: 0 });
      waiting.release(); pending.current = null;
    } else if (path !== waiting.from) stop(); // Redirect/another navigation wins.
  }, [container, stop]);

  const fromSidebar = useCallback((target: string) => {
    const request = ++navigationRequest.current;
    stop();
    const node = container.current;
    // Existing dialogs (including mobile navigation) own their own exit. Never
    // freeze them into a page snapshot or interrupt a theme transition.
    const externalTransition = (document as Document & { activeViewTransition?: Capture }).activeViewTransition;
    if (!node || target === pathname || reduced || !document.startViewTransition || document.hidden
      || document.querySelector('[role="dialog"]') || externalTransition) {
      navigate(target); return;
    }
    const version = generation.current;
    const root = document.documentElement;
    const wasInert = node.inert;
    node.inert = true;
    node.setAttribute("data-workspace-page-transition", "");
    root.setAttribute(ROOT_MARK, owner);
    restore.current = () => { node.inert = wasInert; node.removeAttribute("data-workspace-page-transition"); };
    setRunning(true);
    const committed = new Promise<void>(release => { pending.current = { target, from: pathname, release }; });
    try {
      const transition = document.startViewTransition(async () => {
        // Resize/hiding cancels only the animation. It must not eat an accepted
        // click before the browser runs this callback; only a newer click wins.
        if (!mounted.current || navigationRequest.current !== request) return;
        navigate(target);
        await committed;
      });
      capture.current = transition;
      // Slow modules/errors must never hold the document's rendering lock.
      deadline.current = window.setTimeout(() => { if (generation.current === version) stop(); }, 2000);
      void transition.finished.catch(() => {}).finally(() => { if (generation.current === version) stop(); });
    } catch {
      stop(); navigate(target);
    }
  }, [container, navigate, owner, pathname, reduced, stop]);

  return { fromSidebar, context: useMemo(() => ({ suppressPageEnter: running, ready }), [running, ready]) };
}
