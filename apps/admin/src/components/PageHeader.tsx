import { useEffect, type ReactNode } from "react";
import { Space } from "antd";

export function PageHeader({ title, description, view, extra }: { title: string; description: string; view?: ReactNode; extra?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Rental OS`;
  }, [title]);

  if (!view && !extra) return null;

  return (
    <div className="page-toolbar" aria-label={`${title}页面操作`} data-description={description}>
      <div className="page-toolbar-view">{view}</div>
      {extra && <Space className="page-toolbar-actions" wrap>{extra}</Space>}
    </div>
  );
}
