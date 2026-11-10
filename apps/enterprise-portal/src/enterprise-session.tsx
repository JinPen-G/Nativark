/** Enterprise Web host. URL and cached session only locate requests;
 * server entry permissions own the view. Identity changes cancel old readers. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientMembershipSessionResponse, EnterpriseEntryResponse } from "@rental-os/shared";
import { customerFetch, customerSessionGeneration, loadCustomerSession, parseCustomerResponse, parseEnterpriseRoute, logoutCustomerSession, subscribeCustomerSession } from "@rental-os/web-client";
export const CLIENT_BASE = "/api/client/v1";
const offline = import.meta.env.MODE === "offline";
interface EnterpriseContextValue {
  tenantCode: string; tenantName: string; basePath: string; domainBound: boolean;
  session: ClientMembershipSessionResponse | null; entry?: EnterpriseEntryResponse;
  loading: boolean; error: string; identity: string; signal: AbortSignal;
  selectedCorporateId: string; selectCorporate: (id: string) => void;
  reload: () => void; logout: () => Promise<void>;
  read: <T>(path: string, signal?: AbortSignal) => Promise<T>;
  write: <T>(path: string, body: unknown, method?: "POST" | "PUT") => Promise<T>;
}
const Context = createContext<EnterpriseContextValue | null>(null);
export function EnterpriseSessionProvider({ children }: { children: ReactNode }) {
  const route = parseEnterpriseRoute(window.location.pathname);
  const [tenantCode, setTenantCode] = useState(route?.tenantCode ?? "");
  const [tenantName, setTenantName] = useState("");
  const [session, setSessionState] = useState<ClientMembershipSessionResponse | null>(null);
  const [entry, setEntry] = useState<EnterpriseEntryResponse>();
  const [selection, setSelection] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [generation, setGeneration] = useState("");
  const owner = useRef(new AbortController());
  const [signal, setSignal] = useState(owner.current.signal);
  const cancelReaders = () => { owner.current.abort(); owner.current = new AbortController(); setSignal(owner.current.signal); };
  const invalidate = () => { cancelReaders(); setEntry(undefined); setSelection(""); };
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setLoading(true);
    void (async () => {
      if (!route) throw new Error("请从当前商户的企业服务入口进入");
      if (offline) throw new Error("enterprise_offline");
      let code = route.tenantCode;
      if (!route.boundDomain) {
        const configuredHosts = (import.meta.env.VITE_ENTERPRISE_PUBLIC_HOSTS ?? "").split(",").map((host: string) => host.trim().toLowerCase()).filter(Boolean);
        const host = window.location.hostname.toLowerCase();
        if (!configuredHosts.includes(host) && !(import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(host))) throw new Error("此域名未登记为公共商户入口");
      }
      if (route.boundDomain) {
        const resolved = await fetch(`${CLIENT_BASE}/public/site-resolve?host=${encodeURIComponent(window.location.hostname)}`, { signal: controller.signal });
        const binding = await parseCustomerResponse<{ tenantCode: string | null }>(resolved);
        if (!binding.tenantCode) throw new Error("此域名未绑定已启用的商户网站");
        code = binding.tenantCode;
      }
      if (!code) throw new Error("商户入口不可用");
      const response = await fetch(`${CLIENT_BASE}/tenants/${encodeURIComponent(code)}/workspaces`, { signal: controller.signal });
      const tenant = await parseCustomerResponse<{ tenantCode: string; tenantName: string }>(response);
      if (tenant.tenantCode !== code) throw new Error("商户入口不一致");
      if (!controller.signal.aborted) { setTenantCode(code); setTenantName(tenant.tenantName); setLoading(false); }
    })().catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "商户服务读取失败"); setLoading(false); } });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!tenantCode || !tenantName) return;
    const changed = () => { invalidate(); setSessionState(loadCustomerSession(tenantCode)); setGeneration(customerSessionGeneration(tenantCode)); };
    changed();
    return subscribeCustomerSession(tenantCode, changed);
  }, [tenantCode, tenantName]);
  useEffect(() => {
    if (!session || !tenantName || offline) { if (!session && tenantName) setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    void customerFetch(tenantCode, CLIENT_BASE, `/enterprise/entry?tenantCode=${encodeURIComponent(tenantCode)}`, { signal: controller.signal })
      .then(parseCustomerResponse<EnterpriseEntryResponse>).then(result => {
        if (!controller.signal.aborted) { setEntry(result); setLoading(false); }
      }).catch(e => { if (!controller.signal.aborted) { setEntry(undefined); setError(e instanceof Error ? e.message : "企业权限读取失败"); setLoading(false); } });
    return () => controller.abort();
  }, [session, generation, tenantCode, tenantName, revision]);
  useEffect(() => () => owner.current.abort(), []);
  const selectedCorporateId = entry?.corporates.some(c => c.corporateCustomerId === selection) ? selection : entry?.corporates.length === 1 ? entry.corporates[0].corporateCustomerId : "";
  const selectCorporate = (id: string) => {
    if (!entry?.corporates.some(c => c.corporateCustomerId === id)) throw new Error("当前企业不可访问");
    cancelReaders(); setSelection(id);
  };
  const identity = JSON.stringify([tenantCode, session?.customer.customerId, generation, selectedCorporateId, entry?.corporates.map(c => [c.corporateCustomerId, c.permissionRevision])]);
  const read = async <T,>(path: string, requestSignal?: AbortSignal): Promise<T> => {
    if (offline) throw new Error("未连接企业服务");
    return parseCustomerResponse(await customerFetch(tenantCode, CLIENT_BASE, path, { signal: requestSignal ?? owner.current.signal }));
  };
  const write = async <T,>(path: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<T> => {
    if (offline) throw new Error("未连接企业服务");
    return parseCustomerResponse(await customerFetch(tenantCode, CLIENT_BASE, path, { method, body: JSON.stringify(body), signal: owner.current.signal }, false));
  };
  const logout = async () => {
    invalidate();
    if (offline) throw new Error("未连接企业服务");
    try { await logoutCustomerSession(tenantCode, CLIENT_BASE); }
    catch (e) { setError(e instanceof Error ? e.message : "会话撤销结果待核对"); throw e; }
  };
  return <Context.Provider value={{ tenantCode, tenantName, basePath: route?.basePath ?? "/enterprise", domainBound: route?.boundDomain ?? false,
    session, entry, loading, error, identity, signal, selectedCorporateId, selectCorporate, read, write, logout, reload: () => { invalidate(); setRevision(r => r + 1); } }}>{children}</Context.Provider>;
}
export function useEnterprise() { const value = useContext(Context); if (!value) throw new Error("Enterprise session host is required"); return value; }
