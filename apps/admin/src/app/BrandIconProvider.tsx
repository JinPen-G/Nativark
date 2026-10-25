/** One tenant/theme-aware image source for sidebar identity and the browser tab.
 * Tenant/session changes ignore stale SVG inspections; failures share the default fallback. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuthStore } from "@/features/auth/authStore";
import { useAppearance } from "./theme";
import { ADMIN_DEFAULT_MARK, applyAdminFavicon, resolveAdminMark } from "./branding";
import { adaptMonochromeBrandSvg, defaultAdminBrandIcon, isSvgBrandIcon, readBrandSvg, safeBrandIconUrl } from "./brandIcon";

const BrandIconContext = createContext({ src: ADMIN_DEFAULT_MARK, onError: () => {} });
export const useAdminBrandIcon = () => useContext(BrandIconContext);

export function BrandIconProvider({ children }: { children: ReactNode }) {
  const tenant = useAuthStore(state => state.tenant);
  const user = useAuthStore(state => state.user);
  const { mode } = useAppearance();
  const source = safeBrandIconUrl(resolveAdminMark(tenant, user)) ?? ADMIN_DEFAULT_MARK;
  const scope = JSON.stringify([user?.id, user?.isSaasAdmin, tenant?.tenantId, source]);
  const [inspection, setInspection] = useState<{ scope: string; svg?: string }>();
  const [failedScope, setFailedScope] = useState<string>();
  const fallback = useMemo(() => defaultAdminBrandIcon(mode === "dark"), [mode]);
  useEffect(() => {
    if (source === ADMIN_DEFAULT_MARK || !isSvgBrandIcon(source)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    void readBrandSvg(source, controller.signal).then(svg => {
      if (!controller.signal.aborted) setInspection({ scope, svg });
    }).catch(() => { /* CORS/complex SVG retains the original image source. */ }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [source, scope]);
  const icon = useMemo(() => {
    const original = source === ADMIN_DEFAULT_MARK || failedScope === scope ? fallback : source;
    const svg = inspection?.scope === scope && failedScope !== scope ? inspection.svg : undefined;
    return { src: svg ? adaptMonochromeBrandSvg(svg, mode === "dark") ?? original : original,
      onError: () => { if (source !== ADMIN_DEFAULT_MARK) setFailedScope(scope); } };
  }, [source, scope, inspection, failedScope, fallback, mode]);
  useEffect(() => applyAdminFavicon(icon.src, icon.onError), [icon]);
  return <BrandIconContext.Provider value={icon}>{children}</BrandIconContext.Provider>;
}
