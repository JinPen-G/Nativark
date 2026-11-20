/** Core表单复用原Form、保存快照和离页保护，校验及完成反馈绑定原表单实例/代次。
 * 业务转换、原操作与unknown由Core自己的保存方法负责，失效不证明原写入已回滚。 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FormInstance, FormProps } from "antd";
import type { CorePageDescriptor } from "@rental-os/core-contracts";
import { formSnapshotFingerprint, notifyFormSaved } from "../app/serverFormSnapshot";
import { useLocale } from "../app/locale";
import { useFeedback } from "../components/ui";
import { useCorePageHost } from "./CorePage";

/** 将已校验的表单值交给唯一保存方法，共用按钮/回车提交、等待、失败及未保存草稿状态。 */
export function useCoreForm<Values>({ form, onSave, permissions = [], disabled = false }: {
  form: FormInstance<Values>;
  onSave: (values: Values) => Promise<unknown>;
  permissions?: CorePageDescriptor["permissions"];
  disabled?: boolean;
}) {
  const host = useCorePageHost(), { t } = useLocale(), { toast } = useFeedback();
  const generation = JSON.stringify([host.lifetimeKey, host.page.key]);
  const live = useRef({ host, onSave, permissions, disabled, active: false });
  Object.assign(live.current, { host, onSave, permissions, disabled });
  const lifetime = useRef({ form, generation });
  if (lifetime.current.form !== form || lifetime.current.generation !== generation)
    lifetime.current = { form, generation };
  const opening = lifetime.current;
  const baseline = useRef<string | undefined>(undefined);
  const inFlight = useRef<{ request: Promise<unknown>; values: string } | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const isCurrent = () => live.current.active && lifetime.current === opening
    && generation === JSON.stringify([live.current.host.lifetimeKey, live.current.host.page.key]);

  useLayoutEffect(() => {
    live.current.active = true;
    baseline.current = formSnapshotFingerprint(form.getFieldsValue(true));
    inFlight.current = null; setDirty(false); setBusy(false); setError(undefined);
    return () => { live.current.active = false; };
  }, [form, generation]);

  const submit = useCallback((values: Values): Promise<unknown> => {
    const current = () => {
      const value = live.current;
      if (!isCurrent())
        throw new DOMException("当前Core表单已失效", "AbortError");
      if (!value.host.canAccess(value.host.page.coreId, [...value.host.page.definition.permissions, ...value.permissions]))
        throw new Error(t("当前操作不可用"));
      return value;
    };
    let value: typeof live.current;
    try { value = current(); } catch (failure) { return Promise.reject(failure); }
    const fingerprint = formSnapshotFingerprint(values);
    if (inFlight.current) return fingerprint === inFlight.current.values ? inFlight.current.request
      : Promise.reject(new Error(t("正在保存，请等待操作完成。")));
    if (value.disabled) return Promise.reject(new Error(t("当前操作不可用")));
    const snapshot = formSnapshotFingerprint(form.getFieldsValue(true));
    const matchesValidated = formSnapshotFingerprint(form.getFieldsValue()) === fingerprint;
    setBusy(true); setError(undefined);
    const request = Promise.resolve().then(() => {
      const latest = current();
      if (latest.disabled) throw new Error(t("当前操作不可用"));
      return latest.onSave(values);
    }).then(result => {
      current();
      // 异步校验期间的新输入也未随本次values提交，不能把它标成已保存。
      if (matchesValidated) {
        baseline.current = snapshot;
        setDirty(formSnapshotFingerprint(form.getFieldsValue(true)) !== snapshot);
        notifyFormSaved(form, snapshot);
      }
      else setDirty(true);
      return result;
    }).catch(failure => {
      if (isCurrent()) setError(failure);
      throw failure;
    }).finally(() => {
      if (inFlight.current?.request === request) inFlight.current = null;
      if (isCurrent()) setBusy(false);
    });
    inFlight.current = { request, values: fingerprint };
    return request;
  }, [form, generation, opening, t]);

  const formProps: Pick<FormProps<Values>, "onValuesChange" | "onFinish"> = {
    onValuesChange: () => { if (isCurrent()) setDirty(formSnapshotFingerprint(form.getFieldsValue(true)) !== baseline.current); },
    // AntForm不会等待onFinish的Promise；事件出口处理反馈，submit仍向按钮/调用者返回真实拒绝。
    onFinish: values => {
      const existing = inFlight.current;
      const request = submit(values);
      if (existing?.request === request) return; // 初次入口已负责同一请求反馈，回车重入不重复播报。
      void request.catch(failure => {
        if (isCurrent() && !(failure && typeof failure === "object" && "errorFields" in failure))
          toast({ type: "error", title: t("操作失败") });
      });
    }
  };
  const markClean = () => {
    if (isCurrent()) {
      baseline.current = formSnapshotFingerprint(form.getFieldsValue(true));
      setDirty(false);
      notifyFormSaved(form, baseline.current);
    }
  };
  return { submit, formProps, dirty, busy, error, markClean };
}
