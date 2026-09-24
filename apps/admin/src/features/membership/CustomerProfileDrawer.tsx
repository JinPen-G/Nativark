import type {
  CustomerProfileAddress,
  CustomerProfileBenefitAccount,
  CustomerProfileCouponEntry,
  CustomerProfileOrder,
  CustomerProfileOverview,
  CustomerProfileRewardEntry,
  CustomerQualificationRevision
} from "@rental-os/shared";
import { RENTAL_CATEGORY_DEFINITIONS } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Alert, Button, Card, Checkbox, Col, Descriptions, Divider, Drawer, Empty, Form, Input, Popconfirm, Row, Space, Statistic, Table, Tabs, Tag } from "antd";
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

type Props = {
  open: boolean;
  customerId?: string;
  canManage: boolean;
  canReveal: boolean;
  canViewOrders: boolean;
  onClose: () => void;
  onEdit: () => void;
  onQualification: () => void;
};

const dateTime = (value?: string) => value ? new Date(value).toLocaleString() : "—";
const dateOnly = (value?: string) => value ? new Date(value).toLocaleDateString() : "—";
const money = (value: number, currency = "CNY") => `${currency} ${value.toFixed(2)}`;
const categoryLabel = (value: string) => RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === value)?.name ?? value;
const statusLabel: Record<string, string> = {
  active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销",
  pending_activation: "待激活", claimed: "可用", locked: "已锁定", redeemed: "已核销", expired: "已过期", void: "已作废",
  granted: "已发放", reversed: "已冲正"
};
const statusColor = (value: string) => value === "active" || value === "granted" || value === "claimed" ? "success" : value === "reversed" || value === "void" || value === "closed" ? "default" : "warning";
const relationLabel: Record<string, string> = { customer: "订单客户", contract_subject: "签约主体", payer: "付款主体", user: "使用人", booking_identity: "预约身份" };

