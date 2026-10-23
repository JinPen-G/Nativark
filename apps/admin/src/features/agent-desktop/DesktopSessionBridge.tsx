/** Projects the original authenticated navigation to Electron. No credentials, model access, or business commands cross this bridge. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentalCoreApi } from "@/api/rentalCore";
import type { RentalCategoryTerminology } from "@rental-os/shared";
import { useLocation, useNavigate } from "react-router-dom";
import { parseRentalDesktopCommand, type RentalDesktopCommandRequest, type RentalDesktopSession } from "@rental-os/shared";
import { APP_ROUTES, buildNavigationSections, canAccessRoute } from "@/app/navigation";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "@/app/categoryGovernancePreview";
import { rentalDesktopHost } from "./desktop-host";
import { desktopSessionProjection } from "./desktop-session-projection";

function projection(pathname: string, t: (value: string) => string, terminology?: RentalCategoryTerminology): RentalDesktopSession {
  return desktopSessionProjection(useAuthStore.getState(), {
    routes: APP_ROUTES, sections: buildNavigationSections,
    allowed: (route, state) => canAccessRoute(route, state.hasPermission, state.hasCapability, state.tenant?.categoryCode,
      Boolean(state.user?.isSaasAdmin), state.hasTenantMembershipPermission)
      && (CATEGORY_GOVERNANCE_PREVIEW_ENABLED || ![APP_ROUTES.platformCategories.path, APP_ROUTES.platformCategoryCapabilities.path].includes(route.path)),
  }, pathname, t, terminology);
}

export function DesktopSessionBridge() {
  const host = rentalDesktopHost();
  const state = useAuthStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [heartbeat, setHeartbeat] = useState(0);
  const categoryProfile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile,
    enabled: Boolean(host && state.ready && state.sessionVerified && state.user && !state.user.isSaasAdmin && state.currentWorkspaceId && (
      state.hasPermission("rental-os:order:view") || state.hasPermission("rental-core:catalog:view") || state.hasPermission("rental-core:asset:view"))) });
  const latest = useRef({ pathname, t, terminology: categoryProfile.data?.terminology });
  latest.current = { pathname, t, terminology: categoryProfile.data?.terminology };
  const busy = useRef(false);
  useEffect(() => {
    if (!host) return;
    let live = true;
    const report = () => Promise.resolve().then(() => host.report(projection(latest.current.pathname, latest.current.t, latest.current.terminology)));
    const completed = new Set<string>();
    const unavailable = () => host.report({ status: "unavailable" }).catch(() => undefined);
    const verify = () => useAuthStore.getState().bootstrap().then(() => {
      if (!live) return;
      const current = projection(latest.current.pathname, latest.current.t, latest.current.terminology);
      if (current.status === "ready" && /^\/login(?:\/|$)/u.test(latest.current.pathname)) navigate(current.defaultPath ?? "/", { replace: true });
      setHeartbeat(value => value + 1);
    }).catch(unavailable);
    const unsubscribeState = useAuthStore.subscribe((next, previous) => {
      if (previous.sessionVerified && !next.sessionVerified) {
        void report().catch(unavailable);
        if (next.token) void verify();
      }
    });
    const handle = async (request: RentalDesktopCommandRequest) => {
      if (!live || busy.current || completed.has(request.id)) { await host.complete({ id: request.id, ok: false }); return; }
      completed.add(request.id);
      if (completed.size > 256) completed.delete(completed.values().next().value!);
      busy.current = true;
      let ok = false;
      try {
        const command = parseRentalDesktopCommand(request.command);
        const before = useAuthStore.getState();
        if (command.kind === "revalidate") {
          await before.bootstrap();
          ok = true;
        } else if (before.ready && before.sessionVerified && before.token && before.user && !before.user.mustChangePassword) {
          if (!request.session || request.session.actorId !== before.user.id || request.session.tenantId !== before.tenant?.tenantId
            || request.session.workspaceId !== (before.currentWorkspaceId ?? null)) throw new Error("Business session changed");
          if (command.kind === "logout") {
            if (!window.dispatchEvent(new Event("rental-desktop-before-session-change", { cancelable: true }))) throw new Error("Finish editing before logout");
            before.logout(); navigate("/login", { replace: true }); ok = true;
          } else if (command.kind === "switch-workspace") {
            if (command.workspaceId === before.currentWorkspaceId) { ok = true; return; }
            if (!window.dispatchEvent(new Event("rental-desktop-before-session-change", { cancelable: true }))) throw new Error("Finish editing before switching workspace");
            if (!before.workspaces.some(row => row.id === command.workspaceId)) throw new Error("Workspace unavailable");
            await before.switchWorkspace(command.workspaceId);
            const next = projection(latest.current.pathname, latest.current.t, latest.current.terminology);
            if (next.status === "ready") navigate(next.defaultPath ?? "/", { replace: true });
            ok = true;
          } else if (command.kind === "navigate") {
            const routeId = command.routeId;
            const current = projection(latest.current.pathname, latest.current.t, latest.current.terminology);
            const target = current.status === "ready" ? current.sections.flatMap(section => section.items).find(item => item.id === routeId) : undefined;
            if (!target) throw new Error("Route unavailable");
            navigate(target.path); ok = true;
          }
        }
        await report();
      } catch {
        // The original login/page surfaces own detailed diagnostics; IPC never echoes raw errors or credentials.
        ok = false;
      } finally {
        busy.current = false;
        if (live) await host.complete({ id: request.id, ok });
      }
    };
    const unsubscribe = host.onCommand(request => { void handle(request).catch(unavailable); });
    void verify();
    // The Host revokes admission if this owned page stops responding, including while hidden behind AI mode.
    const timer = window.setInterval(() => { if (!busy.current) void verify(); }, 20_000);
    return () => { live = false; unsubscribe(); unsubscribeState(); window.clearInterval(timer); };
  }, [host, navigate]);
  useEffect(() => {
    if (host) void Promise.resolve().then(() => host.report(projection(pathname, t, categoryProfile.data?.terminology))).catch(() => {
      // Invalid navigation or a destroyed native view cannot retain an earlier valid menu.
      return host.report({ status: "unavailable" }).catch(() => undefined);
    });
  }, [host, state, pathname, t, categoryProfile.data?.terminology, heartbeat]);
  return null;
}
