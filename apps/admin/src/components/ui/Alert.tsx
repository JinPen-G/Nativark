import { Alert as AntAlert, type AlertProps } from "antd";
import { Alert as ArcAlert } from "@/registry/components/alert/alert";
import { ArcLocale } from "./ArcLocale";
import { Fragment, isValidElement, useState, type ReactNode } from "react";
import { Button } from "./Button";

// The original detail slot is a paragraph: block/custom-component notices need their compatibility renderer.
function inlineDetail(node: ReactNode): boolean {
  if (node == null || typeof node !== "object") return true;
  if (Array.isArray(node)) return node.every(inlineDetail);
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  if (node.type === Button) return true;
  return (node.type === Fragment || typeof node.type === "string" && ["span", "a", "strong", "em", "small", "code", "br", "b", "i"].includes(node.type)) && inlineDetail(node.props.children);
}

/** Preserve complex business notices; ordinary notices use the original Arc motion. */
export function Alert(props: AlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const { title, description, type = "info", closable, afterClose, action, style, className } = props;
  const noticeTitle = title ?? props.message;
  if ((noticeTitle != null && typeof noticeTitle !== "string") || !inlineDetail(description) || props.icon || props.banner || props.styles || props.classNames || props.onClose || (closable && typeof closable !== "boolean")) return <AntAlert {...props} />;
  // Inline rich descriptions (including real actions) can use the original notice without invalid nested paragraphs.
  return <ArcLocale><ArcAlert title={noticeTitle ?? ""} tone={type === "error" ? "danger" : type} style={style} className={className}
    onDismiss={closable ? () => { setDismissed(true); afterClose?.(); } : undefined}>{description}</ArcAlert>{action && !dismissed && <div className="arc-alert-actions">{action}</div>}</ArcLocale>;
}
