import { BgColorsOutlined, CheckOutlined, CompressOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";
import { useAppearance, type AppearanceMode } from "@/app/theme";

const appearances: Array<{ value: AppearanceMode; label: string; description: string; icon: ReactNode }> = [
  { value: "default", label: "明亮", description: "Ant Design 默认浅色主题", icon: <SunOutlined /> },
  { value: "dark", label: "暗色", description: "使用官方 darkAlgorithm", icon: <MoonOutlined /> },
  { value: "compact", label: "紧凑", description: "使用官方 compactAlgorithm", icon: <CompressOutlined /> }
];

export function AppearanceSwitcher({ showLabel = false }: { showLabel?: boolean }) {
  const { mode, setMode } = useAppearance();
  const active = appearances.find((item) => item.value === mode) ?? appearances[0];
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
    <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
      <Tooltip title="切换外观主题">
        <Button type="text" aria-label="切换外观主题" icon={showLabel ? active.icon : <BgColorsOutlined />}>
          {showLabel ? active.label : null}
        </Button>
      </Tooltip>
    </Dropdown>
  );
}
