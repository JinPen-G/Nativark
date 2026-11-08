import { ListFilterItem } from "@/components/ui";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { SearchField, useListFilter } from "@/components/ui";
import type { CustomerMembershipReview, CustomerMembershipReviewStatus } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Space, Tag } from "antd";
import { ListSection, App, Modal, Radio } from "@/components/ui";
import { Alert, Button, DataTableText, Form, Input, Select, Table } from "@/components/ui";
import { useState } from "react";
import { membershipApi } from "@/api/membership";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { LiveRefresh, useLiveRefresh } from "@/components/ui";
import { InsightMetrics } from "@/components/BusinessInsights";
import { RecordFacts } from "@/components/RecordDetailLayout";
import { useModalDismissal } from "@/components/ui/useModalDismissal";

const statusMeta: Record<CustomerMembershipReviewStatus, { text: string; color: string }> = {
  pending: { text: "待审核", color: "processing" }, approved: { text: "已通过", color: "success" },
  rejected: { text: "已拒绝", color: "error" }, supplement_required: { text: "待补件", color: "warning" }, cancelled: { text: "已取消", color: "default" },
};
const typeText: Record<string, string> = { registration: "个人会员注册", corporate_registration: "企业会员注册", qualification: "资质证件" };
type ReviewForm = { status: "approved" | "rejected" | "supplement_required" | "cancelled"; reason?: string };

