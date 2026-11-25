/** Enterprise Web host. Server entry permissions own the view. Identity changes,
 * hidden pages and authority rereads cancel readers while retaining original operations. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientMembershipSessionResponse } from "../../src/client-contracts";
import type { EnterpriseEntryResponse } from "../../src/enterprise";
import { customerSessionGeneration, loadCustomerSession, parseCustomerResponse, parseEnterpriseRoute, logoutCustomerSession, subscribeCustomerSession, switchCustomerWorkspace } from "@rental-os/web-client";
import { CLIENT_BASE, createEnterpriseBusinessClient, readEnterpriseEntry, type EnterpriseBusinessClient } from "./client";

export interface EnterpriseSessionOptions {
  offline: boolean;
  publicHosts: string[];
  development: boolean;
}
export interface EnterpriseContextValue extends EnterpriseBusinessClient {
  tenantCode: string; tenantName: string; basePath: string; domainBound: boolean;
  session: ClientMembershipSessionResponse | null; entry?: EnterpriseEntryResponse;
  loading: boolean; error: string; identity: string; signal: AbortSignal;
  selectedCorporateId: string; selectCorporate: (id: string) => void;
  selectWorkspace: (workspaceCode: string) => Promise<void>;
  reload: () => void; logout: () => Promise<void>;
}
const Context = createContext<EnterpriseContextValue | null>(null);
export function EnterpriseSessionProvider({ children, offline, publicHosts, development }: EnterpriseSessionOptions & { children: ReactNode }) {
  const route = parseEnterpriseRoute(window.location.pathname);
  const [tenantCode, setTenantCode] = useState(route?.tenantCode ?? "");
  const [tenantName, setTenantName] = useState("");
  const [session, setSessionState] = useState<ClientMembershipSessionResponse | null>(null);
  const [entry, setEntry] = useState<EnterpriseEntryResponse>();
  const [selection, setSelection] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [generation, setGeneration] = useState("");
  const [accessRevision, setAccessRevision] = useState(0);
  const owner = useRef(new AbortController());
  const revalidating = useRef(false);
  const switchingWorkspace = useRef(false);
  const deniedAccessScope = useRef("");
  const [signal, setSignal] = useState(owner.current.signal);
  const cancelReaders = () => { owner.current.abort(); owner.current = new AbortController(); setSignal(owner.current.signal); };
  const invalidate = (preserveSelection = false) => {
    cancelReaders(); revalidating.current = false; setEntry(undefined); setLoading(true);
    if (!preserveSelection) setSelection("");
  };
  const synchronizeSession = () => {
    invalidate(); setSessionState(loadCustomerSession(tenantCode)); setGeneration(customerSessionGeneration(tenantCode));
  };
  const suspendAccess = () => { cancelReaders(); revalidating.current = false; setLoading(true); };
  const revalidateAccess = () => {
    if (!tenantName || offline || document.visibilityState === "hidden") return;
    if (switchingWorkspace.current) return;
    if (customerSessionGeneration(tenantCode) !== generation) { synchronizeSession(); return; }
    if (!session || revalidating.current) return;
    suspendAccess(); revalidating.current = true; setAccessRevision(current => current + 1);
  };
  useEffect(() => {
    if (owner.current.signal.aborted) {
      owner.current = new AbortController(); setSignal(owner.current.signal);
    }
    return () => owner.current.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const requestOwner = owner.current;
    const requestSignal = AbortSignal.any([controller.signal, requestOwner.signal]);
    setError(""); setLoading(true);
    void (async () => {
      if (!route) throw new Error("请从当前商户的企业服务入口进入");
      if (offline) throw new Error("enterprise_offline");
      if (document.visibilityState === "hidden") return;
      let code = route.tenantCode;
      if (!route.boundDomain) {
        const configuredHosts = publicHosts.map(host => host.trim().toLowerCase()).filter(Boolean);
        const host = window.location.hostname.toLowerCase();
        if (!configuredHosts.includes(host) && !(development && ["localhost", "127.0.0.1"].includes(host))) throw new Error("此域名未登记为公共商户入口");
      }
      if (route.boundDomain) {
        const resolved = await fetch(`${CLIENT_BASE}/public/site-resolve?host=${encodeURIComponent(window.location.hostname)}`, { signal: requestSignal });
        const binding = await parseCustomerResponse<{ tenantCode: string | null }>(resolved);
        if (!binding.tenantCode) throw new Error("此域名未绑定已启用的商户网站");
        code = binding.tenantCode;
      }
      if (!code) throw new Error("商户入口不可用");
      const response = await fetch(`${CLIENT_BASE}/tenants/${encodeURIComponent(code)}/workspaces`, { signal: requestSignal });
      const tenant = await parseCustomerResponse<{ tenantCode: string; tenantName: string }>(response);
      if (tenant.tenantCode !== code) throw new Error("商户入口不一致");
      if (!requestSignal.aborted && owner.current === requestOwner) { setTenantCode(code); setTenantName(tenant.tenantName); setLoading(false); }
    })().catch(e => { if (!requestSignal.aborted && owner.current === requestOwner) { setError(e instanceof Error ? e.message : "商户服务读取失败"); setLoading(false); } });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!tenantCode || !tenantName) return;
    const changed = () => synchronizeSession();
    changed();
    return subscribeCustomerSession(tenantCode, changed);
  }, [tenantCode, tenantName]);
  useEffect(() => {
    if (!session || !tenantName || offline || document.visibilityState === "hidden") { if (!session && tenantName && document.visibilityState !== "hidden") setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    const requestOwner = owner.current;
    const requestSignal = AbortSignal.any([controller.signal, requestOwner.signal]);
    revalidating.current = true;
    void readEnterpriseEntry(tenantCode, session.customer.customerId, generation, requestSignal).then(result => {
        if (requestSignal.aborted || owner.current !== requestOwner) return;
        revalidating.current = false; setEntry(result); setLoading(false);
      }).catch(e => { if (!requestSignal.aborted && owner.current === requestOwner) { revalidating.current = false; setEntry(undefined); setError(e instanceof Error ? e.message : "企业权限读取失败"); setLoading(false); } });
    return () => controller.abort();
  }, [session, generation, tenantCode, tenantName, revision, accessRevision]);
  useEffect(() => {
    if (offline) return;
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      if (!tenantName) { invalidate(); setRevision(current => current + 1); }
      else if (session || customerSessionGeneration(tenantCode) !== generation) revalidateAccess();
      else setLoading(false);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") suspendAccess();
      else resume();
    };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", restored);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", restored);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session, generation, tenantCode, tenantName]);
  const selectedCorporateId = entry?.corporates.some(c => c.corporateCustomerId === selection) ? selection : entry?.corporates.length === 1 ? entry.corporates[0].corporateCustomerId : "";
  const selectCorporate = (id: string) => {
    if (loading || document.visibilityState === "hidden" || renderOwner.signal.aborted || owner.current !== renderOwner) throw new Error("当前企业选择已失效");
    if (!entry?.corporates.some(c => c.corporateCustomerId === id)) throw new Error("当前企业不可访问");
    cancelReaders(); setSelection(id);
  };
  const identity = JSON.stringify([tenantCode, session?.customer.customerId, generation, selectedCorporateId, entry?.corporates.map(c => [c.corporateCustomerId, c.membershipId, c.permissionRevision, c.actions]), revision]);
  const accessScope = JSON.stringify([tenantCode, session?.customer.customerId, generation, session?.workspace?.workspaceCode, selectedCorporateId, entry?.corporates.map(c => [c.corporateCustomerId, c.permissionRevision])]);
  const renderOwner = owner.current;
  const selectWorkspace = async (workspaceCode: string) => {
    if (!session || loading || switchingWorkspace.current || document.visibilityState === "hidden"
      || renderOwner.signal.aborted || owner.current !== renderOwner || customerSessionGeneration(tenantCode) !== generation
      || !session.workspaces.some(workspace => workspace.workspaceCode === workspaceCode)) throw new Error("当前客户服务选择已失效");
    if (workspaceCode === session.workspace?.workspaceCode) return;
    switchingWorkspace.current = true; suspendAccess();
    try { await switchCustomerWorkspace(tenantCode, CLIENT_BASE, workspaceCode); }
    finally {
      switchingWorkspace.current = false;
      // A failed switch keeps the original session. Reread its current grants
      // without repeating the authentication command or applying the target locally.
      if (customerSessionGeneration(tenantCode) === generation) revalidateAccess();
    }
  };
  const { read, write } = createEnterpriseBusinessClient({
    tenantCode, generation, signal: renderOwner.signal, offline,
    isCurrent: () => !loading && document.visibilityState !== "hidden" && owner.current === renderOwner,
    onAccessDenied: error => {
      // One current-authority reread is sufficient. A still-forbidden object
      // must surface an error instead of remounting and retrying indefinitely.
      if (deniedAccessScope.current === accessScope) { invalidate(true); setError(error.message); setLoading(false); }
      else { deniedAccessScope.current = accessScope; revalidateAccess(); }
    },
  });
  const logout = async () => {
    if (renderOwner.signal.aborted || owner.current !== renderOwner || customerSessionGeneration(tenantCode) !== generation) throw new Error("当前退出操作的客户身份已变化");
    invalidate();
    if (offline) throw new Error("未连接企业服务");
    try { await logoutCustomerSession(tenantCode, CLIENT_BASE); }
    catch (e) { setError(e instanceof Error ? e.message : "会话撤销结果待核对"); throw e; }
  };
  return <Context.Provider value={{ tenantCode, tenantName, basePath: route?.basePath ?? "/enterprise", domainBound: route?.boundDomain ?? false,
    session, entry, loading, error, identity, signal, selectedCorporateId, selectCorporate, selectWorkspace, read, write, logout, reload: () => { invalidate(); setRevision(r => r + 1); } }}>{children}</Context.Provider>;
}
export function useEnterprise() { const value = useContext(Context); if (!value) throw new Error("Enterprise session host is required"); return value; }
