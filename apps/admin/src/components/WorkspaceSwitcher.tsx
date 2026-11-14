import { AppstoreOutlined } from "@/components/ui/icons";
import { ChevronsUpDown } from "lucide-react";
import { RentalCategoryCode } from "@rental-os/shared";
import { Spin } from "antd";
import { App } from "@/components/ui";
import { Dropdown } from "@/components/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { useAdminBrandIcon } from "@/app/BrandIconProvider";
import { ADMIN_BRAND_NAME } from "@/app/branding";
import cameraImage from "../../../website/assets/images/industry-camera-neutral.png";
import campingImage from "../../../website/assets/images/industry-camping-neutral.png";
import constructionImage from "../../../website/assets/images/industry-equipment-neutral.png";
import vehicleImage from "../../../website/assets/images/industry-vehicle-neutral.png";

const categoryImages: Partial<Record<RentalCategoryCode, string>> = {
  [RentalCategoryCode.Camera]: cameraImage,
  [RentalCategoryCode.Camping]: campingImage,
  [RentalCategoryCode.Construction]: constructionImage,
  [RentalCategoryCode.Vehicle]: vehicleImage
};

/** Category art identifies dropdown workspaces only, never the tenant's brand. */
function WorkspaceCategoryMark({ categoryCode }: { categoryCode?: string }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const fallback = categoryCode ? categoryImages[categoryCode as RentalCategoryCode] : undefined;
  const source = [fallback].find(url => url && !failedUrls.includes(url));
  return source ? <img src={source} width={36} height={36} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" aria-hidden="true" onError={() => setFailedUrls(urls => [...urls, source])} /> : <AppstoreOutlined />;
}

/**
 * SPACE-05：侧栏顶部的经营空间选择器。
 *
 * 只渲染 store 里的 workspaces——那份列表由服务端按成员关系过滤后下发，
 * 因此**无权空间天然不可见**，前端不做二次筛选（前端筛选给不了安全性，
 * 只会让"看得见但点不动"的错误状态变得可能）。
 *
 * 顶部改为方形图片 + 租户名称 / 当前空间两行 + 上下箭头。
 * 折叠时保留图片入口；空间切换仍走原成员列表、会话和缓存边界。
 *
 * 它占据侧栏一个**固定槽位**，因此单空间与无空间也必须渲染出东西——
 * 返回 `null` 会让这块地方时有时无，看起来像加载失败。
 */
export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  const tenant = useAuthStore((state) => state.tenant);
  const brandIcon = useAdminBrandIcon();
  const [switching, setSwitching] = useState(false);
  const { message } = App.useApp();
  const { t } = useLocale();
  const navigate = useNavigate();

  const displayName = (name: string) => t(name);

  const current = workspaces.find((row) => row.id === currentWorkspaceId);
  const tenantName = isSaasAdmin ? ADMIN_BRAND_NAME : tenant?.tenantName || t("租户");

  const box = (title: string, interactive: boolean) => (
    <button
      className={`workspace-select${interactive ? "" : " is-static"}${collapsed ? " is-compact" : ""}`}
      type="button"
      disabled={!interactive}
      title={`${tenantName} · ${title}`}
      aria-label={`${tenantName} · ${title}`}
    >
      <span className="workspace-select-mark">
        {switching ? <Spin size="small" /> : <img src={brandIcon.src} width={36} height={36} alt="" aria-hidden="true" onError={brandIcon.onError} />}
      </span>
      {!collapsed && <span className="workspace-select-copy"><span className="workspace-select-name">{tenantName}</span><span className="workspace-select-subtitle">{title}</span></span>}
      {interactive && !collapsed && <ChevronsUpDown className="workspace-select-arrow" size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );

  // 平台账号不属于任何经营空间：如实说明，而不是留一块空白或假装选了什么。
  if (!workspaces.length) return box(isSaasAdmin ? t("平台管理面") : t("尚无经营空间"), false);
  // 单空间没有可切换的目标，给一个只有当前项的菜单是噪音。
  if (workspaces.length === 1) return box(displayName(current?.name ?? workspaces[0].name), false);

  const handleSwitch = async (workspaceId: string) => {
    if (workspaceId === currentWorkspaceId || switching) return;
    setSwitching(true);
    try {
      await switchWorkspace(workspaceId);
      // 切换后回到工作台：当前路由可能是上一个空间品类才有的页面
      // （如车辆空间的调度台），留在原地会立刻撞 403。
      navigate("/workbench", { replace: true });
      message.success(t("已切换经营空间"));
    } catch (error) {
      // 服务端可能因成员关系被撤销或空间停用而拒绝；如实提示，不假装已切换。
      const detail = error instanceof Error ? error.message : "请稍后重试";
      message.error(`${t("切换经营空间失败")}：${detail}`);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomLeft"
      disabled={switching}
      menu={{
        selectedKeys: currentWorkspaceId ? [currentWorkspaceId] : [],
        items: workspaces.map((row) => ({
          key: row.id,
          icon: <span className="workspace-menu-mark"><WorkspaceCategoryMark categoryCode={row.categoryCode} /></span>,
          label: displayName(row.name),
          onClick: () => void handleSwitch(row.id)
        }))
      }}
    >
      {box(displayName(current?.name ?? t("未选择经营空间")), true)}
    </Dropdown>
  );
}
