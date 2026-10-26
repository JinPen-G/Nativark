import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { RecordDisclosure } from "@/components/RecordDisclosure";
import { ListSection, SaveButton, TableRefreshProvider } from "@/components/ui";
import type {
  CustomerProfileAddress,
  CustomerProfileBenefitAccount,
  CustomerProfileCouponEntry,
  CustomerProfileOrder,
  CustomerProfileOverview,
  CustomerProfileRewardEntry,
  CustomerIdentityVerificationSummary,
  CustomerQualificationRevision
} from "@rental-os/shared";
import { RENTAL_CATEGORY_DEFINITIONS, formatRentalMoney } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Col, Descriptions, Row, Space, Tag } from "antd";
import { App, Empty } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table, Upload } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, ConfirmAction, DataTableStatus, Drawer, Tabs } from "@/components/ui";
import { detailStatusLabels } from "@/features/rental-core/orderDetailPresentation";
import { orderStatusTagColor } from "@/features/rental-core/orderStatusSemantics";
import type { UploadFile, UploadProps } from "antd";
import type { ReactNode } from "react";
import { RecordDetailLayout, RecordFacts } from "@/components/RecordDetailLayout";
import profileStyles from "@/components/RecordDetailLayout.module.css";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { customerApi } from "@/api/customer";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";

type AddressForm = {
  recipient: string;
  phone?: string;
  countryCode?: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  isDefault?: boolean;
};

type IdentityForm = {
  credentialType: string;
  result: "verified" | "rejected" | "revoked";
  reason: string;
};

type Props = {
  customerId?: string;
  canManage: boolean;
  canView: boolean;
  canReveal: boolean;
  canViewOrders: boolean;
  onClose: () => void;
  actions?: ReactNode;
  onEdit: () => void;
  onQualification: () => void;
};

const dateTime = (value?: string) => value ? new Date(value).toLocaleString() : "—";
const dateOnly = (value?: string) => value ? new Date(value).toLocaleDateString() : "—";
const money = (value: number, currency = "CNY") => Number.isFinite(value) ? formatRentalMoney(value, currency) : "—";
const categoryLabel = (value: string) => RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === value)?.name ?? value;
const statusLabel: Record<string, string> = {
  ...detailStatusLabels,
  active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销",
  pending_activation: "待激活", claimed: "可用", locked: "已锁定", redeemed: "已核销", expired: "已过期", void: "已作废",
  granted: "已发放", reversed: "已冲正", approved: "已通过", rejected: "已驳回", pending: "待审核"
};
const statusColor = (value: string) => Object.hasOwn(detailStatusLabels, value) ? orderStatusTagColor(value)
  : ["approved", "active", "granted", "claimed"].includes(value) ? "success"
  : ["rejected", "risk_restricted"].includes(value) ? "error"
  : ["pending", "pending_activation", "suspended", "expired"].includes(value) ? "warning" : "default";
const relationLabel: Record<string, string> = { customer: "订单客户", contract_subject: "签约主体", payer: "付款主体", user: "使用人", booking_identity: "预约身份" };

