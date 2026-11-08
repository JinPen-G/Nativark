import { ListFilterItem } from "@/components/ui";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { SearchField, useListFilter } from "@/components/ui";
import type { CustomerMembershipReview, CustomerMembershipReviewStatus } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Space, Tag } from "antd";
import { ActionButton, DataTableRowActions, ListSection, App, Modal, Radio } from "@/components/ui";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { Alert, Button, DataTableText, Form, Input, Select, Table } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, FileText } from "lucide-react";
import { membershipApi } from "@/api/membership";
import { useLocale } from "@/app/locale";
import { isTransientRefreshError } from "@/app/queryClient";
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
const reviewName = (row: CustomerMembershipReview) => row.corporateSnapshot?.legalName || row.customerName;

export function MembershipReviewPage() {
  const scope = useListQueryIdentity();
  const grants = useAuthStore(state => JSON.stringify(["rental-os:member:view", "rental-os:member:review", "rental-os:member:qualification-review"].map(code => state.hasTenantMembershipPermission(code))));
  return <MembershipReviewWorkspace key={`${scope}:${grants}`} />;
}

/** Task drafts and private snapshots belong to one authorized list identity. */
function MembershipReviewWorkspace() {
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
  const reviewAfterDetails = useRef<CustomerMembershipReview | undefined>(undefined);
  const detailDialog = useModalDismissal(Boolean(detailTarget), () => {
    setDetailTarget(undefined);
    const target = reviewAfterDetails.current;
    reviewAfterDetails.current = undefined;
    if (target) openReview(target);
  });
  const [form] = Form.useForm<ReviewForm>();
  const reviewDialog = useModalDismissal(Boolean(selected), () => { setSelected(undefined); form.resetFields(); });
  const live = useLiveRefresh("membership-reviews", Boolean(selected || detailTarget));
  const reviews = useQuery({ queryKey: ["membership-reviews", live.scope, filter], queryFn: () => membershipApi.reviews(filter), enabled: canView, placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === live.scope ? previous : undefined, ...live.queryOptions });
  const reviewSearch = useListFilter(reviews.data, { fields: row => [row.customerName, row.corporateSnapshot?.legalName, row.qualificationType] });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options", live.scope], queryFn: membershipApi.benefitScopeOptions, enabled: canView });
  const canHandle = (row: CustomerMembershipReview) => row.reviewType === "registration" || row.reviewType === "corporate_registration" ? canRegistrationReview : canQualificationReview;
  const actionable = (row: CustomerMembershipReview) => row.status === "pending" || row.status === "supplement_required";
  const selectedCurrent = selected && reviews.data?.find(row => row.id === selected.id);
  const selectionChanged = Boolean(selected && (!selectedCurrent || selectedCurrent.updatedAt !== selected.updatedAt || !actionable(selectedCurrent)));
  const decide = useMutation({
    mutationFn: (values: ReviewForm) => {
      if (!selected || !canHandle(selected) || selectionChanged || reviews.isPlaceholderData || reviews.isError) {
        return Promise.reject(new Error(t("审核任务已更新，请重新打开核对")));
      }
      return membershipApi.review(selected.id, values);
    },
    onSuccess: async () => {
      reviewDialog.dismiss();
      await queryClient.invalidateQueries({ queryKey: ["membership-reviews"] });
      await queryClient.invalidateQueries({ queryKey: ["membership-personal"] });
      await queryClient.invalidateQueries({ queryKey: ["membership-qualification-history"] });
      message.success(t("审核结果已保存，租户全部空间共享该结果"));
    },
    onError: () => message.error(t("审核结果暂未确认，请刷新列表核对")),
  });
  const reading = reviews.isLoading || reviews.isPlaceholderData || reviews.isError;
  const denied = reviews.isError && !isTransientRefreshError(reviews.error);
  useEffect(() => {
    if (!denied) return;
    reviewAfterDetails.current = undefined;
    if (selected) form.resetFields();
    setDetailTarget(undefined); setSelected(undefined);
  }, [denied, form]);
  const reviewDisabled = !selected || !canHandle(selected) || selectionChanged || reading || decide.isPending;
  function openReview(row: CustomerMembershipReview) {
    if (reading || decide.isPending || !canHandle(row) || !actionable(row)) return;
    form.resetFields(); form.setFieldsValue({ status: "approved" }); setSelected(row);
  }
  const workspaceName = (workspaceId?: string) => workspaceId
    ? scopeOptions.data?.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? (scopeOptions.isLoading ? t("来源名称加载中") : t("来源空间名称不可用"))
    : t("未记录来源空间");
  const categoryName = (code: string) => scopeOptions.data?.categories.find((category) => category.code === code)?.name ?? t("品类名称不可用");

  if (!canView) return <Alert type="warning" showIcon title={t("无权查看租户统一会员审核")} description={t("需要租户级会员查看、注册审核或资质审核权限，且数据范围为全部。")} />;

  return <>
    <PageHeader title={t("会员审核")} description={t("审核结果在租户内共享；证件要求按经营空间设置。")}
      summary={reviews.data && !reading && <InsightMetrics items={[{ label: t("申请"), value: reviewSearch.rows.length }, { label: t("待审核"), value: reviewSearch.rows.filter(row => row.status === "pending").length }, { label: t("待补件"), value: reviewSearch.rows.filter(row => row.status === "supplement_required").length }]} />} />

    <QueryState loading={reviews.isLoading} error={reviews.error} onRetry={() => reviews.refetch({ throwOnError: true })}>
    {scopeOptions.error && <Alert type="warning" showIcon title={t("来源空间名称加载失败")} action={<ActionButton variant="secondary" label={t("重试")} onAction={() => scopeOptions.refetch({ throwOnError: true })} />} />}
    <ListSection controls={<>
      <SearchField label={t("会员、企业名称或证件类型")} placeholder={t("会员、企业名称或证件类型")} value={reviewSearch.keyword} onValueChange={reviewSearch.setKeyword} />
      <ListFilterItem label={t("审核状态")} priority active={Boolean(filter.status)}>
        <Select aria-label={t("审核状态")} allowClear placeholder={t("全部状态")} value={filter.status} options={[{ value: "", label: t("全部状态") }, ...Object.entries(statusMeta).map(([value, item]) => ({ value, label: t(item.text) }))]} onChange={(status) => { setFilter((value) => ({ ...value, status: status || undefined })); reviewSearch.pagination.onChange(1, reviewSearch.pagination.pageSize); }} />
      </ListFilterItem>
      <ListFilterItem label={t("审核类型")} collapsed active={Boolean(filter.type)}>
        <Select aria-label={t("审核类型")} allowClear placeholder={t("全部类型")} value={filter.type} options={[{ value: "", label: t("全部类型") }, { value: "registration", label: t("个人会员注册") }, { value: "corporate_registration", label: t("企业会员注册") }, { value: "qualification", label: t("资质证件") }]} onChange={(type) => { setFilter((value) => ({ ...value, type: type || undefined })); reviewSearch.pagination.onChange(1, reviewSearch.pagination.pageSize); }} />
      </ListFilterItem>
      {(reviewSearch.keyword || filter.status || filter.type) && <Button data-list-filter-reset type="text" onClick={() => { setFilter({}); reviewSearch.clear(); }}>{t("清除筛选")}</Button>}
      <ListFilterItem kind="action"><LiveRefresh enabled={live.enabled} onChange={live.setEnabled} busy={reviews.isFetching} updatedAt={reviews.dataUpdatedAt} paused={Boolean(selected || detailTarget)} /></ListFilterItem>
    </>}>
      <Table<CustomerMembershipReview> toolbarNote={false} rowKey="id" onRefresh={() => reviews.refetch()} loading={reviews.isLoading || reviews.isPlaceholderData} refreshing={reviews.isFetching} dataSource={reviewSearch.rows} pagination={reviewSearch.pagination} emptyScene={reviewSearch.keyword || filter.type ? "search" : "empty"} locale={{ emptyText: t(reviewSearch.keyword || filter.status || filter.type ? "暂无符合条件的审核申请" : "暂无审核申请") }} columns={[
        { title: t("会员"), dataIndex: "customerName", render: (_, row) => <CustomerPreview presentation="list" customerId={row.customerId} name={reviewName(row) ?? "—"} secondary={row.corporateSnapshot?.legalName ? row.corporateSnapshot.contactName : undefined} type={row.reviewType === "corporate_registration" ? "corporate" : undefined} /> },
        { title: t("审核类型"), render: (_, row) => <DataTableText primary={t(typeText[row.reviewType] ?? row.reviewType)} secondary={row.qualificationType} /> },
        { title: t("渠道"), dataIndex: "channel", render: (value) => value === "app" ? t("APP 提交") : t("后台") },
        { title: t("来源空间"), render: (_, row) => workspaceName(row.sourceWorkspaceId) },
        { title: t("状态"), render: (_, row) => <Tag color={statusMeta[row.status].color}>{t(statusMeta[row.status].text)}</Tag> },
        { title: t("提交时间"), dataIndex: "createdAt", render: (value) => <DataTableText primary={new Date(value).toLocaleDateString(locale)} secondary={new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} /> },
        ...(reviewSearch.rows.some(row => row.reason) ? [{ key: "reason", title: t("审核意见"), dataIndex: "reason", minWidth: 200, render: (value?: string) => value || "—" }] : []),
        { title: t("操作"), render: (_, row) => {
          const primary = actionable(row) && canHandle(row) ? { id: "review", label: t("审核"), icon: ClipboardCheck, disabled: reading || decide.isPending, onSelect: () => openReview(row) } : undefined;
          return <DataTableRowActions primary={primary} details={() => setDetailTarget(row)} detailsDisabled={reading} detailLabel={t("查看")} detailAccessibleLabel={`${row.customerName ?? t("会员")} · ${t("审核详情")}`}
            menuLabel={`${row.customerName ?? t("会员")} · ${t("更多操作")}`} actions={primary ? [primary, { id: "detail", label: t("审核详情"), icon: FileText, disabled: reading, onSelect: () => setDetailTarget(row) }] : []} />;
        } },
      ]} />
    </ListSection>
    </QueryState>
    <Modal title={t("会员审核")} open={reviewDialog.visible && !denied} onCancel={reviewDialog.dismiss} afterClose={reviewDialog.afterClose} onConfirm={() => form.validateFields().then(values => decide.mutateAsync(values))} okText={t("保存审核结果")} okButtonProps={{ disabled: reviewDisabled }} cancelButtonProps={{ disabled: decide.isPending }} closable={!decide.isPending} maskClosable={!decide.isPending} keyboard={!decide.isPending} confirmLoading={decide.isPending} destroyOnHidden>
      {selected && <div style={{ marginBottom: "var(--space-4)" }}><RecordFacts items={[
        { key: "member", label: "会员", value: reviewName(selected) ?? t("会员名称不可用"), wide: Boolean(selected.corporateSnapshot?.legalName) },
        { key: "subject", label: "审核类型", value: selected.qualificationType ?? t(typeText[selected.reviewType]) },
      ]} /></div>}
      {selectionChanged && !decide.isPending && <Alert type="warning" showIcon title={t("审核任务已更新，请重新打开核对")} />}
      <Form form={form} layout="vertical" disabled={reviewDisabled} onFinish={(values) => !reviewDisabled && decide.mutate(values)}>
        <Form.Item label={t("审核结论")} name="status" rules={[{ required: true }]}><Radio.Group options={[{ value: "approved", label: t("通过") }, { value: "supplement_required", label: t("补充资料") }, { value: "rejected", label: t("拒绝") }, { value: "cancelled", label: t("取消审核") }]} /></Form.Item>
        <Form.Item label={t("说明")} name="reason" dependencies={["status"]} rules={[({ getFieldValue }) => ({ required: getFieldValue("status") !== "approved", whitespace: true, message: t("补件、拒绝或取消审核必须填写原因") })]}><Input.TextArea maxLength={500} rows={3} placeholder={t("补件、拒绝或取消时请说明原因")} /></Form.Item>
      </Form>
    </Modal>
    <Modal presentation="side" title={t("审核详情")} open={detailDialog.visible && !denied} onCancel={detailDialog.dismiss} afterClose={detailDialog.afterClose} width={640}
      footer={detailTarget && actionable(detailTarget) && canHandle(detailTarget) ? <Button type="primary" disabled={reading || decide.isPending} onClick={() => { reviewAfterDetails.current = detailTarget; detailDialog.dismiss(); }}>{t("审核此申请")}</Button> : null} destroyOnHidden>
      {detailTarget && <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <ListSection title={t("审核任务")}>
          <RecordFacts items={[
            { key: "member", label: "会员", value: reviewName(detailTarget) ?? t("会员名称不可用"), wide: Boolean(detailTarget.corporateSnapshot?.legalName) },
            { key: "status", label: "审核状态", value: <Tag color={statusMeta[detailTarget.status].color}>{t(statusMeta[detailTarget.status].text)}</Tag> },
            { key: "type", label: "审核类型", value: t(typeText[detailTarget.reviewType] ?? detailTarget.reviewType) },
            { key: "channel", label: "提交渠道", value: detailTarget.channel === "app" ? "APP" : t("后台") },
            { key: "submitted", label: "提交时间", value: new Date(detailTarget.createdAt).toLocaleString(locale) },
            { key: "workspace", label: "来源空间", value: `${workspaceName(detailTarget.sourceWorkspaceId)}（${t("仅供追溯")}）`, wide: true },
            ...(detailTarget.reviewType === "qualification" ? [{ key: "qualification", label: "证件类型", value: detailTarget.qualificationType ?? "—" }] : []),
            ...(detailTarget.reason ? [{ key: "reason", label: "审核意见", value: detailTarget.reason, wide: true }] : []),
            ...(detailTarget.reviewedBy ? [{ key: "reviewer", label: "审核人", value: detailTarget.reviewedBy }] : []),
            ...(detailTarget.reviewedAt ? [{ key: "reviewedAt", label: "审核时间", value: new Date(detailTarget.reviewedAt).toLocaleString(locale) }] : []),
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
  </>;
}
