import { CheckOutlined, CloseOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { CorporateDetail, MemberDetail, MemberReviewTask, MembershipPlanSummary, ProcessMemberRiskRequest, SaveCorporateRequest, SaveMemberRequest, SaveMembershipPlanRequest } from "@store-rental/shared";
import { App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const money = (value: number | undefined) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CustomerPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "运营用户");
  const [reviewing, setReviewing] = useState<MemberReviewTask>();
  const [planOpen, setPlanOpen] = useState(false);
  const [memberDetail, setMemberDetail] = useState<MemberDetail>();
  const [memberOpen, setMemberOpen] = useState(false);
  const [corporateDetail, setCorporateDetail] = useState<CorporateDetail>();
  const [corporateOpen, setCorporateOpen] = useState(false);
  const [riskMember, setRiskMember] = useState<MemberDetail>();
  const [reviewForm] = Form.useForm<{ remark: string }>();
  const [planForm] = Form.useForm<SaveMembershipPlanRequest>();
  const [memberForm] = Form.useForm<SaveMemberRequest>();
  const [corporateForm] = Form.useForm<SaveCorporateRequest>();
  const [riskForm] = Form.useForm<ProcessMemberRiskRequest>();
  const members = useQuery({ queryKey: ["members"], queryFn: () => api.members({ page: 1, pageSize: 100 }) });
  const corporates = useQuery({ queryKey: ["corporates"], queryFn: () => api.corporates({ page: 1, pageSize: 100 }) });
  const reviews = useQuery({ queryKey: ["member-reviews"], queryFn: api.memberReviews });
  const plans = useQuery({ queryKey: ["membership-plans"], queryFn: api.membershipPlans });
  const loading = members.isLoading || corporates.isLoading;
  const error = members.error ?? corporates.error;
  const processReview = useMutation({
    mutationFn: ({ task, action, remark }: { task: MemberReviewTask; action: "approve" | "reject"; remark?: string }) => api.processMemberReview(task.id, { action, remark, operator }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["member-reviews"] }), queryClient.invalidateQueries({ queryKey: ["members"] })]);
      setReviewing(undefined);
      reviewForm.resetFields();
      message.success("会员审核状态已更新");
    },
    onError: () => message.error("审核处理失败")
  });
  const savePlan = useMutation({
    mutationFn: api.saveMembershipPlan,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["membership-plans"] }); setPlanOpen(false); planForm.resetFields(); message.success("会员等级已保存"); },
    onError: () => message.error("会员等级保存失败")
  });
  const saveMember = useMutation({
    mutationFn: api.saveMember,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["members"] }); setMemberOpen(false); setMemberDetail(undefined); memberForm.resetFields(); message.success("个人客户已保存"); },
    onError: () => message.error("个人客户保存失败")
  });
  const saveCorporate = useMutation({
    mutationFn: api.saveCorporate,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["corporates"] }); setCorporateOpen(false); setCorporateDetail(undefined); corporateForm.resetFields(); message.success("企业客户已保存"); },
    onError: () => message.error("企业客户保存失败")
  });
  const processRisk = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProcessMemberRiskRequest }) => api.processMemberRisk(id, { ...values, operator }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["members"] }); setRiskMember(undefined); riskForm.resetFields(); message.success("客户风险状态已更新"); },
    onError: () => message.error("风险操作失败，请检查进行中订单")
  });

  function approve(task: MemberReviewTask) {
    modal.confirm({ title: `通过 ${task.memberName} 的会员审核？`, content: "通过后会员将进入可用状态，并写入审核留痕。", okText: "确认通过", onOk: () => processReview.mutateAsync({ task, action: "approve" }) });
  }

  function editPlan(plan?: MembershipPlanSummary) {
    planForm.setFieldsValue(plan ?? { code: "", name: "", tierRank: (plans.data?.length ?? 0) + 1, status: "enabled", upgradeCondition: "", benefitSummary: "", orderDiscountPercent: 0, depositDiscountPercent: 0, freeServiceCount: 0 });
    setPlanOpen(true);
  }

  async function editMember(id?: string) {
    try {
      const detail = id ? await api.member(id) : undefined;
      setMemberDetail(detail);
      memberForm.setFieldsValue(detail ? {
        id: detail.id, name: detail.name, phone: detail.phone, email: detail.email, levelName: detail.levelName,
        status: detail.status, source: detail.source, tags: detail.tags, identityVerified: detail.identityVerified,
        driverLicenseVerified: detail.driverLicenseVerified, identityNoMasked: detail.identityNoMasked,
        driverLicenseNoMasked: detail.driverLicenseNoMasked, birthday: detail.birthday, emergencyContactName: detail.emergencyContactName,
        emergencyContactPhone: detail.emergencyContactPhone, notes: detail.notes, riskNote: detail.riskNote
      } : { name: "", phone: "", levelName: "普通会员", status: "pending_review", source: "后台录入", tags: [], identityVerified: false, driverLicenseVerified: false });
      setMemberOpen(true);
    } catch { message.error("客户详情加载失败"); }
  }

  async function editCorporate(id?: string) {
    try {
      const detail = id ? await api.corporate(id) : undefined;
      setCorporateDetail(detail);
      corporateForm.setFieldsValue(detail ? {
        id: detail.id, shortName: detail.shortName, fullName: detail.fullName, status: detail.status,
        creditLimitAmount: detail.creditLimitAmount, accountPeriodDays: detail.accountPeriodDays, billingCycleDay: detail.billingCycleDay,
        settlementMode: detail.settlementMode, contactName: detail.contactName, contactPhone: detail.contactPhone,
        billingEmail: detail.billingEmail, statementEmail: detail.statementEmail, reconciliationContactName: detail.reconciliationContactName,
        reconciliationContactPhone: detail.reconciliationContactPhone, autoGenerateStatement: detail.autoGenerateStatement,
        creditWarningAmount: detail.creditWarningAmount, invoiceTitle: detail.invoiceTitle, linkedStores: detail.linkedStores,
        notes: detail.notes, contacts: detail.contacts, contracts: detail.contracts
      } : { shortName: "", fullName: "", status: "active", creditLimitAmount: 0, accountPeriodDays: 30, billingCycleDay: 1, settlementMode: "monthly", contactName: "", contactPhone: "", autoGenerateStatement: true, linkedStores: [], contacts: [], contracts: [] });
      setCorporateOpen(true);
    } catch { message.error("企业详情加载失败"); }
  }

  async function openRisk(id: string) {
    try { const detail = await api.member(id); setRiskMember(detail); riskForm.setFieldsValue({ action: detail.status === "active" ? "suspend" : "restore", reason: "", tags: detail.tags }); }
    catch { message.error("客户详情加载失败"); }
  }

  return (
    <>
      <PageHeader title="客户与企业" description="管理个人租客、企业客户、会员资质审核和会员等级权益。" />
      <QueryState loading={loading} error={error}>
        <Row className="page-metrics" gutter={[16, 16]}>
          <Col xs={12} lg={6}><Card className="data-panel"><Statistic title="个人客户" value={members.data?.total ?? 0} /></Card></Col>
          <Col xs={12} lg={6}><Card className="data-panel"><Statistic title="企业客户" value={corporates.data?.total ?? 0} /></Card></Col>
          <Col xs={12} lg={6}><Card className="data-panel"><Statistic title="待审核" value={reviews.data?.filter((item) => item.reviewStatus === "pending").length ?? 0} /></Card></Col>
          <Col xs={12} lg={6}><Card className="data-panel"><Statistic title="会员等级" value={plans.data?.length ?? 0} /></Card></Col>
        </Row>
        <Card className="tabbed-workspace">
          <Tabs className="standalone-tabs" items={[
            {
              key: "members",
              label: "个人客户",
              children: <><div className="table-toolbar"><Typography.Text type="secondary">客户状态与租赁资质分别维护，风险操作会保留原因。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => editMember()}>新增客户</Button></div><Table rowKey="id" dataSource={members.data?.rows ?? []} scroll={{ x: 1150 }} columns={[
                { title: "客户", dataIndex: "name", render: (value, record) => <><b>{value}</b><br /><span className="muted">{record.phoneMasked}</span></> },
                { title: "会员等级", dataIndex: "levelName" },
                { title: "订单 / 消费", render: (_, record) => `${record.totalOrders} 单 / ${money(record.totalSpendAmount)}` },
                { title: "积分", dataIndex: "pointsBalance" },
                { title: "身份认证", render: (_, record) => <Space><Tag color={record.identityVerified ? "success" : "default"}>身份</Tag><Tag color={record.driverLicenseVerified ? "success" : "default"}>资质</Tag></Space> },
                { title: "审核状态", dataIndex: "reviewStatus", render: (value) => <Tag color={value === "approved" ? "success" : value === "pending" ? "orange" : "error"}>{value}</Tag> },
                { title: "客户状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
                { title: "操作", fixed: "right", render: (_, record) => <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => editMember(record.id)}>编辑</Button><Button type="link" danger onClick={() => openRisk(record.id)}>风险操作</Button></Space> }
              ]} /></>
            },
            {
              key: "corporates",
              label: "企业客户",
              children: <><div className="table-toolbar"><Typography.Text type="secondary">企业授信、账期和月结配置由企业档案统一维护。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => editCorporate()}>新增企业</Button></div><Table rowKey="id" dataSource={corporates.data?.rows ?? []} scroll={{ x: 1120 }} columns={[
                { title: "企业", dataIndex: "fullName", render: (value, record) => <><b>{value}</b><br /><span className="muted">{record.shortName}</span></> },
                { title: "联系人", render: (_, record) => <>{record.contactName}<br /><span className="muted">{record.contactPhone}</span></> },
                { title: "结算方式", dataIndex: "settlementMode" },
                { title: "账期", dataIndex: "accountPeriodDays", render: (value) => `${value} 天` },
                { title: "授信额度", dataIndex: "creditLimitAmount", align: "right", render: money },
                { title: "未结金额", dataIndex: "unpaidAmount", align: "right", render: money },
                { title: "合同", dataIndex: "contractStatus", render: (value) => <Tag>{value}</Tag> },
                { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "active" ? "success" : "default"}>{value}</Tag> },
                { title: "操作", fixed: "right", render: (_, record) => <Button type="link" icon={<EditOutlined />} onClick={() => editCorporate(record.id)}>编辑</Button> }
              ]} /></>
            },
            {
              key: "reviews",
              label: `会员审核 (${reviews.data?.filter((item) => item.reviewStatus === "pending").length ?? 0})`,
              children: <QueryState loading={reviews.isLoading} error={reviews.error}><Table<MemberReviewTask> rowKey="id" dataSource={reviews.data ?? []} columns={[
                { title: "会员", render: (_, record) => <><b>{record.memberName}</b><br /><span className="muted">{record.phoneMasked}</span></> },
                { title: "提交时间", dataIndex: "submittedAt" },
                { title: "风险标记", dataIndex: "riskFlags", render: (values: string[]) => values.length ? <Space wrap>{values.map((value) => <Tag color="warning" key={value}>{value}</Tag>)}</Space> : "无" },
                { title: "材料", dataIndex: "documents", render: (values: string[]) => values.join("、") || "—" },
                { title: "状态", dataIndex: "reviewStatus", render: (value) => <Tag color={value === "approved" ? "success" : value === "rejected" ? "error" : "warning"}>{value}</Tag> },
                { title: "操作", render: (_, record) => record.reviewStatus === "pending" ? <Space><Button type="link" icon={<CheckOutlined />} loading={processReview.isPending} onClick={() => approve(record)}>通过</Button><Button type="link" danger icon={<CloseOutlined />} onClick={() => setReviewing(record)}>驳回</Button></Space> : "已处理" }
              ]} /></QueryState>
            },
            {
              key: "plans",
              label: "会员等级",
              children: <QueryState loading={plans.isLoading} error={plans.error}><div className="table-toolbar"><span className="muted">等级权益参与订单报价中的会员折扣计算。</span><Button type="primary" icon={<PlusOutlined />} onClick={() => editPlan()}>新增等级</Button></div><Table rowKey="id" dataSource={plans.data ?? []} columns={[
                { title: "等级", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code} · Rank {record.tierRank}</span></> },
                { title: "升级条件", dataIndex: "upgradeCondition" },
                { title: "权益", dataIndex: "benefitSummary" },
                { title: "订单折扣", dataIndex: "orderDiscountPercent", render: (value) => `${value}%` },
                { title: "押金减免", dataIndex: "depositDiscountPercent", render: (value) => `${value}%` },
                { title: "免费服务", dataIndex: "freeServiceCount", render: (value) => `${value} 次` },
                { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value}</Tag> },
                { title: "操作", render: (_, record) => <Button type="link" onClick={() => editPlan(record)}>编辑</Button> }
              ]} /></QueryState>
            }
          ]} />
        </Card>
      </QueryState>

      <Drawer title={`驳回审核 · ${reviewing?.memberName ?? ""}`} open={Boolean(reviewing)} width={420} destroyOnHidden onClose={() => setReviewing(undefined)} extra={<Button danger type="primary" loading={processReview.isPending} onClick={() => reviewForm.submit()}>确认驳回</Button>}>
        <Form form={reviewForm} layout="vertical" onFinish={({ remark }) => reviewing && processReview.mutate({ task: reviewing, action: "reject", remark })}>
          <Form.Item name="remark" label="驳回原因" rules={[{ required: true, message: "请填写驳回原因" }]}><Input.TextArea rows={5} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={planForm.getFieldValue("id") ? "编辑会员等级" : "新增会员等级"} open={planOpen} width={500} destroyOnHidden onClose={() => setPlanOpen(false)} extra={<Button type="primary" loading={savePlan.isPending} onClick={() => planForm.submit()}>保存</Button>}>
        <Form form={planForm} layout="vertical" onFinish={(values) => savePlan.mutate(values)}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="等级编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="等级名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="tierRank" label="等级序号" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="upgradeCondition" label="升级条件" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="benefitSummary" label="权益说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="orderDiscountPercent" label="订单折扣 %" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="depositDiscountPercent" label="押金减免 %" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="freeServiceCount" label="免费服务次数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
        </Form>
      </Drawer>

      <Drawer title={memberDetail ? `编辑客户 · ${memberDetail.name}` : "新增个人客户"} open={memberOpen} width={620} destroyOnHidden onClose={() => { setMemberOpen(false); setMemberDetail(undefined); }} extra={<Button type="primary" loading={saveMember.isPending} onClick={() => memberForm.submit()}>保存客户</Button>}>
        <Form<SaveMemberRequest> form={memberForm} layout="vertical" onFinish={(values) => saveMember.mutate(values)}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="phone" label="手机号" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="email" label="邮箱"><Input /></Form.Item></Col><Col span={12}><Form.Item name="source" label="客户来源" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="levelName" label="会员等级" rules={[{ required: true }]}><Select options={(plans.data ?? []).map((item) => ({ value: item.name, label: item.name }))} /></Form.Item></Col><Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={["pending_review", "active", "suspended", "blacklisted"].map((value) => ({ value, label: value }))} /></Form.Item></Col></Row>
          <Form.Item name="tags" label="客户标签"><Select mode="tags" /></Form.Item>
          <Space size="large"><Form.Item name="identityVerified" label="身份已认证" valuePropName="checked"><Switch /></Form.Item><Form.Item name="driverLicenseVerified" label="租赁资质已认证" valuePropName="checked"><Switch /></Form.Item></Space>
          <Row gutter={12}><Col span={12}><Form.Item name="identityNoMasked" label="证件号（脱敏）"><Input /></Form.Item></Col><Col span={12}><Form.Item name="driverLicenseNoMasked" label="资质证号（脱敏）"><Input /></Form.Item></Col><Col span={12}><Form.Item name="birthday" label="出生日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col><Col span={12}><Form.Item name="emergencyContactName" label="紧急联系人"><Input /></Form.Item></Col><Col span={12}><Form.Item name="emergencyContactPhone" label="紧急联系电话"><Input /></Form.Item></Col></Row>
          <Form.Item name="notes" label="客户备注"><Input.TextArea rows={3} /></Form.Item><Form.Item name="riskNote" label="风险备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={corporateDetail ? `编辑企业 · ${corporateDetail.shortName}` : "新增企业客户"} open={corporateOpen} width={680} destroyOnHidden onClose={() => { setCorporateOpen(false); setCorporateDetail(undefined); }} extra={<Button type="primary" loading={saveCorporate.isPending} onClick={() => corporateForm.submit()}>保存企业</Button>}>
        <Form<SaveCorporateRequest> form={corporateForm} layout="vertical" onFinish={(values) => saveCorporate.mutate({ ...values, contacts: corporateDetail?.contacts ?? [], contracts: corporateDetail?.contracts ?? [] })}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="shortName" label="企业简称" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="fullName" label="企业全称" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="contactName" label="主联系人" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="contactPhone" label="联系电话" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={["active", "paused", "disabled"].map((value) => ({ value, label: value }))} /></Form.Item></Col><Col span={8}><Form.Item name="settlementMode" label="结算方式" rules={[{ required: true }]}><Select options={[{ value: "monthly", label: "月结" }, { value: "prepaid", label: "预付" }]} /></Form.Item></Col><Col span={8}><Form.Item name="accountPeriodDays" label="账期（天）"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="creditLimitAmount" label="授信额度"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name="creditWarningAmount" label="授信预警线"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name="billingCycleDay" label="账单日"><InputNumber min={1} max={28} style={{ width: "100%" }} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="billingEmail" label="账单邮箱"><Input /></Form.Item></Col><Col span={12}><Form.Item name="statementEmail" label="对账邮箱"><Input /></Form.Item></Col><Col span={12}><Form.Item name="reconciliationContactName" label="对账联系人"><Input /></Form.Item></Col><Col span={12}><Form.Item name="reconciliationContactPhone" label="对账电话"><Input /></Form.Item></Col></Row>
          <Form.Item name="invoiceTitle" label="开票抬头"><Input /></Form.Item><Form.Item name="linkedStores" label="关联门店编码"><Select mode="tags" /></Form.Item><Form.Item name="autoGenerateStatement" label="自动生成月结账单" valuePropName="checked"><Switch /></Form.Item><Form.Item name="notes" label="备注"><Input.TextArea rows={3} /></Form.Item>
          {corporateDetail && <Typography.Paragraph type="secondary">当前表单保留企业已有的 {corporateDetail.contacts.length} 个联系人与 {corporateDetail.contracts.length} 份合同，不会覆盖合同明细。</Typography.Paragraph>}
        </Form>
      </Drawer>

      <Drawer title={`风险操作 · ${riskMember?.name ?? ""}`} open={Boolean(riskMember)} width={460} destroyOnHidden onClose={() => setRiskMember(undefined)} extra={<Button danger type="primary" loading={processRisk.isPending} onClick={() => riskForm.submit()}>确认执行</Button>}>
        <Form<ProcessMemberRiskRequest> form={riskForm} layout="vertical" onFinish={(values) => riskMember && processRisk.mutate({ id: riskMember.id, values })}>
          <Form.Item name="action" label="操作" rules={[{ required: true }]}><Select options={[{ value: "suspend", label: "暂停客户" }, { value: "blacklist", label: "加入黑名单" }, { value: "restore", label: "恢复客户" }]} /></Form.Item>
          <Form.Item name="reason" label="原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item><Form.Item name="tags" label="同步风险标签"><Select mode="tags" /></Form.Item>
          <Typography.Paragraph type="secondary">后端会校验受影响订单；高风险操作不会直接删除客户或历史记录。</Typography.Paragraph>
        </Form>
      </Drawer>
    </>
  );
}
