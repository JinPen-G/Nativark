import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { SaveButton } from "@/components/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Space } from "antd";
import { Form } from "@/components/ui";
import { App, Modal } from "@/components/ui";
import { Alert, Button, Input, Select } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { categoryGovernanceApi, type CategoryGovernanceDetail } from "@/api/categoryGovernance";
import { QueryState } from "@/components/QueryState";
import type { CategoryVersionView, SaveCategoryOpeningRequest, SaveCategoryVersionPolicyRequest } from "@rental-os/shared";

export function CategoryPolicyDialog({ detail, version, saved, close }: { detail: CategoryGovernanceDetail; version?: CategoryVersionView; saved: () => void; close: () => void }) {
  const { t } = useLocale();
  const dismissal = useModalDismissal(true, close);
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const directory = useQuery({ queryKey: ["platform-category-tenant-directory"], queryFn: categoryGovernanceApi.tenantDirectory });
  const initial = version?.policy ? { ...version.policy, expectedRevision: version.policy.revision, reason: "" } : {
    expectedRevision: detail.openingRevision, scope: detail.openingScope, tenantIds: detail.openingTenantIds ?? [], recommendedVersionId: detail.recommendedVersionId ?? undefined, reason: ""
  };
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => version ? categoryGovernanceApi.policy(detail.code, version.id, values as unknown as SaveCategoryVersionPolicyRequest) : categoryGovernanceApi.opening(detail.code, values as unknown as SaveCategoryOpeningRequest),
    onSuccess: () => { saved(); dismissal.dismiss(); message.success(t("政策已保存，已有空间绑定未改变")); },
    onError: (error) => message.error((error as { response?: { status?: number } }).response?.status === 409 ? t("政策修订冲突，输入已保留，请刷新后核对") : t("政策保存失败，输入已保留"))
  });
  const scopes = version ? ["none", "pilot", "all"] : ["unopened", "stopped", "pilot", "all"];
  const scopeLabels: Record<string, string> = { none: "不允许采用", pilot: "试点租户", all: "全部租户", unopened: "尚未开放", stopped: "停止新开通" };
  const scopePicker = (scopeKey: string, idsKey: string, label: string) => <>
    <Form.Item name={scopeKey} label={t(label)} rules={[{ required: true }]}><Select options={scopes.map((value) => ({ value, label: t(scopeLabels[value]) }))} onChange={(value) => { if (value !== "pilot") form.setFieldValue(idsKey, []); }} /></Form.Item>
    <Form.Item noStyle shouldUpdate={(before, after) => before[scopeKey] !== after[scopeKey]}>{() => form.getFieldValue(scopeKey) === "pilot" ?
      <Form.Item name={idsKey} label={t("试点租户")} rules={[{ required: true, type: "array", min: 1, max: 200 }]}><Select mode="multiple" showSearch={{ optionFilterProp: "label" }} options={directory.data?.map((tenant) => ({ value: tenant.id, label: `${tenant.name} (${tenant.code})` }))} /></Form.Item> : <Form.Item name={idsKey} hidden><Select mode="multiple" /></Form.Item>}
    </Form.Item>
  </>;
  return <Modal title={t(version ? "版本采用资格" : "品类新开通政策")} open={dismissal.visible} afterClose={dismissal.afterClose} footer={null} onCancel={() => { if (!save.isPending) dismissal.dismiss(); }} mask={{ closable: !save.isPending }}>
    <Alert type="info" title={t("这里只修改开放政策，不修改发布正文、租户规则或已有空间绑定。停止新开通不会暂停既有经营。")} />
    <QueryState loading={directory.isLoading} error={directory.error}>
      <Form form={form} layout="vertical" initialValues={initial} disabled={save.isPending} onFinish={(values) => save.mutate({ ...values, expectedRevision: initial.expectedRevision })}>
        {version ? <>{scopePicker("createScope", "createTenantIds", "新建采用资格")}{scopePicker("upgradeScope", "upgradeTenantIds", "升级采用资格")}{scopePicker("restoreScope", "restoreTenantIds", "恢复采用资格")}</> : <>
          {scopePicker("scope", "tenantIds", "新开通范围")}
          <Form.Item name="recommendedVersionId" label={t("默认推荐版本")}><Select options={detail.versions.filter((entry) => ["published", "legacy_baseline"].includes(entry.status)).map((entry) => ({ value: entry.id, label: entry.versionLabel }))} /></Form.Item>
        </>}
        <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={512} /></Form.Item>
        <Space><SaveButton  label={t("保存政策")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync({ ...values, expectedRevision: initial.expectedRevision })} /><Button disabled={save.isPending} onClick={close}>{t("取消")}</Button></Space>
      </Form>
    </QueryState>
  </Modal>;
}
