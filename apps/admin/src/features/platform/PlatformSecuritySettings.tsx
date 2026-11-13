/** One platform security contract, with shared draft protection and a single validated save across visible sections. */
import { useState } from "react";
import { Col, InputNumber, Row } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { SystemSecurityBaselineConfig } from "@rental-os/shared";
import { api } from "@/api/platform";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { useServerFormSync } from "@/app/useServerFormSync";
import { QueryState } from "@/components/QueryState";
import { RecordFacts } from "@/components/RecordDetailLayout";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { WorkspacePageActions } from "@/components/workspace/WorkspaceHeader";
import { ActionButton, Alert, App, Button, ConfirmAction, Form, FormSection, SaveButton, Select, Switch } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import styles from "./PlatformSettings.module.css";

export function PlatformSecuritySettings() {
  const { t } = useLocale();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const allowed = useAuthStore(state => state.hasPermission("system:params:manage"));
  const canSave = useAuthStore(state => Boolean(state.user?.isSaasAdmin) && state.hasPermission("system:params:manage"));
  const [form] = Form.useForm<SystemSecurityBaselineConfig>();
  const [resetVersion, setResetVersion] = useState(0);
  const security = useQuery({ queryKey: ["security-baseline"], queryFn: api.securityBaseline, enabled: allowed });
  const isCurrent = useServerFormSync(form, security.data, () => { if (security.data) form.setFieldsValue(security.data); }, String(resetVersion));
  const save = useMutation({
    mutationFn: (config: SystemSecurityBaselineConfig) => {
      if (!canSave) throw new Error(t("当前没有平台参数管理权限"));
      if (!isCurrent()) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      return api.saveSecurityBaseline(config);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["security-baseline"] }); message.success(t("安全基线已保存")); },
    onError: (error: Error) => message.error(error.message || t("安全基线保存失败")),
  });
  if (!allowed) return <Alert type="warning" showIcon title={t("当前没有平台参数管理权限")} />;
  return <QueryState loading={security.isLoading} error={security.error} onRetry={() => security.refetch({ throwOnError: true })}>
    {security.data && <Form form={form} layout="vertical" disabled={!canSave || save.isPending} onFinish={values => save.mutate(values)}>
      <WorkspacePageActions>{canSave && <SaveButton label={t("保存安全基线")} form={form} pending={save.isPending} onSave={values => save.mutateAsync(values)} />}</WorkspacePageActions>
      <SettingsWorkspace sections={[
        { key: "login", label: t("登录限流"), content: <FormSection title={t("登录限流")}>
          <Form.Item name={["loginRateLimit", "enabled"]} label={t("启用失败锁定")} valuePropName="checked"><Switch /></Form.Item>
          <Row gutter={16}>
            {([["maxFailures", "最大失败次数"], ["windowMinutes", "统计窗口（分钟）"], ["lockMinutes", "锁定时长（分钟）"]] as const).map(([key, label]) => <Col span={8} key={key}><Form.Item name={["loginRateLimit", key]} label={t(label)} rules={[{ required: true, type: "number", min: 1 }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>)}
          </Row>
        </FormSection> },
        { key: "password", label: t("密码策略"), content: <FormSection title={t("密码策略")}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name={["passwordPolicy", "minLength"]} label={t("最小长度")} rules={[{ required: true, type: "number", min: 8 }]}><InputNumber min={8} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name={["passwordPolicy", "expireDays"]} label={t("有效天数")} rules={[{ required: true, type: "number", min: 0 }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            {([["requireLetter", "必须含字母"], ["requireNumber", "必须含数字"], ["disallowDefaultPassword", "禁用默认密码"]] as const).map(([key, label]) => <Col span={8} key={key}><Form.Item name={["passwordPolicy", key]} label={t(label)} valuePropName="checked"><Switch /></Form.Item></Col>)}
          </Row>
        </FormSection> },
        { key: "masking", label: t("敏感信息脱敏"), content: <FormSection title={t("敏感信息脱敏")}>
          <Row gutter={16}>
            {([["phone", "手机号"], ["identityNo", "身份证"], ["driverLicenseNo", "资质证件"], ["email", "邮箱"], ["apiKey", "API Key"]] as const).map(([key, label]) => <Col span={8} key={key}><Form.Item name={["masking", key]} label={t(label)} valuePropName="checked"><Switch /></Form.Item></Col>)}
          </Row>
        </FormSection> },
        { key: "confirmation", label: t("二次确认"), content: <FormSection title={t("高风险操作二次确认")}>
          <Alert type="warning" showIcon title={t("二次确认校验仍为预留能力")} description={t("此处保存受控动作配置，不能作为生产操作已通过身份核验的依据。")}/>
          <Form.Item name={["secondConfirmation", "enabled"]} label={t("启用")} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name={["secondConfirmation", "actions"]} label={t("受控动作")}><Select mode="tags" tokenSeparators={[","]} /></Form.Item>
        </FormSection> },
      ]} footer={<>
        {save.error && <Alert type="error" showIcon title={save.error.message} />}
        <ConfirmAction label={t("重新读取配置")} disabled={save.isPending || security.isFetching} prompt={t("重新读取会清除尚未保存的修改，是否继续？")} onConfirm={async () => {
          await security.refetch({ throwOnError: true });
          // Explicitly reloading permits discarding a stale draft; background refetch never does.
          form.resetFields(); setResetVersion(value => value + 1); save.reset();
        }} />
      </>} />
      {!canSave && <p className={styles.context}>{t("当前仅可查看，全平台安全设置须由获权的平台管理员保存。")}</p>}
    </Form>}
  </QueryState>;
}

/** Operations reads only the platform baseline. Tenant integrations and files are not part of this audience. */
export function PlatformSecurityOverview() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const allowed = useAuthStore(state => state.hasPermission("system:params:manage"));
  const security = useQuery({ queryKey: ["security-baseline"], queryFn: api.securityBaseline, enabled: allowed });
  if (!allowed) return <Alert type="warning" showIcon title={t("当前没有平台参数管理权限")} />;
  return <QueryState loading={security.isLoading} error={security.error} onRetry={() => security.refetch({ throwOnError: true })}>
    {security.data && <div className={styles.stack}>
      <FormSection title={t("安全基线")}>
        <RecordFacts items={[
          { key: "login-lock", label: t("启用失败锁定"), value: t(security.data.loginRateLimit.enabled ? "已启用" : "未启用") },
          { key: "password-length", label: t("密码最小长度"), value: security.data.passwordPolicy.minLength },
          { key: "default-password", label: t("禁用默认密码"), value: t(security.data.passwordPolicy.disallowDefaultPassword ? "已启用" : "未启用") },
          { key: "second-confirmation", label: t("二次确认"), value: t("校验能力尚未开放") },
        ]} />
        <div className={styles.controls}>
          <Button type="primary" onClick={() => navigate(APP_ROUTES.platformSystem.path)}>{t("管理安全基线")}</Button>
          <ActionButton label={t("刷新")} variant="secondary" pending={security.isFetching} onAction={() => security.refetch({ throwOnError: true })} />
        </div>
      </FormSection>
      <Alert type="info" showIcon title={t("租户运维能力不在平台账号的访问范围内")} description={t("文件、通知、异步任务与适配器数据须在对应租户的授权范围内管理。平台参数权限不会开放这些数据。")}/>
    </div>}
  </QueryState>;
}
