import { InfoCircleOutlined } from "@/components/ui/icons";
import { Space } from "antd";
import { Button, InfoPopover } from "@/components/ui";
import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { findRouteByPath } from "@/app/navigation";
import { resolveAdminBrandName } from "@/app/branding";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { AnimatedIcon } from "./ui/AnimatedIcon";
import { routeIconName } from "@/app/navigation-icons";
import { useWorkspaceHeader, WorkspacePageActions, WorkspacePageTitle } from "./workspace/WorkspaceHeader";

/**
 * 工作区内将当前页名及主操作送到面包屑栏；无宿主时保留完整页头。
 * description/summary/view 留在内容区，统一拥有到首个内容的间距。
 * note 是可按需查看的详细口径，不让长规则文字与主操作争夺层级。
 * 只有 `type="info"` 的口径说明适合放进来——系统限制类的 warning（例如"电子合同尚未
 * 接入"）必须常显，藏起来会让人误以为功能已经完整。
 */
export function PageHeader({ title, description, summary, view, extra, note }: {
  title: string;
  description?: string;
  /** Current filtered facts in one compact content line. */
  summary?: ReactNode;
  view?: ReactNode;
  extra?: ReactNode;
  note?: { title: string; description: ReactNode };
}) {
  const location = useLocation();
  const { t, locale } = useLocale();
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const workspaceHeader = useWorkspaceHeader();
  const icon = findRouteByPath(location.pathname)?.icon;
  const translatedTitle = t(title);
  const brandName = resolveAdminBrandName(tenant, user);
  const translatedDescription = description ? t(description) : undefined;
  const translatedNoteTitle = note ? t(note.title) : undefined;
  const translatedNoteDescription = note && typeof note.description === "string" ? t(note.description) : note?.description;

  useEffect(() => {
    document.title = `${translatedTitle} · ${brandName}`;
  }, [brandName, translatedTitle]);

  if (workspaceHeader) return <>
    <WorkspacePageTitle>
      <h1 className="workspace-page-title">{translatedTitle}</h1>
      {note && <InfoPopover title={translatedNoteTitle ?? ""} content={translatedNoteDescription}>
        <Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} />
      </InfoPopover>}
    </WorkspacePageTitle>
    <WorkspacePageActions label={`${translatedTitle} · ${t("页面操作")}`}>{extra}</WorkspacePageActions>
    {(translatedDescription || summary || view) && <div className="page-header page-header-compact">
      {(translatedDescription || summary) && <div className="page-context-row">
        {translatedDescription && <p className="page-context" role="note">{translatedDescription}</p>}
        {summary && <div className="page-summary">{summary}</div>}
      </div>}
      {view && <div className="page-toolbar-view">{view}</div>}
    </div>}
  </>;

  return (
    <div className="page-header">
      <div className="page-toolbar" aria-label={locale === "en-US" ? `${translatedTitle} · ${t("页面操作")}` : `${title}页面操作`}>
        <div className="page-heading" data-has-summary={summary ? "" : undefined}>
          <div className="page-title-row" data-icon-hover="">
            {/* 图标取自路由注册表，和侧栏菜单同一个符号；页面不各自传图标，避免两处长歪。 */}
            {icon && <span className="page-title-icon"><AnimatedIcon name={routeIconName(location.pathname)} /></span>}
            <h1 className="page-title">{translatedTitle}</h1>
            {note && (
              <InfoPopover
                title={translatedNoteTitle ?? ""}
                content={translatedNoteDescription}
              >
                <Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} />
              </InfoPopover>
            )}
          </div>
          {translatedDescription && <p className="page-context" role="note">{translatedDescription}</p>}
          {summary && <div className="page-summary">{summary}</div>}
        </div>
        {extra && <Space className="page-toolbar-actions" wrap>{extra}</Space>}
      </div>
      {/* view 也可能承载完整的 Tab 面板/表单，保持块流；控件组自己负责内部排布。
          标题行只保留导出、新增等页面动作，不为副标题或空插槽预留高度。 */}
      {view && <div className="page-toolbar-view">{view}</div>}
    </div>
  );
}
