/** 匿名邮箱邀请页消费宿主端口，接受结果待核对时以原凭证读取最小结果并进入租户登录。 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TenantOperatorInvitationPreview } from "@rental-os/platform-contracts";
import { useLocale } from "../../app/locale";
import { ActionButton, Alert, Button, Form, Input, PasswordStrength, SaveButton } from "../../components/ui";
import { LoadingState } from "../../components/LoadingState";
import type { OperatorInvitationApi } from "./client";
import loginStyles from "@/registry/blocks/login-centered/login-centered.module.css";

type Values = { displayName: string; password: string; confirmation: string };

export interface AcceptOperatorInvitationPageProps {
  api: OperatorInvitationApi;
  brandName: string;
  brandMark?: string;
  invitationTitle?: string;
  businessScopeLabel?: string;
}

export function AcceptOperatorInvitationPage({ api, brandName, brandMark, invitationTitle = "接受成员邀请", businessScopeLabel }: AcceptOperatorInvitationPageProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const token = useRef(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [form] = Form.useForm<Values>();
  const [preview, setPreview] = useState<TenantOperatorInvitationPreview>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [accepted, setAccepted] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const accepting = useRef<Promise<void> | null>(null);
  const password = Form.useWatch("password", form) ?? "";

  useEffect(() => { document.title = `${t(invitationTitle)} · ${brandName}`; }, [t, brandName, invitationTitle]);

  useEffect(() => {
    const abort = new AbortController();
    if (!token.current) {
      setError(t("邀请链接无效，请向邀请人索取原邮件。"));
      setLoading(false);
      return;
    }
    api.inspect(token.current, abort.signal).then(data => {
      if (abort.signal.aborted) return;
      setPreview(data);
      if (data.status === "accepted") {
        form.resetFields();
        token.current = "";
        setAccepted(true);
      } else form.setFieldValue("displayName", data.displayName);
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted) setError((failure as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? t("邀请暂时不可读取，请稍后重试。"));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [api, form]);

  function accept(values: Values): Promise<void> {
    if (accepting.current) return accepting.current;
    if (unconfirmed) return Promise.reject(new Error(t("接受结果暂未确认。请使用邮箱登录核对，勿重复提交。")));
    setPending(true);
    setError(undefined);
    const input = { token: token.current, displayName: values.displayName, password: values.password };
    const request = Promise.resolve().then(() => api.accept(input)).then(() => {
      form.resetFields();
      token.current = "";
      setAccepted(true);
    }).catch((failure: unknown) => {
      const status = (failure as { response?: { status?: number } })?.response?.status;
      if (!status || status >= 500 || status === 408) setUnconfirmed(true);
      const message = (failure as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? t("接受结果暂未确认。请使用邮箱登录核对，勿重复提交。");
      setError(message);
      throw failure;
    }).finally(() => {
      accepting.current = null;
      setPending(false);
    });
    accepting.current = request;
    return request;
  }

  async function readAcceptance() {
    const result = await api.inspect(token.current);
    if (result.status !== "accepted") throw new Error(t("原邀请尚未确认接受，请稍后核对。"));
    setPreview(result);
    form.resetFields();
    token.current = "";
    setAccepted(true);
    setError(undefined);
  }

  return <main className={`${loginStyles.screen} ${loginStyles.fullScreen}`}>
    <header className={loginStyles.bar}><span className={loginStyles.mark}>
      {brandMark && <img src={brandMark} alt="" width={24} height={24} />}{brandName}
    </span></header>
    <div className={loginStyles.stage}><section className={loginStyles.card}><div className={loginStyles.step}>
      <div className={loginStyles.heading}><h2>{t(accepted ? "你已加入租户" : invitationTitle)}</h2>
        <p>{preview?.status === "pending" ? `${preview.tenantName} · ${preview.email}`
          : accepted ? t("邀请已接受") : t("设置你的账号，开始协同工作。")}</p></div>
      {loading ? <LoadingState /> : accepted ? <>
        <p>{t("请使用邮箱和接受邀请时设置的密码登录。")}</p>
        <Button type="primary" onClick={() => navigate(`/login/${encodeURIComponent(preview!.tenantCode)}`)}>{t("前往登录")}</Button>
      </> : <>
        {error && <Alert type="error" showIcon title={error} />}
        {preview?.status === "pending" && <>
          <p>{t("租户基础角色")}：{preview.roleNames.join("、")}
            {(businessScopeLabel || preview.workspaceNames.length > 0) && <><br />{t(businessScopeLabel ?? "业务范围")}：{preview.workspaceNames.join("、")}</>}</p>
          {unconfirmed && <>
            <ActionButton label={t("核对原接受结果")} onAction={readAcceptance} />
            <Button onClick={() => navigate(`/login/${encodeURIComponent(preview.tenantCode)}`)}>{t("前往登录核对")}</Button>
          </>}
          <Form<Values> form={form} layout="vertical" disabled={pending || unconfirmed}
            onFinish={values => { void accept(values).catch(() => undefined); }}>
            <Form.Item name="displayName" label={t("姓名")} rules={[{ required: true, whitespace: true, max: 100 }]}><Input autoComplete="name" /></Form.Item>
            <Form.Item name="password" label={t("设置密码")} rules={[{ required: true, min: preview.minPasswordLength, max: 128 },
              { validator: (_, value: string) => value && /[A-Za-z]/u.test(value) && /\d/u.test(value) && /[^A-Za-z0-9]/u.test(value)
                ? Promise.resolve() : Promise.reject(new Error(t("密码须包含字母、数字和特殊字符"))) }]}><Input.Password autoComplete="new-password" /></Form.Item>
            <PasswordStrength label={t("密码要求")} value={password} rules={[
              { id: "length", label: `${t("至少")} ${preview.minPasswordLength} ${t("个字符")}`, test: value => value.length >= preview.minPasswordLength },
              { id: "letter", label: t("至少一个字母"), test: value => /[A-Za-z]/u.test(value) },
              { id: "number", label: t("至少一个数字"), test: value => /\d/u.test(value) },
              { id: "symbol", label: t("至少一个特殊字符"), test: value => /[^A-Za-z0-9]/u.test(value) }
            ]} />
            <Form.Item name="confirmation" label={t("确认密码")} dependencies={["password"]} rules={[{ required: true },
              { validator: (_, value) => value === form.getFieldValue("password") ? Promise.resolve()
                : Promise.reject(new Error(t("两次密码输入不一致"))) }]}><Input.Password autoComplete="new-password" /></Form.Item>
            <SaveButton form={form} label={t("接受邀请并创建账号")} pending={pending} disabled={unconfirmed} onSave={accept} />
          </Form>
        </>}
      </>}
    </div></section></div>
    <footer className={loginStyles.foot}><span>{t("邀请仅在有效期内可用；已存在账号无需接受邀请。")}</span></footer>
  </main>;
}
