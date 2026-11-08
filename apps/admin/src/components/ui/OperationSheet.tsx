/** Task sheets use the existing Radix/UIArc stack, keeping form popups and nested confirmations interoperable. */
import type { CSSProperties, ReactNode } from "react";
import { useLocale } from "@/app/locale";
import { Drawer, DrawerContent } from "./TaskDrawer";
import { hasOpenFormPopup } from "./overlayPopups";
import styles from "./OperationSheet.module.css";

interface OperationSheetProps {
  open: boolean;
  title: ReactNode;
  side: "right" | "bottom";
  width: CSSProperties["width"];
  style?: CSSProperties;
  backdropStyle?: CSSProperties;
  className?: string;
  keyboard?: boolean;
  maskClosable?: boolean;
  closable?: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onOpenChangeComplete: (open: boolean) => void;
  children: ReactNode;
}

export function OperationSheet({ open, title, side, width, style, backdropStyle, className, keyboard, maskClosable, closable, onClose, onCloseAutoFocus, onOpenChangeComplete, children }: OperationSheetProps) {
  const { t } = useLocale();
  return <Drawer open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DrawerContent title={title} closeLabel={t("关闭")} side={side}
      dragEnabled={side === "bottom" && closable !== false && keyboard !== false && maskClosable !== false}
      data-rental-operation-sheet="" data-rental-arc-modal="" data-closable={closable === false ? "false" : "true"}
      aria-describedby={undefined} className={[styles.popup, "rental-operation-sheet", className].filter(Boolean).join(" ")}
      style={{ width, ...style }} overlayStyle={{ zIndex: 1099, ...backdropStyle }}
      onEscapeKeyDown={event => { if (keyboard === false || hasOpenFormPopup(event.target)) event.preventDefault(); }}
      onInteractOutside={event => { if (maskClosable === false) event.preventDefault(); }}
      onCloseAutoFocus={onCloseAutoFocus}
      onEnterComplete={() => onOpenChangeComplete(true)} onExitComplete={() => onOpenChangeComplete(false)}>
      {children}
    </DrawerContent>
  </Drawer>;
}
