/** Shared tenant artwork, with independent site and browser-tab contrast.
 * Stale SVG inspections are ignored; favicon failures cannot change the sidebar logo. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuthStore } from "@/features/auth/authStore";
import { useAppearance } from "./theme";
import { ADMIN_DEFAULT_MARK, applyAdminFavicon, resolveAdminMark } from "./branding";
import { adaptMonochromeBrandSvg, defaultAdminBrandIcon, isSvgBrandIcon, readBrandSvg, safeBrandIconUrl } from "./brandIcon";

const BrandIconContext = createContext({ src: ADMIN_DEFAULT_MARK, isPlatformMark: true, onError: () => {} });
export const useAdminBrandIcon = () => useContext(BrandIconContext);

export function BrandIconProvider({ children }: { children: ReactNode }) {
  const tenant = useAuthStore(state => state.tenant);
  const user = useAuthStore(state => state.user);
  const { mode } = useAppearance();
  const source = safeBrandIconUrl(resolveAdminMark(tenant, user)) ?? ADMIN_DEFAULT_MARK;
  const scope = JSON.stringify([user?.id, user?.isSaasAdmin, tenant?.tenantId, source]);
  const [inspection, setInspection] = useState<{ scope: string; svg?: string }>();
  const [failedScope, setFailedScope] = useState<string>();
  const [faviconFailedScope, setFaviconFailedScope] = useState<string>();
  const [browserDark, setBrowserDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const fallback = useMemo(() => defaultAdminBrandIcon(mode === "dark"), [mode]);
  useEffect(() => {
    // Browser chrome can remain light while the operator chooses a dark site theme.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setBrowserDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
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
      isPlatformMark: source === ADMIN_DEFAULT_MARK || failedScope === scope,
      onError: () => { if (source !== ADMIN_DEFAULT_MARK) setFailedScope(scope); } };
  }, [source, scope, inspection, failedScope, fallback, mode]);
  const favicon = useMemo(() => {
    const original = source === ADMIN_DEFAULT_MARK || faviconFailedScope === scope ? defaultAdminBrandIcon(browserDark) : source;
    const svg = inspection?.scope === scope && faviconFailedScope !== scope ? inspection.svg : undefined;
    return svg ? adaptMonochromeBrandSvg(svg, browserDark) ?? original : original;
  }, [source, scope, inspection, faviconFailedScope, browserDark]);
  useEffect(() => applyAdminFavicon(favicon, () => {
    if (source !== ADMIN_DEFAULT_MARK) setFaviconFailedScope(scope);
  }), [favicon, source, scope]);
  return <BrandIconContext.Provider value={icon}>{children}</BrandIconContext.Provider>;
}
