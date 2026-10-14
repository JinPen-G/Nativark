import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ModalFuncProps } from "antd";
import { Modal } from "./Modal";
import { ActionButton } from "./ActionButton";
import { Button } from "./Button";
import { useLocale } from "@/app/locale";

type Handle = { destroy: () => void; update: (patch: Partial<ModalFuncProps> | ((previous: ModalFuncProps) => ModalFuncProps)) => void; then: Promise<boolean>["then"] };
type Record = { id: number; config: ModalFuncProps; open: boolean; resolve: (result: boolean) => void };
type Api = { [K in "confirm" | "info" | "success" | "error" | "warning" | "warn"]: (config: ModalFuncProps) => Handle };
const Context = createContext<Api | null>(null);
export function useModalFeedback() {
  const api = useContext(Context);
  if (!api) throw new Error("Modal feedback requires FeedbackProvider");
  return api;
}
export function ModalFeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const sequence = useRef(0);
  const [records, setRecords] = useState<Record[]>([]);
  const close = (id: number, result = false) => setRecords(previous => previous.map(row => {
    if (row.id !== id || !row.open) return row;
    row.resolve(result); return { ...row, open: false };
  }));
  const api = useMemo(() => {
    const show = (config: ModalFuncProps, type: ModalFuncProps["type"]): Handle => {
      const id = ++sequence.current;
      let resolve!: (result: boolean) => void;
      const completion = new Promise<boolean>(done => { resolve = done; });
      setRecords(previous => [...previous, { id, config: { ...config, type }, open: true, resolve }]);
      return { destroy: () => close(id), update: patch => setRecords(previous => previous.map(row => row.id === id ? { ...row, config: typeof patch === "function" ? patch(row.config) : { ...row.config, ...patch } } : row)), then: completion.then.bind(completion) };
    };
    return { confirm: config => show(config, "confirm"), info: config => show(config, "info"), success: config => show(config, "success"), error: config => show(config, "error"), warning: config => show(config, "warning"), warn: config => show(config, "warning") } satisfies Api;
  }, []);
  return <Context.Provider value={api}>{children}{records.map(({ id, config, open }, index) => {
    const showCancel = config.okCancel ?? config.type === "confirm";
    const run = async () => {
      const result = await config.onOk?.(() => close(id, true));
      if (result !== true && !config.onOk?.length) close(id, true);
    };
    const cancel = () => {
      const result = config.onCancel?.(() => close(id));
      if (result !== true && !config.onCancel?.length) close(id);
    };
    return <Modal key={id} {...config} zIndex={config.zIndex ?? 1200 + index * 2} open={open} onOk={undefined} onCancel={cancel} destroyOnHidden
      mask={config.mask ?? { closable: config.maskClosable ?? false }}
      afterClose={() => { config.afterClose?.(); setRecords(previous => previous.filter(row => row.id !== id)); }}
      footer={config.footer === undefined ? <>{showCancel && <Button {...config.cancelButtonProps} onClick={cancel}>{config.cancelText ?? t("取消")}</Button>}<ActionButton label={typeof config.okText === "string" ? config.okText : t("确定")} disabled={config.okButtonProps?.disabled} onAction={run} /></> : config.footer}>
      {config.icon}{config.content}
    </Modal>;
  })}</Context.Provider>;
}
