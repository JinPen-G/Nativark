import { AppstoreOutlined, CheckOutlined, SwapOutlined } from "@ant-design/icons";
import { App, Dropdown, Spin } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/features/auth/authStore";

/**
 * SPACE-05：侧栏顶部的经营空间选择器。
 *
 * 只渲染 store 里的 workspaces——那份列表由服务端按成员关系过滤后下发，
 * 因此**无权空间天然不可见**，前端不做二次筛选（前端筛选给不了安全性，
 * 只会让"看得见但点不动"的错误状态变得可能）。
 *
 * 与旧版顶栏的两点差别：
 *   1. 它现在占据侧栏的一个**固定槽位**，所以单空间与无空间也必须渲染出东西。
 *      旧版在这两种情况下返回 `null` / 一个 `Tag`，放进固定槽位会出现"这块地方
 *      有时候是空白"，看起来像加载失败。因此改为：单空间渲染同样的卡片但不可点，
 *      无空间（SaaS 平台账号）渲染一张说明卡片。
 *   2. 卡片是两行：上行租户、下行当前空间。空间名是操作对象，因此加粗在下；
 *      租户名是上下文，弱化在上。
 */
export function WorkspaceSwitcher() {
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const tenant = useAuthStore((state) => state.tenant);
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  const [switching, setSwitching] = useState(false);
  const { message } = App.useApp();
  const navigate = useNavigate();

  const current = workspaces.find((row) => row.id === currentWorkspaceId);
  const caption = isSaasAdmin ? "SaaS 平台" : tenant?.tenantName ?? tenant?.tenantCode ?? "当前租户";

  const card = (title: string, interactive: boolean) => (
    <button
      className={`workspace-card${interactive ? "" : " is-static"}`}
      type="button"
      disabled={!interactive}
    >
      <span className="workspace-card-mark">
        {switching ? <Spin size="small" /> : <AppstoreOutlined />}
      </span>
      <span className="workspace-card-copy">
        <small>{caption}</small>
        <b>{title}</b>
      </span>
      {interactive && <SwapOutlined className="workspace-card-arrow" />}
    </button>
  );

  // 平台账号不属于任何经营空间：如实说明，而不是留一块空白或假装选了什么。
  if (!workspaces.length) return card(isSaasAdmin ? "平台管理面" : "尚无经营空间", false);
  // 单空间没有可切换的目标，给一个只有当前项的菜单是噪音。
  if (workspaces.length === 1) return card(current?.name ?? workspaces[0].name, false);

  const handleSwitch = async (workspaceId: string) => {
    if (workspaceId === currentWorkspaceId || switching) return;
    setSwitching(true);
    try {
      await switchWorkspace(workspaceId);
      // 切换后回到工作台：当前路由可能是上一个空间品类才有的页面
      // （如车辆空间的调度台），留在原地会立刻撞 403。
      navigate("/workbench", { replace: true });
      message.success("已切换经营空间");
    } catch (error) {
      // 服务端可能因成员关系被撤销或空间停用而拒绝；如实提示，不假装已切换。
      const detail = error instanceof Error ? error.message : "请稍后重试";
      message.error(`切换经营空间失败：${detail}`);
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
          icon: row.id === currentWorkspaceId ? <CheckOutlined /> : <AppstoreOutlined />,
          label: (
            <span className="workspace-option">
              {row.name}
              <small>{row.categoryCode}</small>
            </span>
          ),
          onClick: () => void handleSwitch(row.id)
        }))
      }}
    >
      {card(current?.name ?? "未选择经营空间", true)}
    </Dropdown>
  );
}
