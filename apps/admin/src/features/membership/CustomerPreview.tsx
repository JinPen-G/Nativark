/** Read-only identity preview. History stays on its source row; current masked facts load only when the original HoverCard mounts its content. */
import { useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Building2, Clock3 } from "lucide-react";
import { HoverCard, HoverCardProfile } from "@/registry/components/hover-card/hover-card";
import { Button } from "@/registry/components/button/button";
import avatarStyles from "@/registry/components/avatar/avatar.module.css";
import { customerApi } from "@/api/customer";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import styles from "./CustomerPreview.module.css";
import { CustomerAvatar } from "./CustomerAvatar";

export interface CustomerPreviewFacts {
  name: string;
  type?: "personal" | "corporate";
  phoneMasked?: string;
  membershipStatus?: string;
  levelName?: string;
  companyName?: string;
  region?: string;
  updatedAt?: string;
}
interface Props extends CustomerPreviewFacts {
  customerId?: string;
  snapshot?: boolean;
  children?: ReactNode;
}
const statusLabels: Record<string, string> = { active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销", pending: "待审核", pending_activation: "待审核" };
const narrowQuery = "(max-width: 639px)";
const subscribeViewport = (notify: () => void) => { const viewport = matchMedia(narrowQuery); viewport.addEventListener("change", notify); return () => viewport.removeEventListener("change", notify); };
const narrowViewport = () => matchMedia(narrowQuery).matches;

export function CustomerPreview({ children, ...facts }: Props) {
  const { t } = useLocale();
  const narrow = useSyncExternalStore(subscribeViewport, narrowViewport, () => false);
  const user = useAuthStore(state => state.user);
  const tenantId = useAuthStore(state => state.tenant?.tenantId);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  // Match the original customer detail GET guard; corporate-list permission alone never grants a broader read.
  const allowed = useAuthStore(state => !state.user?.isSaasAdmin && ["rental-os:member:view", "rental-os:member:manage"].some(permission => state.hasPermission(permission) || state.hasTenantMembershipPermission(permission)));
  const scope = JSON.stringify([tenantId, workspaceId, user?.id, user?.tenantId, user?.roleIds, user?.organizationId, user?.permissions, user?.dataScope, user?.locationScope, user?.tenantMembership, allowed]);
  if (!facts.customerId || !facts.name.trim() || facts.name === "—") return <>{children ?? facts.name ?? "—"}</>;
  return <HoverCard key={`${scope}:${facts.customerId}`} className={styles.surface} side={narrow ? "bottom" : "right"} content={<CustomerPreviewContent facts={facts} scope={scope} allowed={Boolean(allowed && tenantId && user)} />}>
    <Button type="button" variant="secondary" size="sm" className={styles.trigger} aria-label={`${t("预览客户资料")} ${facts.name}`}>
      <span className={`${avatarStyles.avatar} ${avatarStyles.sm} ${styles.avatar}`} aria-hidden="true"><CustomerAvatar customerId={facts.customerId} scope={scope} allowed={Boolean(allowed&&tenantId&&user)} fallback={facts.type === "corporate" ? <Building2 size={16} /> : facts.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join("")} /></span>
      <span className={styles.name} data-customer-preview-name="">{children ?? facts.name}</span>
    </Button>
  </HoverCard>;
}

function CustomerPreviewContent({ facts, scope, allowed }: { facts: Props; scope: string; allowed: boolean }) {
  const { t } = useLocale();
  const current = useQuery({
    queryKey: ["customer-identity-preview", scope, facts.customerId],
    queryFn: async (): Promise<CustomerPreviewFacts> => {
      const profile = await customerApi.detail(facts.customerId!);
      if (profile.id !== facts.customerId) throw new Error("Customer preview unavailable");
      // Keep only display-safe fields in this cache, even when the service account can reveal plaintext.
      return { name: profile.customerType === "corporate" ? profile.corporateName || profile.name : profile.name, type: profile.customerType, phoneMasked: profile.phoneMasked,
        membershipStatus: profile.membership?.status, levelName: profile.membership?.levelName, region: profile.region, updatedAt: profile.updatedAt };
    },
    enabled: allowed,
    staleTime: 30_000, gcTime: 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const displayed = !current.isError && current.data ? current.data : facts;
  const meta = allowed && current.isPending ? t("正在读取当前资料") : allowed && current.isError ? t("当前资料暂不可用") : allowed && current.data ? t("当前客户资料") : t(facts.snapshot ? "下单时资料" : "当前列表资料");
  const member = Boolean(displayed.membershipStatus || displayed.levelName);
  const updatedAt = displayed.updatedAt && dayjs(displayed.updatedAt).isValid() ? dayjs(displayed.updatedAt).format("MM-DD HH:mm") : undefined;
  return <div className={styles.content} data-customer-preview-content="">
    <HoverCardProfile name={displayed.name} avatar={<CustomerAvatar customerId={facts.customerId} scope={scope} allowed={allowed} fallback={displayed.type === "corporate" ? <Building2 aria-hidden="true" /> : displayed.name.slice(0,1)} />}
      role={displayed.type ? t(displayed.type === "corporate" ? member ? "企业会员" : "企业客户" : member ? "个人会员" : "个人客户") : undefined}
      bio={[displayed.phoneMasked ? `${t("联系电话")} ${displayed.phoneMasked}` : undefined, displayed.region, displayed.companyName].filter(Boolean).join(" · ") || undefined}
      stats={[
        ...(displayed.membershipStatus ? [{ label: t("会员状态"), value: t(statusLabels[displayed.membershipStatus] ?? displayed.membershipStatus) }] : []),
        ...(displayed.levelName ? [{ label: t("会员等级"), value: displayed.levelName }] : []),
      ]}
      meta={<><Clock3 size={14} aria-hidden="true" /><span role={current.isPending && allowed ? "status" : undefined}>{meta}</span>{updatedAt && <time dateTime={displayed.updatedAt}>{updatedAt}</time>}</>}
    />
  </div>;
}
