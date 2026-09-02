import { CheckOutlined, CompressOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Dropdown, Switch, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";
import { useAppearance, type AppearanceMode } from "@/app/theme";

/**
 * 紧凑模式暂时不对外提供。
 *
 * 只是**不给入口**，不是删掉：`AppearanceMode` 的类型与 `compactAlgorithm`
 * 都还在（界面规范里那两条也仍受机器校验保护），改回 `true` 即可恢复三选一的下拉。
 * 因此这里保留了下拉那条代码路径，而不是删掉后将来重写。
 */
const SHOW_COMPACT = false;

const appearances: Array<{ value: AppearanceMode; label: string; description: string; icon: ReactNode }> = [
  { value: "default", label: "明亮", description: "Ant Design 默认浅色主题", icon: <SunOutlined /> },
  { value: "dark", label: "暗色", description: "使用官方 darkAlgorithm", icon: <MoonOutlined /> },
  { value: "compact", label: "紧凑", description: "使用官方 compactAlgorithm", icon: <CompressOutlined /> }
];

/**
 * 侧栏底部的外观切换行：图标 + 文案 + 开关，与「通知」「设置」两行同构。
 *
 * `iconOnly` 下只留开关：侧栏收起时 64px 宽放不下图标与文案，硬塞会挤成两行；
 * 登录页把它浮在框角上，同样只需要开关本身。
 */
export function AppearanceSwitcher({ iconOnly = false }: { iconOnly?: boolean }) {
  const { mode, setMode } = useAppearance();
  const active = appearances.find((item) => item.value === mode) ?? appearances[0];

  if (SHOW_COMPACT) {
    const menu: MenuProps = {
      selectedKeys: [mode],
      items: appearances.map((item) => ({
        key: item.value,
        icon: item.icon,
        label: <div className="appearance-option"><span>{item.label}</span><small>{item.description}</small></div>,
        extra: item.value === mode ? <CheckOutlined /> : undefined
      })),
      onClick: ({ key }) => setMode(key as AppearanceMode)
    };
    return (
      <Dropdown menu={menu} trigger={["click"]} placement="topLeft">
        <Tooltip title="切换外观主题" placement={iconOnly ? "right" : "top"}>
          <Button type="text" className="sider-link" aria-label="切换外观主题" icon={active.icon}>
            {iconOnly ? null : <span className="sider-link-label">{active.label}</span>}
          </Button>
        </Tooltip>
      </Dropdown>
    );
  }

  /**
   * 只在明亮与暗色之间切换，因此用开关而不是下拉——两个状态用下拉是多一次点击。
   *
   * 判据是 `mode === "dark"`：若本地存的是已隐藏的 `compact`，开关显示为未开启，
   * 用户第一次拨动就会落到 default / dark，状态自然收敛，不需要额外的迁移逻辑。
   */
  const isDark = mode === "dark";
  const toggle = <Switch
    checked={isDark}
    size={iconOnly ? "small" : "default"}
    aria-label="切换外观主题"
    onChange={(next) => setMode(next ? "dark" : "default")}
  />;

  if (iconOnly) {
    return <Tooltip title="切换外观主题" placement="right"><span className="sider-link-switch">{toggle}</span></Tooltip>;
  }

  return (
    <div className="sider-link sider-link-static">
      <MoonOutlined />
      <span className="sider-link-label">暗色模式</span>
      {toggle}
    </div>
  );
}