function ProfileSummary({ overview }: { overview: CustomerProfileOverview }) {
  const { t } = useLocale();
  const profile = overview.profile;
  return <>
    <RecordFacts items={[
      { key: "email", label: "邮箱", value: profile.email || "—" },
      { key: "identity", label: "证件号", value: profile.identityNoMasked || "—" },
      { key: "gender", label: "性别", value: profile.gender ? t(({ male: "男", female: "女", other: "其他", unknown: "未填写" } as Record<string, string>)[profile.gender] ?? profile.gender) : "—" },
      { key: "birthday", label: "生日", value: profile.birthday || "—" },
      { key: "region", label: "常住地区", value: profile.region || "—" },
      { key: "source", label: "来源渠道", value: profile.sourceChannel ? t(({ referral: "转介绍", app: "APP", web: "官网", admin: "后台", miniprogram: "小程序" } as Record<string, string>)[profile.sourceChannel] ?? profile.sourceChannel) : "—" }
    ]} />
    <RecordDisclosure key={profile.id} title={t("建档信息")}><RecordFacts items={[
      { key: "created", label: "建档时间", value: dateTime(profile.createdAt) },
      { key: "updated", label: "最近更新", value: dateTime(profile.updatedAt) },
      { key: "id", label: "客户主档 ID", value: profile.id }
    ]} /></RecordDisclosure>
    {profile.customerType === "corporate" && <Card size="small" title={t("企业基础资料")} style={{ marginTop: 16 }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
        { key: "corporateName", label: t("企业名称"), children: profile.corporateName || profile.name || "—" },
        { key: "taxNo", label: t("统一社会信用代码"), children: profile.corporateTaxNo || "—" }
      ]} />
    </Card>}
    {Boolean(profile.contacts?.length) && <ListSection title={t("联系人")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table size="small" rowKey="id" pagination={false} dataSource={profile.contacts} columns={[
      { title: t("姓名"), dataIndex: "name" },
      { title: t("类型"), dataIndex: "kind" },
      { title: t("关系"), dataIndex: "relation", render: (value) => value || "—" },
      { title: t("电话"), dataIndex: "phoneMasked" },
      { title: t("主联系人"), dataIndex: "isPrimary", render: (value) => value ? <Tag color="processing">{t("是")}</Tag> : "—" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> }
    ]} /></ListSection>}
    {Boolean(overview.profile.authorizedAgents?.length) && <ListSection title={t("授权经办人")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table size="small" rowKey="id" pagination={false} dataSource={overview.profile.authorizedAgents} columns={[
      { title: t("姓名"), dataIndex: "agentName" },
      { title: t("电话"), dataIndex: "agentPhoneMasked" },
      { title: t("有效期"), render: (_, row) => `${dateOnly(row.validFrom)} ~ ${dateOnly(row.validTo)}` },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> }
    ]} /></ListSection>}
  </>;
}

