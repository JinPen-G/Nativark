/** 订单表单把异步校验固定到当前对象，按钮和原生回车共用公共 Core 表单提交。 */
import { useLayoutEffect, useRef } from "react";
import type { FormInstance, FormProps } from "antd";
import { useCoreForm } from "@rental-os/platform-admin/core";
import { useFeedback } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";

export function useOrderEditor<Values>({ form, identity, onSave, disabled = false }: {
  form: FormInstance<Values>;
  identity?: string;
  onSave: (values: Values) => Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const { toast } = useFeedback();
  const owner = useRef({ identity, sequence: 0, active: true });
  const submission = useRef<{ key: string; request: Promise<unknown> } | undefined>(undefined);
  if (owner.current.identity !== identity) {
    owner.current.identity = identity;
    owner.current.sequence += 1;
  }
  const key = JSON.stringify([identity, owner.current.sequence]);
  const isCurrent = (expected = key) => owner.current.active && Boolean(owner.current.identity)
    && expected === JSON.stringify([owner.current.identity, owner.current.sequence]);
  const assertCurrent = (expected: string) => {
    if (!isCurrent(expected))
      throw new DOMException("订单编辑对象已变化", "AbortError");
  };
  useLayoutEffect(() => {
    owner.current.active = true;
    return () => { owner.current.active = false; };
  }, []);

  const core = useCoreForm({ form, disabled: !identity || disabled, onSave: values => {
    assertCurrent(submission.current?.key ?? "");
    return onSave(values);
  } });
  const submit = (values: Values): Promise<unknown> => {
    try {
      assertCurrent(key);
      if (submission.current && submission.current.key !== key)
        throw new Error(t("正在保存，请等待操作完成。"));
    } catch (error) { return Promise.reject(error); }
    const request = core.submit(values);
    if (!submission.current) submission.current = { key, request };
    void request.finally(() => {
      if (submission.current?.request === request) submission.current = undefined;
    }).catch(() => undefined);
    return request;
  };
  type Validation = FormInstance<Values>["validateFields"];
  // 原 Form 两种校验重载共用当前编辑代次，参数原样转交。
  const validate: Validation = async (...args: Parameters<Validation> | [options?: Parameters<Validation>[1]]) => {
    assertCurrent(key);
    const values = await form.validateFields(...args as Parameters<Validation>);
    assertCurrent(key);
    return values;
  };
  const confirm = async (): Promise<unknown> => submit(await validate());
  const dismiss = (close: () => unknown) => {
    // 请求已经派发时保留这一编辑对象，原响应不能关闭后来重开的表单。
    if (!submission.current) return close();
  };
  const formProps: Pick<FormProps<Values>, "onValuesChange" | "onSubmitCapture"> = {
    onValuesChange: core.formProps.onValuesChange,
    onSubmitCapture: event => {
      // AntD 的 onFinish 会读取更新后的回调，原生提交须自行等待这次打开代次的校验。
      event.preventDefault();
      event.stopPropagation();
      void validate().then(values => {
        const pending = submission.current;
        const request = submit(values);
        if (pending?.request !== request) return request;
      }).catch(error => {
        if (isCurrent(key) && !(error && typeof error === "object" && "errorFields" in error))
          toast({ type: "error", title: t("操作失败") });
      });
    }
  };
  return { ...core, key, isCurrent, submit, validate, confirm, dismiss, formProps };
}
