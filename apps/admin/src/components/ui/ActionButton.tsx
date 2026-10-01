import { ConfigProvider, type FormInstance } from "antd";
import { useRef } from "react";
import { ActionButton as ArcActionButton, type ActionButtonProps as ArcProps } from "@/registry/components/action-button/action-button";
import { useLocale } from "@/app/locale";

export interface ActionButtonProps extends Omit<ArcProps, "onAction"> {
  /** Resolve only after the real operation completes. Throw on failure. */
  onAction: () => Promise<unknown>;
  pending?: boolean;
  variant?: "primary" | "secondary";
}

/** Original Arc motion, with tenant tokens, locale and a synchronous double-click guard. */
export function ActionButton({ onAction, pending, disabled, pendingLabel, successLabel, variant = "primary", ...props }: ActionButtonProps) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const { t } = useLocale();
  const inFlight = useRef<Promise<void> | null>(null);
  const latest = useRef({ onAction, disabled: disabled ?? componentDisabled });
  latest.current = { onAction, disabled: disabled ?? componentDisabled };
  function run() {
    if (latest.current.disabled) return Promise.reject(new Error("Action disabled"));
    if (inFlight.current) return inFlight.current;
    const request = Promise.resolve().then(() => latest.current.onAction()).then(() => undefined);
    inFlight.current = request;
    void request.finally(() => { if (inFlight.current === request) inFlight.current = null; }).catch(() => undefined);
    return request;
  }
  return <ArcActionButton {...props} data-rental-arc-action="" data-rental-arc-button="" data-button-kind={variant}
    label={t(props.label)} disabled={(disabled ?? componentDisabled) || Boolean(pending && !inFlight.current)} onAction={run}
    pendingLabel={pendingLabel ?? t("处理中")} successLabel={successLabel ?? t("已完成")} />;
}

export interface SaveButtonProps<Values> extends Omit<ActionButtonProps, "onAction" | "form"> {
  form: FormInstance<Values>;
  onSave: (values: Values) => Promise<unknown>;
}

/** Validate first, then await the same mutation as Enter-key submission. No synthetic submit/click. */
export function SaveButton<Values>({ form, onSave, ...props }: SaveButtonProps<Values>) {
  const { t } = useLocale();
  return <ActionButton {...props} type="submit" onClickCapture={(event) => {
    // Preserve the browser's implicit Enter-key submit button, but prevent a second native
    // onFinish request. Arc's click handler below validates and awaits the single mutation.
    props.onClickCapture?.(event);
    event.preventDefault();
  }} pendingLabel={props.pendingLabel ?? t("保存中")}
    successLabel={props.successLabel ?? t("已保存")} onAction={async () => {
      const values = await form.validateFields();
      return onSave(values);
    }} />;
}
