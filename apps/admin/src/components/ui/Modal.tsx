import { ConfigProvider, Modal as AntModal, type ModalProps } from "antd";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "./Dialog";
import { Button } from "./Button";
import { ActionButton } from "./ActionButton";
import { useLocale } from "@/app/locale";

/** Arc owns focus, presence and motion. A stable portal preserves closed-form state. */
export function Modal(props: ModalProps & { onConfirm?: () => Promise<unknown> }) {
  const { t } = useLocale();
  const [host] = useState(() => document.createElement("div"));
  const [retained, setRetained] = useState(Boolean(props.open || props.forceRender));
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => { if (props.open) setRetained(true); }, [props.open]);
  const { open, children, title, footer, confirmLoading, onCancel, onOk, styles, width = 520 } = props;
  // These contracts cannot be represented by the public Dialog without dropping behavior.
  if (props.getContainer !== undefined || props.modalRender || props.classNames || typeof styles === "function" || props.mask === false || props.scrollLock === false || props.closeIcon || typeof props.closable === "object" || typeof width === "object" || props.focusable || props.focusTriggerAfterClose === false) {
    return <AntModal {...props} onOk={props.onConfirm ?? props.onOk} />;
  }
  const cancel = (event: Parameters<NonNullable<ModalProps["onCancel"]>>[0]) => onCancel?.(event);
  const OkBtn = () => props.onConfirm && typeof (props.okText ?? t("确定")) === "string"
    ? <ActionButton label={String(props.okText ?? t("确定"))} pending={confirmLoading} disabled={props.okButtonProps?.disabled} onAction={props.onConfirm} />
    : <Button type={props.okType === "danger" ? "primary" : props.okType ?? "primary"} danger={props.okType === "danger"} {...props.okButtonProps} loading={confirmLoading || props.okButtonProps?.loading} onClick={onOk}>{props.okText ?? t("确定")}</Button>;
  const CancelBtn = () => <Button {...props.cancelButtonProps} onClick={event => cancel(event as Parameters<typeof cancel>[0])}>{props.cancelText ?? t("取消")}</Button>;
  const defaultFooter = <>{CancelBtn()}{OkBtn()}</>;
  const renderedFooter = typeof footer === "function" ? footer(defaultFooter, { OkBtn, CancelBtn }) : footer === undefined ? defaultFooter : footer;
  return <Dialog open={Boolean(open)} onOpenChange={next => { if (!next) cancel({} as Parameters<typeof cancel>[0]); }}>
    <DialogContent title={title ?? t("提示")} closeLabel={t("关闭")} aria-describedby={undefined}
      data-rental-arc-modal="" data-closable={props.closable === false ? "false" : "true"}
      overlayStyle={{ zIndex: (props.zIndex ?? 1100) - 1, ...styles?.mask }}
      className={["rental-arc-modal", props.className, props.rootClassName, props.wrapClassName].filter(Boolean).join(" ")}
      style={{ ...styles?.container, ...props.style, width, maxWidth: "calc(100vw - var(--space-8))", zIndex: props.zIndex ?? 1100 }}
      onEscapeKeyDown={event => { if (props.keyboard === false) event.preventDefault(); }}
      onPointerDownOutside={event => { if (props.maskClosable === false || typeof props.mask === "object" && props.mask.closable === false) event.preventDefault(); }}
      onEnterComplete={() => latest.current.afterOpenChange?.(true)}
      onExitComplete={() => {
        if (latest.current.open) return;
        if (latest.current.destroyOnHidden || latest.current.destroyOnClose) setRetained(false);
        latest.current.afterClose?.(); latest.current.afterOpenChange?.(false);
      }}>
      <div ref={node => { if (node && host.parentElement !== node) node.appendChild(host); }} />
    </DialogContent>
    {(open || retained || props.forceRender) && createPortal(<ConfigProvider getPopupContainer={() => host}>
      <div style={styles?.body ?? props.bodyStyle}>{children}</div>
      {renderedFooter && <div className="arc-modal-footer" style={styles?.footer}>{renderedFooter}</div>}
    </ConfigProvider>, host)}
  </Dialog>;
}
