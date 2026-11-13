/** Shared heading presentation. Hosts own route metadata, brand and identity. */
import { useEffect, type ReactNode } from "react";
import { Space } from "antd";
import { Button } from "./ui/Button";
import { InfoPopover } from "./ui/InfoPopover";
import { InfoCircleOutlined } from "./ui/icons";
import { useLocale } from "@/app/locale";
import { useWorkspaceHeader, WorkspacePageActions, WorkspacePageTitle } from "./workspace/WorkspaceHeader";
export interface PageHeadingProps { title: string; brandName: string; icon?: ReactNode; description?: string; view?: ReactNode; extra?: ReactNode; note?: { title: string; description: ReactNode } }
export function PageHeading({ title, brandName, icon, description, view, extra, note }: PageHeadingProps) {
  const { t } = useLocale();
  const heading = t(title);
  const workspaceHeader = useWorkspaceHeader();
  useEffect(() => { document.title = `${heading} · ${brandName}`; }, [heading, brandName]);
  if (workspaceHeader) return <>
    <WorkspacePageTitle><h1 className="workspace-page-title">{heading}</h1>
      {note && <InfoPopover title={t(note.title)} content={typeof note.description === "string" ? t(note.description) : note.description}><Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} /></InfoPopover>}
    </WorkspacePageTitle>
    <WorkspacePageActions label={`${heading} ${t("页面操作")}`}>{extra}</WorkspacePageActions>
    {(description || view) && <div className="page-header page-header-compact">
      {description && <p className="page-context" role="note">{t(description)}</p>}
      {view && <div className="page-toolbar-view">{view}</div>}
    </div>}
  </>;
  return <div className="page-header"><div className="page-toolbar" aria-label={`${heading} ${t("页面操作")}`}>
    <div className="page-heading"><div className="page-title-row" data-icon-hover="">
      {icon && <span className="page-title-icon" aria-hidden="true">{icon}</span>}<h1 className="page-title">{heading}</h1>
      {note && <InfoPopover title={t(note.title)} content={typeof note.description === "string" ? t(note.description) : note.description}><Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} /></InfoPopover>}
    </div>{description && <p className="page-context" role="note">{t(description)}</p>}</div>
    {extra && <Space className="page-toolbar-actions" wrap>{extra}</Space>}
  </div>{view && <div className="page-toolbar-view">{view}</div>}</div>;
}