function AddressTab({ addresses, canManage, onAdd, onEdit, onRemove }: {
  addresses: CustomerProfileAddress[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (address: CustomerProfileAddress) => void;
  onRemove: (address: CustomerProfileAddress) => Promise<unknown>;
}) {
  const { t } = useLocale();
  return <>
    <Space style={{ marginBottom: 12 }}><Button type="primary" onClick={onAdd} disabled={!canManage}>{t("新增地址")}</Button><span style={{ color: "var(--text-secondary)" }}>{t("历史订单使用的是下单时地址快照，不会随这里修改。")}</span></Space>
    {addresses.length ? <Table<CustomerProfileAddress> size="small" rowKey="id" dataSource={addresses} pagination={false} scroll={{ x: 760 }} columns={[
      { title: t("收件人"), dataIndex: "recipient" },
      { title: t("电话"), dataIndex: "phoneMasked" },
      { title: t("地区"), render: (_, row) => [row.province, row.city, row.district].filter(Boolean).join(" / ") },
      { title: t("详细地址"), dataIndex: "detail" },
      { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? <Tag color="processing">{t("默认")}</Tag> : "—" },
      { title: t("更新于"), dataIndex: "updatedAt", render: dateTime },
      { title: t("操作"), render: (_, row) => <Space><Button type="link" disabled={!canManage} onClick={() => onEdit(row)}>{t("编辑")}</Button><ConfirmAction label={t("删除")} prompt={t("确认删除这个地址？")} onConfirm={() => onRemove(row)} disabled={!canManage} /></Space> }
    ]} /> : <Empty description={t("暂无配送地址")} />}
  </>;
}

function AccountTab({ overview }: { overview: CustomerProfileOverview }) {
  const { t } = useLocale();
  const account = overview.profile.accountSummary;
  const membership = overview.profile.membership;
  return <>
    <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: "account", label: t("登录账号"), children: account?.provisioned ? <Tag color={statusColor(account.status ?? "active")}>{t(statusLabel[account.status ?? "active"] ?? account.status ?? "")}</Tag> : <Tag>{t("未开通")}</Tag> },
      { key: "login", label: t("登录手机号"), children: account?.loginPhoneMasked || "—" },
      { key: "membership", label: t("会员状态"), children: membership ? <Tag color={statusColor(membership.status)}>{t(statusLabel[membership.status] ?? membership.status)}</Tag> : t("未开通会员") },
      { key: "level", label: t("会员等级"), children: membership?.levelName || "—" },
      { key: "firstOrder", label: t("首单时间"), children: dateTime(membership?.firstOrderAt) },
      { key: "joined", label: t("会员创建时间"), children: dateTime(membership?.createdAt) }
    ]} />
    {Boolean(overview.membershipPlanAssignments.length) && <ListSection title={t("会员方案授予")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table size="small" rowKey="id" dataSource={overview.membershipPlanAssignments} pagination={false} scroll={{ x: 820 }} columns={[
      { title: t("方案"), dataIndex: "planName" },
      { title: t("来源"), dataIndex: "source" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("有效期"), render: (_, row) => `${dateTime(row.effectiveFrom)} ~ ${dateTime(row.effectiveTo)}` },
      { title: t("原因"), dataIndex: "reason", render: (value) => value || "—" },
      { title: t("撤销原因"), dataIndex: "revokeReason", render: (value) => value || "—" }
    ]} /></ListSection>}
    {Boolean(overview.corporateRelations.length) && <ListSection title={t("企业关系")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table size="small" rowKey="id" dataSource={overview.corporateRelations} pagination={false} columns={[
      { title: t("企业"), dataIndex: "corporateName", render: (_, row) => <CustomerPreview customerId={row.corporateCustomerId} name={row.corporateName} type="corporate" /> },
      { title: t("个人会员"), dataIndex: "personalCustomerName", render: (_, row) => <CustomerPreview customerId={row.personalCustomerId} name={row.personalCustomerName} type="personal" /> },
      { title: t("角色"), dataIndex: "role", render: (value) => value === "admin" ? t("企业管理员") : t("员工") },
      { title: t("部门"), dataIndex: "department", render: (value) => value || "—" },
      { title: t("工号"), dataIndex: "employeeNo", render: (value) => value || "—" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> }
    ]} /></ListSection>}
  </>;
}

function QualificationTab({ revisions, canManage, onQualification }: { revisions: CustomerQualificationRevision[]; canManage: boolean; onQualification: () => void }) {
  const { t } = useLocale();
  return <>
    <Space style={{ marginBottom: 12 }}><Button type="primary" disabled={!canManage} onClick={onQualification}>{t("提交/补充资质")}</Button><span style={{ color: "var(--text-secondary)" }}>{t("证件适用范围按提交时经营空间固化，历史审核记录只追加不覆盖。")}</span></Space>
    {revisions.length ? <Table<CustomerQualificationRevision> size="small" rowKey="id" dataSource={revisions} pagination={{ defaultPageSize: 20 }} scroll={{ x: 980 }} columns={[
      { title: t("证件类型"), dataIndex: "qualificationType" },
      { title: t("证件编号"), dataIndex: "referenceNoMasked", render: (value) => value || "—" },
      { title: t("品类"), dataIndex: "categoryCode", render: value => t(categoryLabel(value)) },
      { title: t("提交空间"), dataIndex: "workspaceId" },
      { title: t("证件状态"), dataIndex: "qualificationStatus", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("审核状态"), dataIndex: "reviewStatus", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("有效期"), render: (_, row) => `${dateOnly(row.issuedAt)} ~ ${dateOnly(row.expiresAt)}` },
      { title: t("提交时间"), dataIndex: "submittedAt", render: dateTime },
      { title: t("审核意见"), dataIndex: "reviewReason", render: (value) => value || "—" }
    ]} /> : <Empty description={t("暂无资质提交记录")} />}
  </>;
}

function BenefitsTab({ overview }: { overview: CustomerProfileOverview }) {
  const { t } = useLocale();
  if (!overview.benefits.accounts.length && !overview.benefits.rewards.length && !overview.benefits.coupons.length) return <Empty description={t("暂无积分与权益记录")} />;
  return <>
    {overview.benefits.accounts.map((account: CustomerProfileBenefitAccount) => <section key={account.workspaceId}>
      <h2 className={profileStyles.sectionTitle}>{account.workspaceName} <Tag>{t(categoryLabel(account.categoryCode))}</Tag></h2>
      <RecordFacts items={[
        { key: "points", label: "积分", value: account.pointsBalance },
        { key: "balance", label: "营销余额", value: account.marketingBalance.toFixed(2) },
        { key: "coupons", label: "奖励券", value: account.availableRewardCouponCount },
        { key: "updated", label: "更新于", value: dateTime(account.updatedAt) }
      ]} />
    </section>)}

    {Boolean(overview.benefits.rewards.length) && <ListSection title={t("积分与奖励流水")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table<CustomerProfileRewardEntry> size="small" rowKey="id" dataSource={overview.benefits.rewards} pagination={{ defaultPageSize: 20 }} scroll={{ x: 820 }} columns={[
      { title: t("空间"), render: (_, row) => row.workspaceName },
      { title: t("类型"), dataIndex: "rewardType", render: (value) => value === "points" ? t("积分") : value === "balance" ? t("营销余额") : value === "coupon" ? t("奖励券") : t(value) },
      { title: t("变动"), dataIndex: "amount" },
      { title: t("触发来源"), dataIndex: "triggerType" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("原因"), dataIndex: "reason" },
      { title: t("时间"), dataIndex: "createdAt", render: dateTime }
    ]} /></ListSection>}
    {Boolean(overview.benefits.coupons.length) && <ListSection title={t("客户优惠券")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table<CustomerProfileCouponEntry> size="small" rowKey="id" dataSource={overview.benefits.coupons} pagination={{ defaultPageSize: 20 }} scroll={{ x: 920 }} columns={[
      { title: t("空间"), dataIndex: "workspaceName" },
      { title: t("优惠券"), dataIndex: "templateName" },
      { title: t("版本"), dataIndex: "templateVersion" },
      { title: t("面值"), render: (_, row) => `${row.discountType} ${row.discountValue}` },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("有效期"), render: (_, row) => `${dateOnly(row.effectiveFrom)} ~ ${dateOnly(row.effectiveTo)}` },
      { title: t("发放原因"), dataIndex: "grantReason" }
    ]} /></ListSection>}
  </>;
}

function OrdersTab({ overview, canViewOrders, onPageChange, onOpenOrder }: { overview: CustomerProfileOverview; canViewOrders: boolean; onPageChange: (page: number, pageSize: number) => void; onOpenOrder: (orderId: string) => void }) {
  const { t } = useLocale();
  return <Table<CustomerProfileOrder> size="small" rowKey="id" dataSource={overview.orders.items} scroll={{ x: 980 }} pagination={{ current: overview.orders.page, pageSize: overview.orders.pageSize, total: overview.orders.total, showSizeChanger: true, onChange: onPageChange }} columns={[
    { title: t("订单号"), dataIndex: "orderNo" },
    { title: t("经营空间"), dataIndex: "workspaceName" },
    { title: t("品类"), dataIndex: "categoryCode", render: (value: string) => t(categoryLabel(value)) },
    { title: t("关联身份"), render: (_, row) => <Space wrap>{row.relation.map((item) => <Tag key={item}>{t(relationLabel[item] ?? item)}</Tag>)}</Space> },
    { title: t("订单状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
    { title: t("租期"), render: (_, row) => `${dateTime(row.startAt)} ~ ${dateTime(row.effectiveEndAt ?? row.endAt)}` },
    { title: t("应收"), render: (_, row) => money(row.finalPayableAmount, row.currency) },
    { title: t("创建时间"), dataIndex: "createdAt", render: dateTime },
    ...(canViewOrders ? [{ title: t("操作"), key: "action", fixed: "right" as const, render: (_: unknown, row: CustomerProfileOrder) => <Button type="link" onClick={() => onOpenOrder(row.id)}>{t("查看订单")}</Button> }] : [])
  ]} />;
}

function AuditTab({ overview, canReveal }: { overview: CustomerProfileOverview; canReveal: boolean }) {
  const { t } = useLocale();
  if (canReveal && !overview.statusHistory.length && !overview.sensitiveAccess?.length) return <Empty description={t("暂无状态或访问记录")} />;
  return <>
    {Boolean(overview.statusHistory.length) && <ListSection title={t("状态历史")} style={{ marginTop: "var(--rental-layout-section-gap)" }}><Table size="small" rowKey="id" dataSource={overview.statusHistory} pagination={{ defaultPageSize: 20 }} columns={[
      { title: t("时间"), dataIndex: "at", render: dateTime },
      { title: t("范围"), dataIndex: "scope" },
      { title: t("动作"), dataIndex: "action" },
      { title: t("状态变化"), render: (_, row) => `${row.fromStatus ?? "—"} → ${row.toStatus}` },
      { title: t("原因"), dataIndex: "reason" },
      { title: t("操作人"), dataIndex: "operator", render: (value) => value || "—" }
    ]} /></ListSection>}
    <ListSection title={t("敏感资料访问审计")}>
    {!canReveal && <Alert type="info" showIcon title={t("敏感访问审计需要单独的客户敏感资料解密权限")} description={t("基础资料仍可按脱敏结果查看；没有该权限时不返回访问画像。")} />}
    {canReveal && overview.sensitiveAccess?.length ? <Table size="small" rowKey="id" dataSource={overview.sensitiveAccess} pagination={{ defaultPageSize: 20 }} columns={[
      { title: t("时间"), dataIndex: "at", render: dateTime },
      { title: t("字段"), dataIndex: "field", render: value => t(({ customer_detail: "客户资料", customer_identity_verifications: "实名核验记录" } as Record<string, string>)[value] ?? value) },
      { title: t("动作"), dataIndex: "action", render: value => t(({ detail: "查看资料", reveal: "查看明文" } as Record<string, string>)[value] ?? value) },
      { title: t("是否看到明文"), dataIndex: "revealed", render: (value) => value ? <Tag color="warning">{t("是")}</Tag> : t("否") },
      { title: t("操作人"), dataIndex: "operator", render: (value) => value || "—" },
      { title: t("原因"), dataIndex: "reason", render: (value) => value || "—" }
    ]} /> : canReveal ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无敏感资料访问记录")} /> : null}
    </ListSection>
  </>;
}

export function CustomerProfileDetails({ customerId, canManage, canView, canReveal, canViewOrders, onClose, onEdit, onQualification, actions }: Props) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [addressTarget, setAddressTarget] = useState<CustomerProfileAddress>();
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressForm] = Form.useForm<AddressForm>();
  const [identityForm] = Form.useForm<IdentityForm>();
  const [identityFiles, setIdentityFiles] = useState<UploadFile<{ id: string; mimeType: string }>[]>([]);
  useEffect(() => { setOrderPage(1); setOrderPageSize(20); setAddressOpen(false); setAddressTarget(undefined); setIdentityFiles([]); identityForm.resetFields(); }, [customerId, identityForm]);
  const overview = useQuery({
    queryKey: ["customer-profile-overview", customerId, orderPage, orderPageSize],
    queryFn: () => customerApi.profileOverview(customerId!, { page: orderPage, pageSize: orderPageSize }),
    enabled: canView && Boolean(customerId)
  });
  const canViewIdentity = canView && canReveal;
  const identityVerifications = useQuery({
    queryKey: ["customer-identity-verifications", customerId],
    queryFn: () => customerApi.identityVerifications(customerId!),
    enabled: canView && Boolean(customerId) && canViewIdentity
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["customer-profile-overview", customerId] });
    await queryClient.invalidateQueries({ queryKey: ["membership-personal"] });
  };
  const saveAddress = useMutation({
    mutationFn: (values: AddressForm) => customerApi.saveAddress(customerId!, { ...values, id: addressTarget?.id, revision: addressTarget?.revision }),
    onSuccess: async () => { await refresh(); setAddressOpen(false); setAddressTarget(undefined); addressForm.resetFields(); message.success(t("地址已保存")); },
    onError: (error: Error) => message.error(error.message || t("地址保存失败"))
  });
  const removeAddress = useMutation({
    mutationFn: (address: CustomerProfileAddress) => customerApi.removeAddress(customerId!, address.id),
    onSuccess: async () => { await refresh(); message.success(t("地址已删除")); },
    onError: (error: Error) => message.error(error.message || t("地址删除失败"))
  });
  const saveIdentityVerification = useMutation({
    mutationFn: (values: IdentityForm) => customerApi.saveIdentityVerification(customerId!, {
      ...values,
      evidenceFileAssetIds: identityFiles.filter((file) => file.status === "done").map((file) => file.response?.id).filter((id): id is string => Boolean(id))
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-identity-verifications", customerId] }),
        queryClient.invalidateQueries({ queryKey: ["customer-profile-overview", customerId] }),
        queryClient.invalidateQueries({ queryKey: ["membership-personal"] })
      ]);
      identityForm.resetFields();
      setIdentityFiles([]);
      message.success(t("实名核验记录已保存"));
    },
    onError: (error: Error) => message.error(error.message || t("实名核验保存失败"))
  });
  const identityUploadRequest: UploadProps["customRequest"] = async (options) => {
    try {
      if (!customerId) throw new Error(t("客户资料尚未就绪"));
      const file = options.file as File;
      const session = await customerApi.createIdentityUploadSession(customerId, {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        idempotencyKey: crypto.randomUUID()
      });
      if (session.mode === "provider") {
        if (!session.uploadUrl) throw new Error(t("文件平台未返回上传地址"));
        const response = await fetch(session.uploadUrl, {
          method: "PUT",
          headers: session.uploadHeaders,
          body: file
        });
        if (!response.ok) throw new Error(t("证件文件上传失败"));
      }
      const asset = await customerApi.completeIdentityUpload(customerId, session.sessionId);
      options.onSuccess?.({ id: asset.id, mimeType: asset.mimeType });
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(t("证件文件上传失败")));
    }
  };
  const openIdentityEvidence = async (fileId: string) => {
    try {
      const file = await customerApi.identityDownloadUrl(customerId!, fileId);
      if (file.mode === "simulation") {
        message.info(t("开发模拟文件没有实际影像内容，配置云存储后可预览"));
        return;
      }
      window.open(file.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("证件影像读取失败"));
    }
  };
  const current = overview.data;
  const profileTabs = [
    { key: "basic", label: t("基础资料"), children: current && <ProfileSummary overview={current} /> },
    { key: "account", label: t("账号与会员"), children: current && <AccountTab overview={current} /> },
    { key: "address", label: current && current.addresses.length > 0 ? `${t("地址")} (${current.addresses.length})` : t("地址"), children: current && <AddressTab addresses={current.addresses} canManage={canManage} onAdd={() => openAddressEditor()} onEdit={openAddressEditor} onRemove={(address) => removeAddress.mutateAsync(address)} /> },
    { key: "qualification", label: current && current.qualificationRevisions.length > 0 ? `${t("资质")} (${current.qualificationRevisions.length})` : t("资质"), children: current && <QualificationTab revisions={current.qualificationRevisions} canManage={canManage} onQualification={onQualification} /> },
    ...(canViewIdentity ? [{
      key: "identity",
      label: t("实名认证"),
      children: <Space orientation="vertical" size={16} style={{ display: "flex" }}>
        <Alert type="warning" showIcon title={t("实名核验仅记录审核事实，不代替空间业务规则")}
          description={t("通过必须上传归属此客户的证据文件；每次核验只追加记录，普通建档不能直接把状态改成已认证。")} />
        {canManage && <Card size="small" title={t("新增核验记录")}>
          <Form form={identityForm} layout="vertical" onFinish={(values) => saveIdentityVerification.mutate(values)}>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="credentialType" label={t("证件类型")} rules={[{ required: true }]}><Select options={[
                { value: "identity_card", label: t("身份证") },
                { value: "passport", label: t("护照") },
                { value: "national_id", label: t("其他法定身份证件") }
              ]} /></Form.Item></Col>
              <Col span={12}><Form.Item name="result" label={t("核验结论")} rules={[{ required: true }]}><Select options={[
                { value: "verified", label: t("核验通过") },
                { value: "rejected", label: t("核验未通过") },
                { value: "revoked", label: t("撤销既有核验") }
              ]} /></Form.Item></Col>
            </Row>
            <Form.Item label={t("证件影像或核验凭证")}>
              <Upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple maxCount={5} fileList={identityFiles} customRequest={identityUploadRequest}
                onChange={({ fileList }) => setIdentityFiles(fileList as UploadFile<{ id: string; mimeType: string }>[])}>
                <Button disabled={!canManage || saveIdentityVerification.isPending}>{t("上传证据")}</Button>
              </Upload>
            </Form.Item>
            <Form.Item name="reason" label={t("核验说明/原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
            <SaveButton disabled={!canManage || identityFiles.some((file) => file.status === "uploading")} label={t("保存核验记录")} form={identityForm} pending={saveIdentityVerification.isPending} onSave={(values) => saveIdentityVerification.mutateAsync(values)} />
          </Form>
        </Card>}
        <ListSection title={t("核验历史")}>
          <QueryState loading={identityVerifications.isLoading} error={identityVerifications.error}>
            {identityVerifications.data?.length ? <Table<CustomerIdentityVerificationSummary> size="small" rowKey="id" onRefresh={() => identityVerifications.refetch()} loading={identityVerifications.isFetching} dataSource={identityVerifications.data} pagination={{ defaultPageSize: 20 }} scroll={{ x: 800 }} columns={[
              { title: t("证件类型"), dataIndex: "credentialType" },
              { title: t("结论"), dataIndex: "result", render: (value) => <Tag color={value === "verified" ? "success" : value === "revoked" ? "default" : "error"}>{t(value === "verified" ? "已认证" : value === "revoked" ? "已撤销" : "未通过")}</Tag> },
              { title: t("核验人"), dataIndex: "reviewerName" },
              { title: t("核验时间"), dataIndex: "reviewedAt", render: dateTime },
              { title: t("原因"), dataIndex: "reason" },
              { title: t("证据"), dataIndex: "evidenceFileAssetIds", render: (ids: string[]) => ids.length ? <Space wrap>{ids.map((id) => <Button key={id} type="link" onClick={() => openIdentityEvidence(id)}>{t("查看影像")}</Button>)}</Space> : "—" }
            ]} /> : <Empty description={t("暂无实名核验记录")} />}
          </QueryState>
        </ListSection>
      </Space>
    }] : []),
    { key: "benefits", label: t("积分与权益"), children: current && <BenefitsTab overview={current} /> },
    { key: "orders", label: current ? `${t("历史订单")} (${current.orders.total})` : t("历史订单"), children: current && <OrdersTab overview={current} canViewOrders={canViewOrders} onPageChange={(page, pageSize) => { setOrderPage(page); setOrderPageSize(pageSize); }} onOpenOrder={(orderId) => navigate(`/rental/orders/${orderId}`)} /> },
    { key: "audit", label: t("状态与审计"), children: current && <AuditTab overview={current} canReveal={canReveal} /> }
  ];
  function openAddressEditor(address?: CustomerProfileAddress) {
    setAddressTarget(address);
    addressForm.setFieldsValue(address ? { recipient: address.recipient, countryCode: address.countryCode, province: address.province, city: address.city, district: address.district, detail: address.detail, postalCode: address.postalCode, isDefault: address.isDefault } : { countryCode: "CN", isDefault: false });
    setAddressOpen(true);
  }
  return <>
    <QueryState loading={overview.isLoading} error={overview.error} onRetry={canView ? () => overview.refetch({ throwOnError: true }) : undefined}>
      {current && current.profile.customerType !== "personal" ? <Alert type="warning" showIcon title={t("未找到个人会员资料")} /> : current && <RecordDetailLayout title={current.profile.name || t("个人会员资料")} onBack={onClose}
        actions={<><Button type="primary" disabled={!canManage} onClick={onEdit}>{t("编辑基础资料")}</Button>{actions}</>}
        status={<><DataTableStatus variant="soft" tone={(current.profile.membership?.status ?? current.profile.status) === "active" ? "success" : "neutral"}>{t(statusLabel[current.profile.membership?.status ?? current.profile.status] ?? current.profile.status)}</DataTableStatus><span>{t("个人会员")}</span>{current.profile.mergedIntoCustomerId && <Tag color="warning">{t("已合并")}</Tag>}</>}
        facts={[
          { key: "phone", label: "手机号", value: current.profile.phoneMasked || current.profile.phone || "—" },
          { key: "level", label: "会员等级", value: current.profile.membership?.levelName || "—" },
          { key: "identity", label: "实名认证", value: t(current.profile.identityVerified ? "已认证" : "未认证") },
          { key: "account", label: "登录账号", value: t(current.profile.accountSummary?.provisioned ? statusLabel[current.profile.accountSummary.status ?? "active"] ?? current.profile.accountSummary.status ?? "正常" : "未开通") }
        ]}>
        <TableRefreshProvider onRefresh={() => overview.refetch()} busy={overview.isFetching}><Tabs destroyOnHidden items={profileTabs} /></TableRefreshProvider>
      </RecordDetailLayout>}
    </QueryState>
    <Drawer title={addressTarget ? t("编辑配送地址") : t("新增配送地址")} size={520} open={addressOpen} destroyOnHidden onClose={() => { setAddressOpen(false); setAddressTarget(undefined); addressForm.resetFields(); }} extra={<SaveButton  label={t("保存")} form={addressForm} pending={saveAddress.isPending} onSave={(values) => saveAddress.mutateAsync(values)} />}>
      <Form form={addressForm} layout="vertical" onFinish={(values) => saveAddress.mutate(values)}>
        <Form.Item name="recipient" label={t("收件人")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="phone" label={t("联系电话")} extra={addressTarget ? t("留空表示保留现有电话；不能填写脱敏号码。") : undefined} rules={addressTarget ? [] : [{ required: true }]}><Input /></Form.Item>
        <Form.Item name="countryCode" label={t("国家/地区编码")}><Input /></Form.Item>
        <Row gutter={12}><Col span={12}><Form.Item name="province" label={t("省/直辖市")} rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="city" label={t("城市")} rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
        <Form.Item name="district" label={t("区/县")}><Input /></Form.Item>
        <Form.Item name="detail" label={t("详细地址")} rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="postalCode" label={t("邮编")}><Input /></Form.Item>
        <Form.Item name="isDefault" valuePropName="checked"><Checkbox>{t("设为默认地址")}</Checkbox></Form.Item>
      </Form>
    </Drawer>
  </>;
}
