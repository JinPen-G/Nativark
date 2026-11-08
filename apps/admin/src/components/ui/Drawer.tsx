import { ConfigProvider, Drawer as AntDrawer, type DrawerProps } from "antd";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Drawer as ArcDrawer, DrawerContent } from "@/registry/components/drawer/drawer";
import { useLocale } from "@/app/locale";
import { Modal, type ModalPresentation } from "./Modal";
import { Button } from "./Button";
import { hasOpenFormPopup } from "./overlayPopups";

function HeaderActions({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [header, setHeader] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const content = anchor.current?.closest<HTMLElement>('[data-rental-arc-drawer]');
    if (content) {
      const level = Array.from(document.querySelectorAll('[data-rental-arc-drawer]')).indexOf(content);
      content.style.zIndex = String(920 + Math.max(0, level) * 20);
      const overlay = content.previousElementSibling;
      if (overlay instanceof HTMLElement) overlay.style.zIndex = String(919 + Math.max(0, level) * 20);
      content.querySelector('button[aria-label="Close drawer"]')?.setAttribute("aria-label", closeLabel);
    }
    setHeader(content?.querySelector(':scope > div') ?? null);
  }, [closeLabel]);
  return <><span ref={anchor} hidden />{header && createPortal(<div className="arc-drawer-actions">{children}</div>, header)}</>;
}

/** Arc owns entrance/exit/drag, backdrop, focus trap and Escape. The adapter preserves business headers and form popups. */
export function Drawer(props: DrawerProps & { presentation?: ModalPresentation }) {
  const { t } = useLocale();
  const popupAnchor = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  if (props.open && !wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = Boolean(props.open);
  const { open, onClose, children, title, extra, size, width, height, placement = "right", className, styles, footer, presentation = "side" } = props;
  if (presentation !== "side" && props.getContainer === undefined && !props.loading && !props.rootStyle && !props.classNames && !props.closeIcon && props.mask !== false && typeof styles !== "function") {
    const close = () => onClose?.({} as Parameters<NonNullable<DrawerProps["onClose"]>>[0]);
    return <Modal presentation={presentation} open={open} title={title} width={typeof size === "number" ? size : width}
      onCancel={close} destroyOnHidden={props.destroyOnHidden} forceRender={props.forceRender}
      keyboard={props.keyboard} maskClosable={props.maskClosable} closable={props.closable}
      afterOpenChange={props.afterOpenChange} zIndex={props.zIndex}
      className={className} style={props.style} styles={typeof styles === "object" ? { body: styles.body, footer: styles.footer } : undefined}
      footer={extra || footer ? <><Button onClick={close}>{t("取消")}</Button>{footer}{extra}</> : null}>{children}</Modal>;
  }
  // Preserve keep-alive drawers and special shell/loading/custom-container behavior rather than silently changing it.
  if (!props.destroyOnHidden || props.closable === false || props.mask === false || props.forceRender || props.loading || props.getContainer !== undefined || props.afterOpenChange || props.closeIcon || props.zIndex || props.rootStyle || props.classNames || typeof styles === "function" || styles?.header || styles?.mask || styles?.wrapper || styles?.root || typeof title !== "string") {
    const { presentation: _presentation, ...nativeProps } = props;
    return <AntDrawer {...nativeProps} />;
  }
  const dimension = typeof size === "number" ? size : size === "large" ? 736 : width ?? 480;
  return <ArcDrawer open={Boolean(open)} onOpenChange={next => { if (!next) onClose?.({} as Parameters<NonNullable<DrawerProps["onClose"]>>[0]); }}>
    <DrawerContent title={title} side={placement} className={["rental-arc-drawer", className].filter(Boolean).join(" ")} data-rental-arc-drawer=""
      style={{ ...(placement === "right" || placement === "left" ? { width: dimension } : { height: height ?? dimension }), ...props.style }}
      onEscapeKeyDown={event => {
        // An AntD modal lives inside the Radix focus scope. Its Escape must not also
        // dismiss the parent drawer; let the modal handle the same key normally.
        const modalOpen = Array.from(document.querySelectorAll<HTMLElement>(".ant-modal-wrap, [data-rental-arc-modal][data-state='open']"))
          .some(modal => modal.getClientRects().length > 0 && getComputedStyle(modal).visibility !== "hidden");
        if (props.keyboard === false || modalOpen || hasOpenFormPopup(event.target)) event.preventDefault();
      }}
      onInteractOutside={event => { if (props.maskClosable === false) event.preventDefault(); }}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); } }}
      aria-describedby={undefined}>
      <ConfigProvider getPopupContainer={trigger => trigger?.closest<HTMLElement>('[data-rental-arc-drawer]') ?? popupAnchor.current?.closest<HTMLElement>('[data-rental-arc-drawer]') ?? document.body}>
        <span hidden ref={popupAnchor} />
        <HeaderActions closeLabel={t("关闭")}>{extra}</HeaderActions>
        <div style={styles?.body}>{children}</div>
        {footer && <div className="arc-drawer-footer" style={styles?.footer}>{footer}</div>}
      </ConfigProvider>
    </DrawerContent>
  </ArcDrawer>;
}