export function MembershipReviewPage() {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canRegistrationReview = hasTenantMembershipPermission("rental-os:member:review");
  const canQualificationReview = hasTenantMembershipPermission("rental-os:member:qualification-review");
  const canView = hasTenantMembershipPermission("rental-os:member:view") || canRegistrationReview || canQualificationReview;
  const [filter, setFilter] = useState<{ status?: string; type?: string }>({ status: "pending" });
  const [selected, setSelected] = useState<CustomerMembershipReview>();
  const [detailTarget, setDetailTarget] = useState<CustomerMembershipReview>();
  const detailDialog = useModalDismissal(Boolean(detailTarget), () => setDetailTarget(undefined));
  const [form] = Form.useForm<ReviewForm>();
  const live = useLiveRefresh("membership-reviews", Boolean(selected));
  const reviews = useQuery({ queryKey: ["membership-reviews", live.scope, filter], queryFn: () => membershipApi.reviews(filter), enabled: canView, placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === live.scope ? previous : undefined, ...live.queryOptions });
  const reviewSearch = useListFilter(reviews.data, { fields: row => [row.customerName] });
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

  return <QueryState loading={reviews.isLoading} error={reviews.error} onRetry={() => reviews.refetch({ throwOnError: true })}>
    <PageHeader title={t("会员审核")} description={t("审核结果在租户内共享；证件要求按经营空间设置。")}
      summary={<InsightMetrics items={[{ label: t("申请"), value: reviewSearch.rows.length }, { label: t("待审核"), value: reviewSearch.rows.filter(row => row.status === "pending").length }, { label: t("待补件"), value: reviewSearch.rows.filter(row => row.status === "supplement_required").length }]} />} />

    {scopeOptions.error && <Alert type="warning" showIcon title={t("来源空间名称加载失败")} description={scopeOptions.error.message} style={{ marginBottom: 16 }} />}
    <ListSection controls={<>
      <SearchField label={t("会员姓名")} placeholder={t("会员姓名")} value={reviewSearch.keyword} onValueChange={reviewSearch.setKeyword} />
      <ListFilterItem label={t("审核状态")} priority active={Boolean(filter.status)}>
        <Select aria-label={t("审核状态")} allowClear placeholder={t("全部状态")} value={filter.status} options={[{ value: "", label: t("全部状态") }, ...Object.entries(statusMeta).map(([value, item]) => ({ value, label: t(item.text) }))]} onChange={(status) => { setFilter((value) => ({ ...value, status: status || undefined })); reviewSearch.pagination.onChange(1, reviewSearch.pagination.pageSize); }} />
      </ListFilterItem>
      <ListFilterItem label={t("审核类型")} collapsed active={Boolean(filter.type)}>
        <Select aria-label={t("审核类型")} allowClear placeholder={t("全部类型")} value={filter.type} options={[{ value: "", label: t("全部类型") }, { value: "registration", label: t("个人会员注册") }, { value: "corporate_registration", label: t("企业会员注册") }, { value: "qualification", label: t("资质证件") }]} onChange={(type) => { setFilter((value) => ({ ...value, type: type || undefined })); reviewSearch.pagination.onChange(1, reviewSearch.pagination.pageSize); }} />
      </ListFilterItem>
      {(reviewSearch.keyword || filter.status || filter.type) && <Button data-list-filter-reset type="text" onClick={() => { setFilter({}); reviewSearch.clear(); }}>{t("清除筛选")}</Button>}
      <ListFilterItem kind="action"><LiveRefresh enabled={live.enabled} onChange={live.setEnabled} busy={reviews.isFetching} updatedAt={reviews.dataUpdatedAt} paused={Boolean(selected)} /></ListFilterItem>
    </>}>
      <Table<CustomerMembershipReview> toolbarNote={false} rowKey="id" onRefresh={() => reviews.refetch()} loading={reviews.isLoading || reviews.isPlaceholderData} refreshing={reviews.isFetching} dataSource={reviewSearch.rows} pagination={reviewSearch.pagination} columns={[
        { title: t("会员"), dataIndex: "customerName", render: (_, row) => <CustomerPreview presentation="list" customerId={row.customerId} name={row.customerName ?? "—"} type={row.reviewType === "corporate_registration" ? "corporate" : undefined} /> },
        { title: t("审核类型"), render: (_, row) => <DataTableText primary={t(typeText[row.reviewType] ?? row.reviewType)} secondary={row.qualificationType} /> },
        { title: t("渠道"), dataIndex: "channel", render: (value) => value === "app" ? t("APP 提交") : t("后台") },
        { title: t("来源空间"), render: (_, row) => workspaceName(row.sourceWorkspaceId) },
        { title: t("状态"), render: (_, row) => <Tag color={statusMeta[row.status].color}>{t(statusMeta[row.status].text)}</Tag> },
        { title: t("提交时间"), dataIndex: "createdAt", render: (value) => <DataTableText primary={new Date(value).toLocaleDateString(locale)} secondary={new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} /> },
        { title: t("操作"), render: (_, row) => <Space>
          <Button type="link" disabled={!canView} onClick={() => setDetailTarget(row)}>{t("查看")}</Button>
          {row.status === "pending" || row.status === "supplement_required"
            ? <Button type="link" disabled={!canHandle(row)} onClick={() => { form.resetFields(); form.setFieldsValue({ status: "approved" }); setSelected(row); }}>{t("审核")}</Button>
            : <span>{row.reason ?? "—"}</span>}
        </Space> },
      ]} />
    </ListSection>
    <Modal title={t("会员审核")} open={Boolean(selected)} onCancel={() => setSelected(undefined)} onConfirm={() => form.validateFields().then(async values => { const operation = selected && canHandle(selected) && decide.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; })} okText={t("保存审核结果")} okButtonProps={{ disabled: !selected || !canHandle(selected) }} cancelButtonProps={{ disabled: decide.isPending }} closable={!decide.isPending} maskClosable={!decide.isPending} keyboard={!decide.isPending} confirmLoading={decide.isPending} destroyOnHidden>
      {selected && <div style={{ marginBottom: "var(--space-4)" }}><RecordFacts items={[
        { key: "member", label: "会员", value: selected.customerName ?? t("会员名称不可用") },
        { key: "subject", label: "审核类型", value: selected.qualificationType ?? t(typeText[selected.reviewType]) },
      ]} /></div>}
      <Form form={form} layout="vertical" disabled={!selected || !canHandle(selected)} onFinish={(values) => selected && canHandle(selected) && decide.mutate(values)}>
        <Form.Item label={t("审核结论")} name="status" rules={[{ required: true }]}><Radio.Group options={[{ value: "approved", label: t("通过") }, { value: "supplement_required", label: t("补充资料") }, { value: "rejected", label: t("拒绝") }, { value: "cancelled", label: t("取消审核") }]} /></Form.Item>
        <Form.Item label={t("说明")} name="reason" dependencies={["status"]} rules={[({ getFieldValue }) => ({ required: getFieldValue("status") !== "approved", whitespace: true, message: t("补件、拒绝或取消审核必须填写原因") })]}><Input.TextArea maxLength={500} rows={3} placeholder={t("补件、拒绝或取消时请说明原因")} /></Form.Item>
      </Form>
    </Modal>
    <Modal presentation="side" title={t("审核详情")} open={detailDialog.visible} onCancel={detailDialog.dismiss} afterClose={detailDialog.afterClose} width={640} footer={null} destroyOnHidden>
      {detailTarget && <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <ListSection title={t("审核任务")}>
          <RecordFacts items={[
            { key: "member", label: "会员", value: detailTarget.customerName ?? t("会员名称不可用") },
            { key: "status", label: "审核状态", value: <Tag color={statusMeta[detailTarget.status].color}>{t(statusMeta[detailTarget.status].text)}</Tag> },
            { key: "type", label: "审核类型", value: t(typeText[detailTarget.reviewType] ?? detailTarget.reviewType) },
            { key: "channel", label: "提交渠道", value: detailTarget.channel === "app" ? "APP" : t("后台") },
            { key: "submitted", label: "提交时间", value: new Date(detailTarget.createdAt).toLocaleString(locale) },
            { key: "workspace", label: "来源空间", value: `${workspaceName(detailTarget.sourceWorkspaceId)}（${t("仅供追溯")}）`, wide: true },
            ...(detailTarget.reviewType === "qualification" ? [{ key: "qualification", label: "证件类型", value: detailTarget.qualificationType ?? "—" }] : []),
            ...(detailTarget.reason ? [{ key: "reason", label: "审核意见", value: detailTarget.reason, wide: true }] : []),
          ]} />
        </ListSection>
        {detailTarget.qualificationSnapshot && <ListSection title={t("本次证件快照")}>
          <RecordFacts items={[
            { key: "reference", label: "证件编号", value: detailTarget.qualificationSnapshot.referenceNoMasked },
            { key: "review", label: "快照审核结果", value: t(statusMeta[detailTarget.qualificationSnapshot.reviewStatus].text) },
            { key: "issued", label: "签发时间", value: detailTarget.qualificationSnapshot.issuedAt?.slice(0, 10) },
            { key: "expires", label: "失效时间", value: detailTarget.qualificationSnapshot.expiresAt?.slice(0, 10) },
            { key: "scope", label: "提交时业务配置", value: `${categoryName(detailTarget.qualificationSnapshot.applicableScope.categoryCode)} · ${workspaceName(detailTarget.qualificationSnapshot.applicableScope.workspaceId)}`, wide: true },
            { key: "evidence", label: "附件引用", value: detailTarget.qualificationSnapshot.evidenceRef ?? t("未关联"), wide: true },
          ]} />
        </ListSection>}
        {detailTarget.corporateSnapshot && <ListSection title={t("本次企业主体资料快照")}>
          <RecordFacts items={[
            { key: "legalName", label: "企业法定名称", value: detailTarget.corporateSnapshot.legalName, wide: true },
            { key: "creditCode", label: "统一社会信用代码", value: detailTarget.corporateSnapshot.unifiedSocialCreditCodeMasked, wide: true },
            { key: "address", label: "注册地址", value: detailTarget.corporateSnapshot.registeredAddress, wide: true },
            ...(detailTarget.corporateSnapshot.legalRepName ? [{ key: "representative", label: "法定代表人", value: detailTarget.corporateSnapshot.legalRepName }] : []),
            ...(detailTarget.corporateSnapshot.legalRepPhoneMasked ? [{ key: "representativePhone", label: "法定代表人联系电话", value: detailTarget.corporateSnapshot.legalRepPhoneMasked }] : []),
            { key: "industry", label: "行业", value: detailTarget.corporateSnapshot.industry },
            { key: "scale", label: "企业规模", value: detailTarget.corporateSnapshot.scale },
            { key: "contact", label: "联系人", value: detailTarget.corporateSnapshot.contactName },
            { key: "phone", label: "联系电话", value: detailTarget.corporateSnapshot.contactPhoneMasked },
            { key: "email", label: "邮箱", value: detailTarget.corporateSnapshot.email, wide: true },
          ]} />
        </ListSection>}
      </Space>}
    </Modal>
  </QueryState>;
}
