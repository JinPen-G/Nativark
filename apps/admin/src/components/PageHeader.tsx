import { InfoCircleOutlined } from "@ant-design/icons";
import { Button, Popover, Space } from "antd";
import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { findRouteByPath } from "@/app/navigation";
import { useLocale } from "@/app/locale";

/**
 * 页面顶部：左边是标题与副标题（+ 页面自己的视图切换），右边是说明和主操作。
 *
 * 标题落在这里是因为面包屑已经取消，否则页面上就没有任何标题信息了。
 *
 * description 是页面的导航性副标题，统一常显；note 是详细口径说明，继续收进浮层，
 * 避免把长规则文字和页面主操作混在同一层。
 * 只有 `type="info"` 的口径说明适合放进来——系统限制类的 warning（例如"电子合同尚未
 * 接入"）必须常显，藏起来会让人误以为功能已经完整。
 */
export function PageHeader({ title, description, view, extra, note }: {
  title: string;
  description: string;
  view?: ReactNode;
  extra?: ReactNode;
  note?: { title: string; description: ReactNode };
}) {
  const location = useLocation();
  const { t, locale } = useLocale();
  const icon = findRouteByPath(location.pathname)?.icon;
  const translatedTitle = t(title);
  const translatedDescription = t(description);
  const translatedNoteTitle = note ? t(note.title) : undefined;
  const translatedNoteDescription = note && typeof note.description === "string" ? t(note.description) : note?.description;

  useEffect(() => {
    document.title = `${translatedTitle} · Rental OS`;
  }, [translatedTitle]);

  return (
    <>
      <div className="page-toolbar" aria-label={locale === "en-US" ? `${translatedTitle} · ${t("页面操作")}` : `${title}页面操作`} data-description={translatedDescription}>
        <div className="page-heading">
          <div className="page-title-row">
            {/* 图标取自路由注册表，和侧栏菜单同一个符号；页面不各自传图标，避免两处长歪。 */}
            {icon && <span className="page-title-icon">{icon}</span>}
            <h1 className="page-title">{translatedTitle}</h1>
            {note && (
              <Popover
                trigger="click"
                placement="bottomLeft"
                title={translatedNoteTitle}
                content={<div className="page-note">{translatedNoteDescription}</div>}
              >
                <Button type="text" size="small" aria-label={t("页面说明")} icon={<InfoCircleOutlined />} />
              </Popover>
            )}
          </div>
          {translatedDescription && <p className="page-subtitle">{translatedDescription}</p>}
        </div>
        {extra && <Space className="page-toolbar-actions" wrap>{extra}</Space>}
      </div>
      {/* 筛选与视图切换单独一行：它们是一组会换行的控件，挤在标题旁边会把标题推走，
          标题那一行只留导出、新增这类动作。 */}
      {view && <div className="page-toolbar-view">{view}</div>}
    </>
  );
}
