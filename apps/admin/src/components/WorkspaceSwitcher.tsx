import { AppstoreOutlined, CameraOutlined, CarOutlined, DownOutlined, FireOutlined, ToolOutlined } from "@ant-design/icons";
import { RentalCategoryCode } from "@rental-os/shared";
import { Spin } from "antd";
import { App } from "@/components/ui";
import { Dropdown } from "@/components/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";

const categoryIcons: Partial<Record<RentalCategoryCode, ReactNode>> = {
  [RentalCategoryCode.Camera]: <CameraOutlined />,
  [RentalCategoryCode.Camping]: <FireOutlined />,
  [RentalCategoryCode.Construction]: <ToolOutlined />,
  [RentalCategoryCode.Vehicle]: <CarOutlined />
};

function workspaceIcon(categoryCode?: string) {
  return (categoryCode && categoryIcons[categoryCode as RentalCategoryCode]) ?? <AppstoreOutlined />;
}

/**
 * SPACE-05：侧栏顶部的经营空间选择器。
 *
 * 只渲染 store 里的 workspaces——那份列表由服务端按成员关系过滤后下发，
 * 因此**无权空间天然不可见**，前端不做二次筛选（前端筛选给不了安全性，
 * 只会让"看得见但点不动"的错误状态变得可能）。
 *
 * 形态是**单行选择框**（图标 + 空间名 + 收起箭头）。租户名不放在这里：
 * 它是上下文而不是操作对象，左下角账号卡已经带了，两处都放是重复信息。
 *
 * 它占据侧栏一个**固定槽位**，因此单空间与无空间也必须渲染出东西——
 * 返回 `null` 会让这块地方时有时无，看起来像加载失败。
 */
export function WorkspaceSwitcher() {
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  const [switching, setSwitching] = useState(false);
  const { message } = App.useApp();
  const { t } = useLocale();
  const navigate = useNavigate();

  const displayName = (name: string) => t(name);

  const current = workspaces.find((row) => row.id === currentWorkspaceId);

  const box = (title: string, interactive: boolean, categoryCode?: string) => (
    <button
      className={`workspace-select${interactive ? "" : " is-static"}`}
      type="button"
      disabled={!interactive}
      title={title}
    >
      <span className="workspace-select-mark">
        {switching ? <Spin size="small" /> : workspaceIcon(categoryCode)}
      </span>
      <span className="workspace-select-name">{title}</span>
      {interactive && <DownOutlined className="workspace-select-arrow" />}
    </button>
  );

  // 平台账号不属于任何经营空间：如实说明，而不是留一块空白或假装选了什么。
  if (!workspaces.length) return box(isSaasAdmin ? t("平台管理面") : t("尚无经营空间"), false);
  // 单空间没有可切换的目标，给一个只有当前项的菜单是噪音。
  if (workspaces.length === 1) return box(displayName(current?.name ?? workspaces[0].name), false, current?.categoryCode ?? workspaces[0].categoryCode);

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
          icon: workspaceIcon(row.categoryCode),
          label: displayName(row.name),
          onClick: () => void handleSwitch(row.id)
        }))
      }}
    >
      {box(displayName(current?.name ?? t("未选择经营空间")), true, current?.categoryCode)}
    </Dropdown>
  );
}
