import { AppstoreOutlined, CheckOutlined, SwapOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, Spin, Tag } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/features/auth/authStore";

/**
 * SPACE-05：右上角经营空间切换器。
 *
 * 只渲染 store 里的 workspaces——那份列表由服务端按成员关系过滤后下发，
 * 因此**无权空间天然不可见**，前端不做二次筛选（前端筛选给不了安全性，
 * 只会让"看得见但点不动"的错误状态变得可能）。
 *
 * 单空间时不渲染下拉：没有可切换的目标，给一个只有当前项的菜单是噪音。
 * 无空间时（平台管理租户）整体不渲染。
 */
export function WorkspaceSwitcher() {
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const [switching, setSwitching] = useState(false);
  const { message } = App.useApp();
  const navigate = useNavigate();

  if (!workspaces.length) return null;

  const current = workspaces.find((row) => row.id === currentWorkspaceId);
  const label = current?.name ?? "未选择经营空间";

  if (workspaces.length === 1) {
    return (
      <Tag icon={<AppstoreOutlined />} className="workspace-indicator">
        {label}
      </Tag>
    );
  }

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
      placement="bottomRight"
      disabled={switching}
      menu={{
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
      <Button type="text" className="workspace-switcher" icon={switching ? <Spin size="small" /> : <SwapOutlined />}>
        {label}
      </Button>
    </Dropdown>
  );
}
