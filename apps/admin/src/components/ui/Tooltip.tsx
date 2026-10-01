import { Tooltip as AntTooltip, type TooltipProps } from "antd";
import { isValidElement } from "react";
import { Tooltip as ArcTooltip } from "@/registry/components/tooltip/tooltip";

export function Tooltip(props: TooltipProps) {
  const { children, title, placement = "top" } = props;
  if (!title) return <>{children}</>;
  if (!isValidElement(children) || typeof title === "function" || placement !== "top" && placement !== "bottom" || props.open !== undefined || props.trigger || props.onOpenChange || props.defaultOpen || props.color || props.styles || props.classNames || props.getPopupContainer || props.zIndex !== undefined || props.mouseEnterDelay !== undefined || props.mouseLeaveDelay !== undefined) return <AntTooltip {...props} />;
  return <ArcTooltip content={title} side={placement}>{children}</ArcTooltip>;
}
