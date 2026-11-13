/** Operator workspace data for the shared shell context picker. */
import { useNavigate } from "react-router-dom";
import { AnimatedIcon, type AnimatedIconName } from "@/components/ui/AnimatedIcon";
import { useAdminBrandIcon } from "@/app/BrandIconProvider";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { useFeedback } from "@/components/ui";
import { NativeContextSwitcher } from "./NativeContextSwitcher";

const categoryIcons: Record<string, AnimatedIconName> = { camera: "camera", vehicle: "vehicle", camping: "camping", construction: "construction" };

export function NativeWorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale(), icon = useAdminBrandIcon();
  const tenant = useAuthStore(s => s.tenant), user = useAuthStore(s => s.user), workspaces = useAuthStore(s => s.workspaces);
  const currentId = useAuthStore(s => s.currentWorkspaceId), switchWorkspace = useAuthStore(s => s.switchWorkspace);
  const navigate = useNavigate(), { toast } = useFeedback();
  const title = user?.isSaasAdmin ? "Rental OS" : tenant?.tenantName ?? t("租户");
  const subtitle = workspaces.find(workspace => workspace.id === currentId)?.name ?? t(user?.isSaasAdmin ? "平台管理面" : "尚无经营空间");
  return <NativeContextSwitcher title={title} subtitle={compact ? subtitle : t(subtitle)} compact={compact}
    brand={<img src={icon.src} onError={icon.onError} alt="" className="size-8 rounded-lg bg-sidebar object-contain" />}
    brandInverted={icon.isPlatformMark} label={t("经营空间")} value={currentId ?? ""}
    options={workspaces.map(workspace => ({ id: workspace.id, name: compact ? workspace.name : t(workspace.name),
      icon: <AnimatedIcon name={categoryIcons[workspace.categoryCode] ?? "inventory"} style={{ fontSize: 20 }} /> }))}
    onChange={async id => { await switchWorkspace(id); navigate("/workbench", { replace: true }); }}
    onError={() => toast({ type: "error", title: t("切换经营空间失败") })} />;
}
