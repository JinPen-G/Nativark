import type { SaveCustomerMembershipQualificationTypeRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { SaveButton } from "@/components/ui";
import { membershipApi } from "@/api/membership";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

export function QualificationTypesEditor() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const hasPermission = useAuthStore(state => state.hasPermission);
  // 证件类型是当前经营空间的业务配置，走专属的空间级权限。服务端写入只认新码，
  // 页面的编辑入口与之对齐：member:manage / member:view 只开放查看，不再显示一个保存后必 403 的表单。
  const canManage = Boolean(workspaceId) && hasPermission("rental-os:qualification-type:manage");
  const canView = canManage || (Boolean(workspaceId) && (hasPermission("rental-os:member:manage") || hasPermission("rental-os:member:view")));
  const [form] = Form.useForm<SaveCustomerMembershipQualificationTypeRequest>();
  const types = useQuery({ queryKey: ["membership-qualification-types", workspaceId], queryFn: membershipApi.qualificationTypes, enabled: canView });
  const save = useMutation({ mutationFn: membershipApi.saveQualificationType, onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["membership-qualification-types", workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ["membership-qualification-options", workspaceId] });
    form.resetFields();
    message.success(t("证件类型已保存"));
  } });
  if (!canView) return <Alert type="warning" title={t("需要当前空间的证件配置权限")} />;
  return <QueryState loading={types.isLoading} error={types.error}>
    <Alert type="info" showIcon title={t("仅配置当前经营空间")} description={t("这里维护本空间使用的证件类型；不授予租户会员资料维护权，也不改变已提交的证件与审核历史。")} style={{ marginBottom: 16 }} />
    <Form form={form} layout="vertical" disabled={!canManage} onFinish={values => canManage && save.mutate(values)}>
      <Form.Item label={t("编码")} name="code" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item label={t("名称")} name="name" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="requiredForBooking" valuePropName="checked"><Checkbox>{t("下单必需")}</Checkbox></Form.Item>
      <SaveButton label={t("新增证件类型")} successLabel={t("已完成")} form={form} disabled={!canManage} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} />
    </Form>
    <Table rowKey="id" size="small" style={{ marginTop: 20 }} dataSource={types.data ?? []} pagination={false} columns={[
      { title: t("名称"), dataIndex: "name" }, { title: t("编码"), dataIndex: "code" },
      { title: t("下单要求"), render: (_, row) => row.requiredForBooking ? t("必需") : t("可选") },
      { title: t("状态"), dataIndex: "status", render: value => value === "enabled" ? t("已启用") : t("已停用") }
    ]} />
  </QueryState>;
}

export function QualificationTypesPage() {
  const { t } = useLocale();
  return <><PageHeader title={t("空间证件类型")} description={t("按当前经营空间配置业务所需证件。")} /><QualificationTypesEditor /></>;
}
