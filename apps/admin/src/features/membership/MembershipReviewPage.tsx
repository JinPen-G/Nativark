import type { CustomerMembershipReview, CustomerMembershipReviewStatus } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Drawer, Form, Input, Modal, Radio, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { membershipApi } from "@/api/membership";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const statusMeta: Record<CustomerMembershipReviewStatus, { text: string; color: string }> = {
  pending: { text: "待审核", color: "processing" }, approved: { text: "已通过", color: "success" },
  rejected: { text: "已拒绝", color: "error" }, supplement_required: { text: "待补件", color: "warning" }, cancelled: { text: "已取消", color: "default" },
};
const typeText: Record<string, string> = { registration: "个人会员注册", corporate_registration: "企业会员注册", qualification: "资质证件" };
type ReviewForm = { status: "approved" | "rejected" | "supplement_required" | "cancelled"; reason?: string };

export function MembershipReviewPage() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canRegistrationReview = hasTenantMembershipPermission("rental-os:member:review");
  const canQualificationReview = hasTenantMembershipPermission("rental-os:member:qualification-review");
  const canView = hasTenantMembershipPermission("rental-os:member:view") || canRegistrationReview || canQualificationReview;
  const [filter, setFilter] = useState<{ status?: string; type?: string }>({ status: "pending" });
  const [selected, setSelected] = useState<CustomerMembershipReview>();
  const [detailTarget, setDetailTarget] = useState<CustomerMembershipReview>();
  const [form] = Form.useForm<ReviewForm>();
  const reviews = useQuery({ queryKey: ["membership-reviews", filter], queryFn: () => membershipApi.reviews(filter), enabled: canView });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options"], queryFn: membershipApi.benefitScopeOptions, enabled: canView });
  const decide = useMutation({
    mutationFn: (values: ReviewForm) => membershipApi.review(selected!.id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-reviews"] });
      await queryClient.invalidateQueries({ queryKey: ["membership-personal"] });
      await queryClient.invalidateQueries({ queryKey: ["membership-qualification-history"] });
      setSelected(undefined);
      form.resetFields();
      message.success(t("审核结果已保存，租户全部空间共享该结果"));
    },
  });
  const canHandle = (row: CustomerMembershipReview) => row.reviewType === "registration" || row.reviewType === "corporate_registration" ? canRegistrationReview : canQualificationReview;
  const workspaceName = (workspaceId?: string) => workspaceId
    ? scopeOptions.data?.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? (scopeOptions.isLoading ? t("来源名称加载中") : t("来源空间名称不可用"))
    : t("未记录来源空间");
  const categoryName = (code: string) => scopeOptions.data?.categories.find((category) => category.code === code)?.name ?? t("品类名称不可用");

  if (!canView) return <Alert type="warning" showIcon title={t("无权查看租户统一会员审核")} description={t("需要租户级会员查看、注册审核或资质审核权限，且数据范围为全部。")} />;

  return <QueryState loading={reviews.isLoading} error={reviews.error}>
    <PageHeader title={t("会员审核")} description={t("租户统一会员：注册策略和审核结果共享，来源空间仅供追溯。")} view={<Space>
      <Select value={filter.status} style={{ width: 120 }} options={[{ value: "", label: t("全部状态") }, ...Object.entries(statusMeta).map(([value, item]) => ({ value, label: t(item.text) }))]} onChange={(status) => setFilter((value) => ({ ...value, status: status || undefined }))} />
      <Select value={filter.type} style={{ width: 140 }} options={[{ value: "", label: t("全部类型") }, { value: "registration", label: t("个人会员注册") }, { value: "corporate_registration", label: t("企业会员注册") }, { value: "qualification", label: t("资质证件") }]} onChange={(type) => setFilter((value) => ({ ...value, type: type || undefined }))} />
    </Space>} />
    <Alert type="info" showIcon title={t("租户统一会员")} description={t("注册策略、注册审核与资质资料在租户内共享；切换经营空间仍显示同一份会员及审核记录。来源空间仅用于追溯，不限制审核结果的共享范围。会员暂停、退出或注销影响租户全部空间；证件类型及下单要求仍由各空间配置。")} style={{ marginBottom: 16 }} />
    {scopeOptions.error && <Alert type="warning" showIcon title={t("来源空间名称加载失败")} description={scopeOptions.error.message} style={{ marginBottom: 16 }} />}
    <Card>
      <Table<CustomerMembershipReview> rowKey="id" dataSource={reviews.data ?? []} pagination={{ pageSize: 20 }} columns={[
        { title: t("会员"), dataIndex: "customerName" },
        { title: t("审核类型"), render: (_, row) => t(typeText[row.reviewType] ?? row.reviewType) },
        { title: t("证件类型"), dataIndex: "qualificationType", render: (value) => value ?? "—" },
        { title: t("渠道"), dataIndex: "channel", render: (value) => value === "app" ? t("APP 提交") : t("后台") },
        { title: t("来源空间"), render: (_, row) => workspaceName(row.sourceWorkspaceId) },
        { title: t("状态"), render: (_, row) => <Tag color={statusMeta[row.status].color}>{t(statusMeta[row.status].text)}</Tag> },
        { title: t("提交时间"), dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString() },
        { title: t("操作"), render: (_, row) => <Space>
          <Button type="link" disabled={!canView} onClick={() => setDetailTarget(row)}>{t("查看")}</Button>
          {row.status === "pending" || row.status === "supplement_required"
            ? <Button type="link" disabled={!canHandle(row)} onClick={() => { form.resetFields(); form.setFieldsValue({ status: "approved" }); setSelected(row); }}>{t("审核")}</Button>
            : <span>{row.reason ?? "—"}</span>}
        </Space> },
      ]} />
    </Card>
    <Modal title={selected ? `${t(typeText[selected.reviewType])}${t("审核")}` : t("审核")} open={Boolean(selected)} onCancel={() => setSelected(undefined)} onOk={() => form.submit()} okButtonProps={{ disabled: !selected || !canHandle(selected) }} confirmLoading={decide.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" disabled={!selected || !canHandle(selected)} onFinish={(values) => selected && canHandle(selected) && decide.mutate(values)}>
        <Form.Item label={t("审核结论")} name="status" rules={[{ required: true }]}><Radio.Group options={[{ value: "approved", label: t("通过") }, { value: "supplement_required", label: t("补充资料") }, { value: "rejected", label: t("拒绝") }, { value: "cancelled", label: t("取消") }]} /></Form.Item>
        <Form.Item label={t("说明")} name="reason" dependencies={["status"]} rules={[({ getFieldValue }) => ({ required: getFieldValue("status") !== "approved", whitespace: true, message: t("补件、拒绝或取消审核必须填写原因") })]}><Input.TextArea maxLength={500} rows={3} placeholder={t("补件、拒绝或取消时请说明原因")} /></Form.Item>
      </Form>
    </Modal>
    <Drawer title={detailTarget ? `${t(typeText[detailTarget.reviewType] ?? detailTarget.reviewType)}${t("详情")}` : t("审核详情")} open={Boolean(detailTarget)} onClose={() => setDetailTarget(undefined)} size={520} destroyOnHidden>
      {detailTarget && <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Card size="small" title={t("审核任务")}>
          <div>{t("会员")}：{detailTarget.customerName ?? t("会员名称不可用")}</div>
          <div>{t("证件类型")}：{detailTarget.qualificationType ?? "—"}</div>
          <div>{t("提交渠道")}：{detailTarget.channel === "app" ? "APP" : t("后台")}</div>
          <div>{t("来源空间")}：{workspaceName(detailTarget.sourceWorkspaceId)}（{t("仅供追溯")}）</div>
          <div>{t("提交时间")}：{new Date(detailTarget.createdAt).toLocaleString()}</div>
          <div>{t("审核状态")}：<Tag color={statusMeta[detailTarget.status].color}>{t(statusMeta[detailTarget.status].text)}</Tag></div>
          <div>{t("审核意见")}：{detailTarget.reason ?? "—"}</div>
        </Card>
        {detailTarget.qualificationSnapshot && <Card size="small" title={t("本次证件快照")}>
          <div>{t("证件编号")}：{detailTarget.qualificationSnapshot.referenceNoMasked ?? "—"}</div>
          <div>{t("签发时间")}：{detailTarget.qualificationSnapshot.issuedAt?.slice(0, 10) ?? "—"}</div>
          <div>{t("失效时间")}：{detailTarget.qualificationSnapshot.expiresAt?.slice(0, 10) ?? "—"}</div>
          <div>{t("提交时业务配置")}：{categoryName(detailTarget.qualificationSnapshot.applicableScope.categoryCode)} / {workspaceName(detailTarget.qualificationSnapshot.applicableScope.workspaceId)}</div>
          <div>{t("附件引用")}：{detailTarget.qualificationSnapshot.evidenceRef ?? t("未关联")}</div>
          <div>{t("快照审核结果")}：{t(statusMeta[detailTarget.qualificationSnapshot.reviewStatus].text)}</div>
        </Card>}
        {detailTarget.corporateSnapshot && <Card size="small" title={t("本次企业主体资料快照")}>
          <div>{t("企业法定名称")}：{detailTarget.corporateSnapshot.legalName}</div>
          <div>{t("统一社会信用代码")}：{detailTarget.corporateSnapshot.unifiedSocialCreditCodeMasked}</div>
          <div>{t("注册地址")}：{detailTarget.corporateSnapshot.registeredAddress ?? "—"}</div>
          <div>{t("法定代表人")}：{detailTarget.corporateSnapshot.legalRepName ?? "—"}</div>
          <div>{t("法定代表人联系电话")}：{detailTarget.corporateSnapshot.legalRepPhoneMasked ?? "—"}</div>
          <div>{t("行业")}：{detailTarget.corporateSnapshot.industry ?? "—"}</div>
          <div>{t("企业规模")}：{detailTarget.corporateSnapshot.scale ?? "—"}</div>
          <div>{t("联系人")}：{detailTarget.corporateSnapshot.contactName} · {detailTarget.corporateSnapshot.contactPhoneMasked}</div>
          <div>{t("邮箱")}：{detailTarget.corporateSnapshot.email ?? "—"}</div>
        </Card>}
      </Space>}
    </Drawer>
  </QueryState>;
}