function ProfileSummary({ overview, canManage, onEdit }: { overview: CustomerProfileOverview; canManage: boolean; onEdit: () => void }) {
  const { t } = useLocale();
  const profile = overview.profile;
  return <>
    <Space style={{ marginBottom: 16 }} wrap>
      <Tag color={profile.customerType === "corporate" ? "blue" : "purple"}>{profile.customerType === "corporate" ? t("企业客户") : t("个人客户")}</Tag>
      <Tag color={statusColor(profile.status)}>{t(statusLabel[profile.status] ?? profile.status)}</Tag>
      {profile.mergedIntoCustomerId && <Tag color="warning">{t("已合并")}</Tag>}
      <Button type="primary" disabled={!canManage} onClick={onEdit}>{t("编辑基础资料")}</Button>
    </Space>
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 2 }} items={[
      { key: "name", label: t("姓名/名称"), children: profile.name || "—" },
      { key: "phone", label: t("手机号"), children: profile.phone || profile.phoneMasked || "—" },
      { key: "email", label: t("邮箱"), children: profile.email || "—" },
      { key: "identity", label: t("证件号"), children: profile.identityNoMasked || "—" },
      { key: "verified", label: t("实名认证"), children: profile.identityVerified ? <Tag color="success">{t("已认证")}</Tag> : <Tag>{t("未认证")}</Tag> },
      { key: "gender", label: t("性别"), children: profile.gender || "—" },
      { key: "birthday", label: t("生日"), children: profile.birthday || "—" },
      { key: "region", label: t("常住地区"), children: profile.region || "—" },
      { key: "source", label: t("来源渠道"), children: profile.sourceChannel || "—" },
      { key: "created", label: t("建档时间"), children: dateTime(profile.createdAt) },
      { key: "updated", label: t("最近更新"), children: dateTime(profile.updatedAt) },
      { key: "id", label: t("客户主档 ID"), children: profile.id }
    ]} />
    {profile.customerType === "corporate" && <Card size="small" title={t("企业基础资料")} style={{ marginTop: 16 }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
        { key: "corporateName", label: t("企业名称"), children: profile.corporateName || profile.name || "—" },
        { key: "taxNo", label: t("统一社会信用代码"), children: profile.corporateTaxNo || "—" }
      ]} />
    </Card>}
    <Divider>{t("联系人")}</Divider>
    {profile.contacts?.length ? <Table size="small" rowKey="id" pagination={false} dataSource={profile.contacts} columns={[
      { title: t("姓名"), dataIndex: "name" },
      { title: t("类型"), dataIndex: "kind" },
      { title: t("关系"), dataIndex: "relation", render: (value) => value || "—" },
      { title: t("电话"), dataIndex: "phoneMasked" },
      { title: t("主联系人"), dataIndex: "isPrimary", render: (value) => value ? <Tag color="processing">{t("是")}</Tag> : "—" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无联系人")} />}
    <Divider>{t("授权经办人")}</Divider>
    {overview.profile.authorizedAgents?.length ? <Table size="small" rowKey="id" pagination={false} dataSource={overview.profile.authorizedAgents} columns={[
      { title: t("姓名"), dataIndex: "agentName" },
      { title: t("电话"), dataIndex: "agentPhoneMasked" },
      { title: t("有效期"), render: (_, row) => `${dateOnly(row.validFrom)} ~ ${dateOnly(row.validTo)}` },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无授权经办人")} />}
  </>;
}

function AddressTab({ addresses, canManage, onAdd, onEdit, onRemove }: {
  addresses: CustomerProfileAddress[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (address: CustomerProfileAddress) => void;
  onRemove: (address: CustomerProfileAddress) => void;
}) {
  const { t } = useLocale();
  return <>
    <Space style={{ marginBottom: 12 }}><Button type="primary" onClick={onAdd} disabled={!canManage}>{t("新增地址")}</Button><span style={{ color: "#777" }}>{t("历史订单使用的是下单时地址快照，不会随这里修改。")}</span></Space>
    {addresses.length ? <Table<CustomerProfileAddress> size="small" rowKey="id" dataSource={addresses} pagination={false} scroll={{ x: 760 }} columns={[
      { title: t("收件人"), dataIndex: "recipient" },
      { title: t("电话"), dataIndex: "phoneMasked" },
      { title: t("地区"), render: (_, row) => [row.province, row.city, row.district].filter(Boolean).join(" / ") },
      { title: t("详细地址"), dataIndex: "detail" },
      { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? <Tag color="processing">{t("默认")}</Tag> : "—" },
      { title: t("更新于"), dataIndex: "updatedAt", render: dateTime },
      { title: t("操作"), render: (_, row) => <Space><Button type="link" disabled={!canManage} onClick={() => onEdit(row)}>{t("编辑")}</Button><Popconfirm title={t("确认删除这个地址？")} onConfirm={() => onRemove(row)} disabled={!canManage}><Button type="link" danger disabled={!canManage}>{t("删除")}</Button></Popconfirm></Space> }
    ]} /> : <Empty description={t("暂无配送地址")} />}
  </>;
}

function AccountTab({ overview }: { overview: CustomerProfileOverview }) {
  const { t } = useLocale();
  const account = overview.profile.accountSummary;
  const membership = overview.profile.membership;
  return <>
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: "account", label: t("登录账号"), children: account?.provisioned ? <Tag color={statusColor(account.status ?? "active")}>{t(statusLabel[account.status ?? "active"] ?? account.status ?? "")}</Tag> : <Tag>{t("未开通")}</Tag> },
      { key: "login", label: t("登录手机号"), children: account?.loginPhoneMasked || "—" },
      { key: "membership", label: t("会员状态"), children: membership ? <Tag color={statusColor(membership.status)}>{t(statusLabel[membership.status] ?? membership.status)}</Tag> : t("未开通会员") },
      { key: "level", label: t("会员等级"), children: membership?.levelName || "—" },
      { key: "firstOrder", label: t("首单时间"), children: dateTime(membership?.firstOrderAt) },
      { key: "joined", label: t("会员创建时间"), children: dateTime(membership?.createdAt) }
    ]} />
    <Divider>{t("会员方案授予")}</Divider>
    {overview.membershipPlanAssignments.length ? <Table size="small" rowKey="id" dataSource={overview.membershipPlanAssignments} pagination={false} scroll={{ x: 820 }} columns={[
      { title: t("方案"), dataIndex: "planName" },
      { title: t("来源"), dataIndex: "source" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("有效期"), render: (_, row) => `${dateTime(row.effectiveFrom)} ~ ${dateTime(row.effectiveTo)}` },
      { title: t("原因"), dataIndex: "reason", render: (value) => value || "—" },
      { title: t("撤销原因"), dataIndex: "revokeReason", render: (value) => value || "—" }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无会员方案授予")} />}
    <Divider>{t("企业关系")}</Divider>
    {overview.corporateRelations.length ? <Table size="small" rowKey="id" dataSource={overview.corporateRelations} pagination={false} columns={[
      { title: t("企业"), dataIndex: "corporateName" },
      { title: t("个人会员"), dataIndex: "personalCustomerName" },
      { title: t("角色"), dataIndex: "role", render: (value) => value === "admin" ? t("企业管理员") : t("员工") },
      { title: t("部门"), dataIndex: "department", render: (value) => value || "—" },
      { title: t("工号"), dataIndex: "employeeNo", render: (value) => value || "—" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无企业员工/企业关系")} />}
  </>;
}

function QualificationTab({ revisions, canManage, onQualification }: { revisions: CustomerQualificationRevision[]; canManage: boolean; onQualification: () => void }) {
  const { t } = useLocale();
  return <>
    <Space style={{ marginBottom: 12 }}><Button type="primary" disabled={!canManage} onClick={onQualification}>{t("提交/补充资质")}</Button><span style={{ color: "#777" }}>{t("证件适用范围按提交时经营空间固化，历史审核记录只追加不覆盖。")}</span></Space>
    {revisions.length ? <Table<CustomerQualificationRevision> size="small" rowKey="id" dataSource={revisions} pagination={{ pageSize: 8 }} scroll={{ x: 980 }} columns={[
      { title: t("证件类型"), dataIndex: "qualificationType" },
      { title: t("证件编号"), dataIndex: "referenceNoMasked", render: (value) => value || "—" },
      { title: t("品类"), dataIndex: "categoryCode" },
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
  return <>
    <Row gutter={[12, 12]}>
      {overview.benefits.accounts.map((account: CustomerProfileBenefitAccount) => <Col xs={24} md={12} xl={8} key={account.workspaceId}><Card size="small" title={account.workspaceName} extra={<Tag>{t(categoryLabel(account.categoryCode))}</Tag>}><Row gutter={8}><Col span={8}><Statistic title={t("积分")} value={account.pointsBalance} /></Col><Col span={8}><Statistic title={t("营销余额")} value={account.marketingBalance} precision={2} /></Col><Col span={8}><Statistic title={t("奖励券")} value={account.availableRewardCouponCount} /></Col></Row><div style={{ color: "#777", marginTop: 8 }}>{t("更新于")} {dateTime(account.updatedAt)}</div></Card></Col>)}
    </Row>
    {!overview.benefits.accounts.length && <Empty description={t("暂无积分/余额账户")} />}
    <Divider>{t("积分与奖励流水")}</Divider>
    {overview.benefits.rewards.length ? <Table<CustomerProfileRewardEntry> size="small" rowKey="id" dataSource={overview.benefits.rewards} pagination={{ pageSize: 8 }} scroll={{ x: 820 }} columns={[
      { title: t("空间"), render: (_, row) => row.workspaceName },
      { title: t("类型"), dataIndex: "rewardType", render: (value) => value === "points" ? t("积分") : value === "balance" ? t("营销余额") : value === "coupon" ? t("奖励券") : t(value) },
      { title: t("变动"), dataIndex: "amount" },
      { title: t("触发来源"), dataIndex: "triggerType" },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("原因"), dataIndex: "reason" },
      { title: t("时间"), dataIndex: "createdAt", render: dateTime }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无奖励流水")} />}
    <Divider>{t("客户优惠券")}</Divider>
    {overview.benefits.coupons.length ? <Table<CustomerProfileCouponEntry> size="small" rowKey="id" dataSource={overview.benefits.coupons} pagination={{ pageSize: 8 }} scroll={{ x: 920 }} columns={[
      { title: t("空间"), dataIndex: "workspaceName" },
      { title: t("优惠券"), dataIndex: "templateName" },
      { title: t("版本"), dataIndex: "templateVersion" },
      { title: t("面值"), render: (_, row) => `${row.discountType} ${row.discountValue}` },
      { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{t(statusLabel[value] ?? value)}</Tag> },
      { title: t("有效期"), render: (_, row) => `${dateOnly(row.effectiveFrom)} ~ ${dateOnly(row.effectiveTo)}` },
      { title: t("发放原因"), dataIndex: "grantReason" }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无优惠券")} />}
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
  return <>
    <Divider>{t("状态历史")}</Divider>
    {overview.statusHistory.length ? <Table size="small" rowKey="id" dataSource={overview.statusHistory} pagination={{ pageSize: 8 }} columns={[
      { title: t("时间"), dataIndex: "at", render: dateTime },
      { title: t("范围"), dataIndex: "scope" },
      { title: t("动作"), dataIndex: "action" },
      { title: t("状态变化"), render: (_, row) => `${row.fromStatus ?? "—"} → ${row.toStatus}` },
      { title: t("原因"), dataIndex: "reason" },
      { title: t("操作人"), dataIndex: "operator", render: (value) => value || "—" }
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无状态历史")} />}
    <Divider>{t("敏感资料访问审计")}</Divider>
    {!canReveal && <Alert type="info" showIcon title={t("敏感访问审计需要单独的客户敏感资料解密权限")} description={t("基础资料仍可按脱敏结果查看；没有该权限时不返回访问画像。")} />}
    {canReveal && overview.sensitiveAccess?.length ? <Table size="small" rowKey="id" dataSource={overview.sensitiveAccess} pagination={{ pageSize: 8 }} columns={[
      { title: t("时间"), dataIndex: "at", render: dateTime },
      { title: t("字段"), dataIndex: "field" },
      { title: t("动作"), dataIndex: "action" },
      { title: t("是否看到明文"), dataIndex: "revealed", render: (value) => value ? <Tag color="warning">{t("是")}</Tag> : t("否") },
      { title: t("操作人"), dataIndex: "operator", render: (value) => value || "—" },
      { title: t("原因"), dataIndex: "reason", render: (value) => value || "—" }
    ]} /> : canReveal ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无敏感资料访问记录")} /> : null}
  </>;
}

export function CustomerProfileDrawer({ open, customerId, canManage, canReveal, canViewOrders, onClose, onEdit, onQualification }: Props) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [addressTarget, setAddressTarget] = useState<CustomerProfileAddress>();
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressForm] = Form.useForm<AddressForm>();
  useEffect(() => { setOrderPage(1); setOrderPageSize(20); setAddressOpen(false); setAddressTarget(undefined); }, [customerId]);
  const overview = useQuery({
    queryKey: ["customer-profile-overview", customerId, orderPage, orderPageSize],
    queryFn: () => customerApi.profileOverview(customerId!, { page: orderPage, pageSize: orderPageSize }),
    enabled: open && Boolean(customerId)
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
  const current = overview.data;
  const openAddressEditor = (address?: CustomerProfileAddress) => {
    setAddressTarget(address);
    addressForm.setFieldsValue(address ? { recipient: address.recipient, countryCode: address.countryCode, province: address.province, city: address.city, district: address.district, detail: address.detail, postalCode: address.postalCode, isDefault: address.isDefault } : { countryCode: "CN", isDefault: false });
    setAddressOpen(true);
  };
  return <>
    <Drawer title={current ? `${t("客户资料")}: ${current.profile.name}` : t("客户资料")} size={1040} open={open} onClose={onClose} destroyOnHidden>
      <QueryState loading={overview.isLoading} error={overview.error}>
        {current && <Tabs destroyOnHidden items={[
          { key: "basic", label: t("基础资料"), children: <ProfileSummary overview={current} canManage={canManage} onEdit={onEdit} /> },
          { key: "account", label: t("账号与会员"), children: <AccountTab overview={current} /> },
          { key: "address", label: `${t("地址")} (${current.addresses.length})`, children: <AddressTab addresses={current.addresses} canManage={canManage} onAdd={() => openAddressEditor()} onEdit={openAddressEditor} onRemove={(address) => removeAddress.mutate(address)} /> },
          { key: "qualification", label: `${t("资质")} (${current.qualificationRevisions.length})`, children: <QualificationTab revisions={current.qualificationRevisions} canManage={canManage} onQualification={onQualification} /> },
          { key: "benefits", label: t("积分与权益"), children: <BenefitsTab overview={current} /> },
          { key: "orders", label: `${t("历史订单")} (${current.orders.total})`, children: <OrdersTab overview={current} canViewOrders={canViewOrders} onPageChange={(page, pageSize) => { setOrderPage(page); setOrderPageSize(pageSize); }} onOpenOrder={(orderId) => { onClose(); navigate(`/rental/orders/${orderId}`); }} /> },
          { key: "audit", label: t("状态与审计"), children: <AuditTab overview={current} canReveal={canReveal} /> }
        ]} />}
      </QueryState>
    </Drawer>
    <Drawer title={addressTarget ? t("编辑配送地址") : t("新增配送地址")} size={520} open={addressOpen} destroyOnHidden onClose={() => { setAddressOpen(false); setAddressTarget(undefined); addressForm.resetFields(); }} extra={<Button type="primary" loading={saveAddress.isPending} onClick={() => addressForm.submit()}>{t("保存")}</Button>}>
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
