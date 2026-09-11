import { CheckOutlined, CompressOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tooltip } from "antd";
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
 * 侧栏底部的外观切换行：主体是移植自 BoardUI 的分段切换控件。
 *
 * `iconOnly` 下只留一枚图标按钮：侧栏收起时 64px 宽放不下药丸；
 * 登录页把它浮在框角上，同样只需要按钮本身。
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
   * 移植自 BoardUI 的分段切换：药丸容器 + 两枚图标按钮，选中项是一块会平移过去的滑块。
   * 尺寸按本仓侧栏的行高收敛（行高 36px，控件也是 36px），结构、留白比例与动效时长不变。
   *
   * 颜色走本仓的 antd 语义变量而不是写死 BoardUI 的灰值：浅色下
   * `fill-secondary`（≈#e8e8e8）、`bg-container`（#fff）与 BoardUI 的 #ebebeb / #fff
   * 基本一致，深色下则自动跟随本仓的暗色板，不会出现"套了别人的灰"。
   *
   * 判据仍是 `mode === "dark"`：若本地存的是已隐藏的 `compact`，控件显示为未选中，
   * 用户第一次点击就会落到 default / dark，状态自然收敛，不需要额外的迁移逻辑。
   */
  const isDark = mode === "dark";

  /** 揭示圆心用被点中的那枚按钮，圆从它中心扩散；与 BoardUI 取法一致。 */
  const switchTo = (next: AppearanceMode, element: HTMLElement) => setMode(next, { element });

  if (iconOnly) {
    /**
     * 收起态只有 64px、扣掉内边距可用约 48px，药丸放不下，退化成单枚图标按钮：
     * 显示的是「点下去会变成什么样」，与分段控件的语义保持一致。
     */
    return (
      <Tooltip title="切换外观主题" placement="right">
        <span className="sider-link-switch">
          <button
            type="button"
            className="appearance-toggle-compact"
            aria-label="切换外观主题"
            onClick={(event) => switchTo(isDark ? "default" : "dark", event.currentTarget)}
          >
            {isDark ? <SunOutlined /> : <MoonOutlined />}
          </button>
        </span>
      </Tooltip>
    );
  }

  return (
    <div className="sider-link sider-link-static">
      {/* 两枚按钮是一组互斥的外观选项；滑块只是装饰，真值在按钮的 aria-pressed 上。 */}
      <div className="appearance-toggle" role="group" aria-label="切换外观主题">
        <span className="appearance-toggle-thumb" aria-hidden="true" />
        <button
          type="button"
          className="appearance-toggle-option"
          aria-label="明亮主题"
          aria-pressed={!isDark}
          onClick={(event) => switchTo("default", event.currentTarget)}
        >
          <SunOutlined />
        </button>
        <button
          type="button"
          className="appearance-toggle-option"
          aria-label="暗色主题"
          aria-pressed={isDark}
          onClick={(event) => switchTo("dark", event.currentTarget)}
        >
          <MoonOutlined />
        </button>
      </div>
    </div>
  );
}
