import { InfoCircleOutlined } from "@ant-design/icons";
import { Button, Popover, Space } from "antd";
import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { findRouteByPath } from "@/app/navigation";

/**
 * 页面顶部一行：左边是标题（+ 页面自己的视图切换），右边是「说明」和主操作。
 *
 * 标题落在这里是因为面包屑已经取消，否则页面上就没有任何标题信息了。
 *
 * 口径说明默认不展示：这类文字是「第一次看有用、之后每天都在占位」的参考信息，
 * 常驻页面顶部会把真正的内容整体压下去一屏，笔记本上尤其明显，因此收进「说明」按钮。
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
  const icon = findRouteByPath(location.pathname)?.icon;

  useEffect(() => {
    document.title = `${title} · Rental OS`;
  }, [title]);

  return (
    <>
      <div className="page-toolbar" aria-label={`${title}页面操作`} data-description={description}>
        <div className="page-title-row">
          {/* 图标取自路由注册表，和侧栏菜单同一个符号；页面不各自传图标，避免两处长歪。 */}
          {icon && <span className="page-title-icon">{icon}</span>}
          {/* 面包屑已取消，页面标题就落在这里；用原生 h1 而不是 Typography.Title，
              后者会带来一整套「标题 + 副标题」的排版，规范里明确不要。 */}
          <h1 className="page-title">{title}</h1>
          {note && (
            <Popover
              trigger="click"
              placement="bottomLeft"
              title={note.title}
              content={<div className="page-note">{note.description}</div>}
            >
              {/* 口径说明紧跟标题：它解释的是"这个页面是什么"，不是一个操作，
                  放在右侧动作区会和主操作抢位置。 */}
              <Button type="text" size="small" aria-label="页面说明" icon={<InfoCircleOutlined />} />
            </Popover>
          )}
        </div>
        {extra && <Space className="page-toolbar-actions" wrap>{extra}</Space>}
      </div>
      {/* 筛选与视图切换单独一行：它们是一组会换行的控件，挤在标题旁边会把标题推走，
          标题那一行只留导出、新增这类动作。 */}
      {view && <div className="page-toolbar-view">{view}</div>}
    </>
  );
}
