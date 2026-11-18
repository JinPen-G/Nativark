/** Shared heading presentation. Hosts own route metadata, brand and identity. */
import { useEffect, type ReactNode } from "react";
import { Space } from "antd";
import { Button } from "./ui/Button";
import { InfoPopover } from "./ui/InfoPopover";
import { InfoCircleOutlined } from "./ui/icons";
import { useLocale } from "../app/locale";
import { useWorkspaceHeader, WorkspacePageActions, WorkspacePageTitle } from "./workspace/WorkspaceHeader";
export interface PageHeadingProps {
  title: string; brandName: string; icon?: ReactNode; description?: string; summary?: ReactNode; view?: ReactNode;
  extra?: ReactNode;
  /** 返回和父级导航留在正文起点，查询和刷新工具跟随当前内容。 */
  navigation?: ReactNode; tools?: ReactNode; toolsPlacement?: "context" | "view";
  note?: { title: string; description: ReactNode };
}
export function PageHeading({ title, brandName, icon, description, summary, view, extra, navigation, tools, toolsPlacement = "context", note }: PageHeadingProps) {
  const { t } = useLocale();
  const heading = t(title);
  const workspaceHeader = useWorkspaceHeader();
  const contentTools = tools && <div className="page-context-tools" role="group" aria-label={`${heading} · ${t("页面操作")}`}>{tools}</div>;
  const toolsWithView = Boolean(view && toolsPlacement === "view");
  const contentView = view && <div className="page-toolbar-view">{toolsWithView && tools
    ? <div className="page-content-toolbar"><div className="page-content-controls">{view}</div>{contentTools}</div> : view}</div>;
  useEffect(() => { document.title = `${heading} · ${brandName}`; }, [heading, brandName]);
  if (workspaceHeader) return <>
    <WorkspacePageTitle><h1 className="workspace-page-title">{heading}</h1>
      {note && <InfoPopover title={t(note.title)} content={typeof note.description === "string" ? t(note.description) : note.description}><Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} /></InfoPopover>}
    </WorkspacePageTitle>
    <WorkspacePageActions label={`${heading} ${t("页面操作")}`}>{extra}</WorkspacePageActions>
    {(description || summary || view || tools || navigation) && <div className="page-header page-header-compact">
      {(description || summary || navigation || tools && !toolsWithView) && <div className="page-context-row">
        {navigation && <div className="page-context-navigation">{navigation}</div>}
        {description && <p className="page-context" role="note">{t(description)}</p>}
        {summary && <div className="page-summary">{summary}</div>}
        {!toolsWithView && contentTools}
      </div>}
      {contentView}
    </div>}
  </>;
  return <div className="page-header"><div className="page-toolbar" aria-label={`${heading} ${t("页面操作")}`}>
    <div className="page-heading" data-has-summary={summary ? "" : undefined}><div className="page-title-row" data-icon-hover="">
      {icon && <span className="page-title-icon" aria-hidden="true">{icon}</span>}<h1 className="page-title">{heading}</h1>
      {note && <InfoPopover title={t(note.title)} content={typeof note.description === "string" ? t(note.description) : note.description}><Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} /></InfoPopover>}
    </div>{description && <p className="page-context" role="note">{t(description)}</p>}
      {summary && <div className="page-summary">{summary}</div>}
    </div>
    {extra && <Space className="page-toolbar-actions" wrap>{extra}</Space>}
  </div>{(navigation || tools && !toolsWithView) && <div className="page-context-row">
    {navigation && <div className="page-context-navigation">{navigation}</div>}{!toolsWithView && contentTools}
  </div>}{contentView}</div>;
}
