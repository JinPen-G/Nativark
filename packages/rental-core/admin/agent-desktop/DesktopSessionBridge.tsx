/** Projects original navigation and closed, policy-checked read results. Credentials stay in the Web request client. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RentalCategoryTerminology } from "@rental-os/rental-core";
import { useLocation, useNavigate } from "react-router-dom";
import { parseRentalDesktopCommand, type RentalDesktopCommandRequest, type RentalDesktopSession } from "@rental-os/shared/agent-desktop";
import { parseRentalDesktopBusinessReadRequest, type RentalDesktopBusinessReadRequest, type RentalDesktopBusinessFailureCode } from '@rental-os/shared/agent-desktop';
import { useLocale } from "@rental-os/platform-admin/locale";
import { useRentalDesktopContext, type RentalDesktopContext } from "./page-context";
import type { DesktopNavigationSource } from "./desktop-session-projection";
import { rentalDesktopHost } from "./desktop-host";
import { desktopSessionProjection } from "./desktop-session-projection";

function projection(desktop: RentalDesktopContext, navigation: DesktopNavigationSource, pathname: string, t: (value: string) => string, terminology?: RentalCategoryTerminology): RentalDesktopSession {
  return desktopSessionProjection(desktop.session.useAuthStore.getState(), navigation, pathname, t, terminology);
}

export function DesktopSessionBridge() {
  const desktop = useRentalDesktopContext();
  const { session: { useAuthStore }, readDesktopBusinessCatalog, profile } = desktop;
  const navigation = desktop.useNavigation();
  const host = rentalDesktopHost();
  const state = useAuthStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [heartbeat, setHeartbeat] = useState(0);
  const categoryProfile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: profile,
    enabled: Boolean(host && state.ready && state.sessionVerified && state.user && !state.user.isSaasAdmin && state.currentWorkspaceId && (
      state.hasPermission("rental-os:order:view") || state.hasPermission("rental-core:catalog:view") || state.hasPermission("rental-core:asset:view"))) });
  const latest = useRef({ pathname, t, terminology: categoryProfile.data?.terminology, navigation });
  latest.current = { pathname, t, terminology: categoryProfile.data?.terminology, navigation };
  const busy = useRef(false);
  useEffect(() => {
    if (!host) return;
    let live = true;
    const report = () => Promise.resolve().then(() => {
      if (live) return host.report(projection(desktop, latest.current.navigation, latest.current.pathname, latest.current.t, latest.current.terminology));
    });
    const completed = new Set<string>();
    const unavailable = () => live ? host.report({ status: "unavailable" }).catch(() => undefined) : Promise.resolve();
    const verify = () => useAuthStore.getState().bootstrap().then(async () => {
      if (!live) return;
      const current = projection(desktop, latest.current.navigation, latest.current.pathname, latest.current.t, latest.current.terminology);
      if (current.status === "ready" && /^\/login(?:\/|$)/u.test(latest.current.pathname)) await navigate(current.defaultPath ?? "/", { replace: true, flushSync: true });
      if (live) setHeartbeat(value => value + 1);
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
        const current = (workspaceId: string | null) => {
          const next = useAuthStore.getState();
          if (!live || !next.ready || !next.sessionVerified || !next.token || !next.user || next.user.mustChangePassword
            || !request.session || next.user.id !== request.session.actorId || next.tenant?.tenantId !== request.session.tenantId
            || Boolean(next.user.isSaasAdmin) !== Boolean(before.user?.isSaasAdmin)
            || (next.currentWorkspaceId ?? null) !== workspaceId) throw new Error("Business session changed");
          return projection(desktop, latest.current.navigation, latest.current.pathname, latest.current.t, latest.current.terminology);
        };
        if (command.kind === "revalidate") {
          await before.bootstrap();
          ok = live && projection(desktop, latest.current.navigation, latest.current.pathname, latest.current.t, latest.current.terminology).status !== "unavailable";
        } else if (before.ready && before.sessionVerified && before.token && before.user && !before.user.mustChangePassword) {
          if (!request.session || request.session.actorId !== before.user.id || request.session.tenantId !== before.tenant?.tenantId
            || request.session.workspaceId !== (before.currentWorkspaceId ?? null)) throw new Error("Business session changed");
          if (command.kind === "logout") {
            if (!window.dispatchEvent(new Event("rental-desktop-before-session-change", { cancelable: true }))) throw new Error("Finish editing before logout");
            await before.logout();
            await navigate("/login", { replace: true, flushSync: true });
            ok = live && projection(desktop, latest.current.navigation, latest.current.pathname, latest.current.t, latest.current.terminology).status === "signed-out";
          } else if (command.kind === "switch-workspace") {
            if (command.workspaceId !== before.currentWorkspaceId) {
              if (!window.dispatchEvent(new Event("rental-desktop-before-session-change", { cancelable: true }))) throw new Error("Finish editing before switching workspace");
              if (!before.workspaces.some(row => row.id === command.workspaceId)) throw new Error("Workspace unavailable");
              await before.switchWorkspace(command.workspaceId);
              const next = current(command.workspaceId);
              if (next.status !== "ready") throw new Error("Workspace unavailable");
              await navigate(next.defaultPath ?? "/", { replace: true, flushSync: true });
            }
            ok = current(command.workspaceId).status === "ready";
          } else if (command.kind === "navigate") {
            const routeId = command.routeId;
            const projected = projection(desktop, latest.current.navigation, latest.current.pathname, latest.current.t, latest.current.terminology);
            const target = projected.status === "ready" ? projected.sections.flatMap(section => section.items).find(item => item.id === routeId) : undefined;
            if (!target) throw new Error("Route unavailable");
            await navigate(target.path, { flushSync: true });
            const after = current(request.session.workspaceId);
            ok = after.status === "ready" && after.pathname === target.path
              && after.sections.some(section => section.items.some(item => item.id === routeId && item.path === target.path));
          }
        }
      } catch {
        // The original login/page surfaces own detailed diagnostics; IPC never echoes raw errors or credentials.
        ok = false;
      } finally {
        busy.current = false;
        if (live) {
          try { await report(); }
          catch { ok = false; }
          if (live) await host.complete({ id: request.id, ok });
        }
      }
    };
    const unsubscribe = host.onCommand(request => { void handle(request).catch(unavailable); });
    const catalogReads = new Map<string, AbortController>();
    const catalogContext = (request: RentalDesktopBusinessReadRequest) => {
      const current = useAuthStore.getState();
      if (!live || !current.ready || !current.sessionVerified || !current.token || current.user?.mustChangePassword || current.user?.isSaasAdmin
        || current.user?.id !== request.binding.actorId || current.tenant?.tenantId !== request.binding.tenantId
        || current.currentWorkspaceId !== request.binding.workspaceId) throw new Error('AI_SCOPE_CHANGED');
    };
    const handleCatalog = async (value: RentalDesktopBusinessReadRequest) => {
      if (!host.completeCatalog) return;
      const request = parseRentalDesktopBusinessReadRequest(value);
      const controller = new AbortController();
      let timer: number | undefined;
      try {
        if (busy.current || catalogReads.size >= 2 || completed.has(request.id)) throw new Error('AI_RESOURCE_UNAVAILABLE');
        catalogContext(request);
        completed.add(request.id);
        if (completed.size > 256) completed.delete(completed.values().next().value!);
        catalogReads.set(request.id, controller);
        timer = window.setTimeout(() => controller.abort(), 12_000);
        const result = await readDesktopBusinessCatalog(request, controller.signal);
        catalogContext(request);
        if (controller.signal.aborted) throw new Error('AI_RESOURCE_UNAVAILABLE');
        await host.completeCatalog({ id: request.id, ok: true, result });
      } catch (error) {
        const codes: RentalDesktopBusinessFailureCode[] = ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_INVALID_INPUT', 'AI_RESOURCE_UNAVAILABLE'];
        const raw = error instanceof Error ? error.message : undefined;
        const code = codes.find(code => code === raw) ?? 'AI_RESOURCE_UNAVAILABLE';
        if (live) await host.completeCatalog({ id: request.id, ok: false, code });
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
        if (catalogReads.get(request.id) === controller) catalogReads.delete(request.id);
      }
    };
    const unsubscribeCatalog = host.onCatalog?.(value => { void handleCatalog(value).catch(unavailable); });
    const unsubscribeCatalogIdentity = useAuthStore.subscribe((next, previous) => {
      if (!next.sessionVerified || next.user?.id !== previous.user?.id || next.tenant?.tenantId !== previous.tenant?.tenantId
        || next.currentWorkspaceId !== previous.currentWorkspaceId) for (const controller of catalogReads.values()) controller.abort();
    });
    void verify();
    // The Host revokes admission if this owned page stops responding, including while hidden behind AI mode.
    const timer = window.setInterval(() => { if (!busy.current) void verify(); }, 20_000);
    return () => {
      live = false; unsubscribe(); unsubscribeState(); unsubscribeCatalog?.(); unsubscribeCatalogIdentity(); window.clearInterval(timer);
      for (const controller of catalogReads.values()) controller.abort();
      catalogReads.clear();
    };
  }, [host, navigate, desktop, useAuthStore, readDesktopBusinessCatalog]);
  useEffect(() => {
    if (host) void Promise.resolve().then(() => host.report(projection(desktop, navigation, pathname, t, categoryProfile.data?.terminology))).catch(() => {
      // Invalid navigation or a destroyed native view cannot retain an earlier valid menu.
      return host.report({ status: "unavailable" }).catch(() => undefined);
    });
  }, [host, state, pathname, t, categoryProfile.data?.terminology, heartbeat, desktop, navigation]);
  return null;
}
