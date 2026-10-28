import { ConfigProvider, Modal as AntModal, type ModalProps } from "antd";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "./Dialog";
import { Button } from "./Button";
import { ActionButton } from "./ActionButton";
import { useLocale } from "@/app/locale";
import { ADMIN_OVERLAY_METRICS } from "@/app/designTokens";
import { OperationSheet } from "./OperationSheet";

export type ModalPresentation = "dialog" | "side" | "bottom";

/** Arc owns focus, presence and motion. A stable portal preserves closed-form state. */
export function Modal(props: ModalProps & { onConfirm?: () => Promise<unknown>; presentation?: ModalPresentation }) {
  const { t } = useLocale();
  const [host] = useState(() => document.createElement("div"));
  const [retained, setRetained] = useState(Boolean(props.open || props.forceRender));
  const latest = useRef(props);
  latest.current = props;
  const wasOpen = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  if (props.open && !wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = Boolean(props.open);
  useEffect(() => { if (props.open) setRetained(true); }, [props.open]);
  const { open, children, title, footer, confirmLoading, onCancel, onOk, styles, presentation = "dialog",
    width = presentation === "dialog" ? ADMIN_OVERLAY_METRICS.dialogWidth : presentation === "side" ? ADMIN_OVERLAY_METRICS.sideWidth : ADMIN_OVERLAY_METRICS.bottomWidth } = props;
  // These contracts cannot be represented by the public Dialog without dropping behavior.
  if (props.getContainer !== undefined || props.modalRender || props.classNames || typeof styles === "function" || props.mask === false || props.scrollLock === false || props.closeIcon || typeof props.closable === "object" || typeof width === "object" || props.focusable || props.focusTriggerAfterClose === false) {
    const { presentation: _presentation, onConfirm: _onConfirm, ...nativeProps } = props;
    return <AntModal {...nativeProps} onOk={props.onConfirm ?? props.onOk} />;
  }
  const cancel = (event: Parameters<NonNullable<ModalProps["onCancel"]>>[0]) => onCancel?.(event);
  const OkBtn = () => props.onConfirm && typeof (props.okText ?? t("确定")) === "string"
    ? <ActionButton label={String(props.okText ?? t("确定"))} pending={confirmLoading} disabled={props.okButtonProps?.disabled} onAction={props.onConfirm} />
    : <Button type={props.okType === "danger" ? "primary" : props.okType ?? "primary"} danger={props.okType === "danger"} {...props.okButtonProps} loading={confirmLoading || props.okButtonProps?.loading} onClick={onOk}>{props.okText ?? t("确定")}</Button>;
  const CancelBtn = () => <Button {...props.cancelButtonProps} onClick={event => cancel(event as Parameters<typeof cancel>[0])}>{props.cancelText ?? t("取消")}</Button>;
  const defaultFooter = <>{CancelBtn()}{OkBtn()}</>;
  const renderedFooter = typeof footer === "function" ? footer(defaultFooter, { OkBtn, CancelBtn }) : footer === undefined ? defaultFooter : footer;
  const close = () => cancel({} as Parameters<typeof cancel>[0]);
  const returnFocus = (event: Event) => {
    if (!latest.current.open && opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); }
  };
  const entered = () => latest.current.afterOpenChange?.(true);
  const exited = () => {
    if (latest.current.open) return;
    if (latest.current.destroyOnHidden || latest.current.destroyOnClose) setRetained(false);
    latest.current.afterClose?.(); latest.current.afterOpenChange?.(false);
  };
  const mount = <div className="arc-modal-mount" ref={node => { if (node && host.parentElement !== node) node.appendChild(host); host.className = "arc-modal-portal"; }} />;
  const sheet = presentation !== "dialog" && <OperationSheet open={Boolean(open)} title={title ?? t("提示")}
    side={presentation === "side" ? "right" : "bottom"} width={width}
    className={[props.className, props.rootClassName, props.wrapClassName].filter(Boolean).join(" ")}
    style={{ ...styles?.container, ...props.style }} backdropStyle={styles?.mask}
    keyboard={props.keyboard} maskClosable={props.maskClosable ?? (typeof props.mask === "object" ? props.mask.closable : undefined)} closable={props.closable}
    onClose={close} onCloseAutoFocus={returnFocus} onOpenChangeComplete={next => next ? entered() : exited()}>{mount}</OperationSheet>;
  return <>{sheet || <Dialog open={Boolean(open)} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent title={title ?? t("提示")} closeLabel={t("关闭")} aria-describedby={undefined}
      data-rental-arc-modal="" data-closable={props.closable === false ? "false" : "true"}
      overlayStyle={{ zIndex: (props.zIndex ?? 1100) - 1, ...styles?.mask }}
      className={["rental-arc-modal", props.className, props.rootClassName, props.wrapClassName].filter(Boolean).join(" ")}
      style={{ ...styles?.container, ...props.style, width, maxWidth: "calc(100vw - var(--space-8))", zIndex: props.zIndex ?? 1100 }}
      onEscapeKeyDown={event => { if (props.keyboard === false) event.preventDefault(); }}
      onPointerDownOutside={event => { if (props.maskClosable === false || typeof props.mask === "object" && props.mask.closable === false) event.preventDefault(); }}
      onCloseAutoFocus={returnFocus}
      onEnterComplete={entered} onExitComplete={exited}>
      {mount}
    </DialogContent>
  </Dialog>}
    {(open || retained || props.forceRender) && createPortal(<ConfigProvider getPopupContainer={() => host}>
      <div className="arc-modal-body" style={styles?.body ?? props.bodyStyle}>{children}</div>
      {renderedFooter && <div className="arc-modal-footer" style={styles?.footer}>{renderedFooter}</div>}
    </ConfigProvider>, host)}
  </>;
}
