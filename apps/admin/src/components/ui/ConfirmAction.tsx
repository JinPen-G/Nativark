import { ConfigProvider } from "antd";
import { useEffect, useRef, useState } from "react";
import { ConfirmMorph, type ConfirmMorphProps, type ConfirmMorphState } from "@/registry/components/confirm-morph/confirm-morph";
import { useLocale } from "@/app/locale";

/** Return the actual mutation promise: rejection must never morph into a success.
 * Undo is only offered when the business API really supports it. */
export function ConfirmAction(props: ConfirmMorphProps) {
  const { t } = useLocale();
  const { componentDisabled } = ConfigProvider.useConfig();
  const disabled = props.disabled ?? componentDisabled ?? false;
  const latest = useRef({ disabled, confirm: props.onConfirm });
  latest.current = { disabled, confirm: props.onConfirm };
  const [state, setState] = useState<ConfirmMorphState>("idle");
  useEffect(() => { if (disabled && state === "confirming") setState("idle"); }, [disabled, state]);
  return <ConfirmMorph confirmLabel={t("确认")} cancelLabel={t("取消")} pendingLabel={t("处理中")}
    doneLabel={t("已完成")} errorLabel={t("操作失败")} retryLabel={t("重试")}
    undoLabel={t("撤销")} undoingLabel={t("处理中")} {...props}
    disabled={disabled} state={props.state ?? state}
    onStateChange={next => { setState(next); props.onStateChange?.(next); }}
    onConfirm={() => {
      if (latest.current.disabled) return Promise.reject(new Error(t("当前操作不可用")));
      return latest.current.confirm?.();
    }} />;
}
