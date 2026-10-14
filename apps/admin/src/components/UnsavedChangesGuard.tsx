import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { Modal } from "@/components/ui";
import { useLocale } from "@/app/locale";

/** One mounted editor per route. Keep native unload and SPA navigation separate. */
export function UnsavedChangesGuard({ dirty, busy = false }: { dirty: boolean; busy?: boolean }) {
  const { t } = useLocale();
  const blocker = useBlocker(dirty || busy);
  useEffect(() => {
    if (!dirty && !busy) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);
  useEffect(() => {
    // A save completed while navigation was pending: stay on the saved page.
    if (!dirty && !busy && blocker.state === "blocked") blocker.reset();
  }, [dirty, busy, blocker]);
  return <Modal open={blocker.state === "blocked"} title={t("有未保存的改动，确定放弃吗？")}
    mask={{ closable: false }} keyboard={!busy} closable={!busy}
    okText={t("放弃并离开")} cancelText={t("继续编辑")}
    okButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: busy }}
    onOk={() => { if (!busy && blocker.state === "blocked") blocker.proceed(); }}
    onCancel={() => { if (!busy && blocker.state === "blocked") blocker.reset(); }}>
    {t(busy ? "正在保存，请等待操作完成。" : "离开后未保存的输入将丢失。")}
  </Modal>;
}
