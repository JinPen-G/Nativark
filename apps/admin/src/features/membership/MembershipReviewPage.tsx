import type { CustomerMembershipReview, CustomerMembershipReviewStatus } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Drawer, Form, Input, Modal, Radio, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { membershipApi } from "@/api/membership";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const statusMeta: Record<CustomerMembershipReviewStatus, { text: string; color: string }> = {
  pending: { text: "待审核", color: "processing" }, approved: { text: "已通过", color: "success" },
  rejected: { text: "已拒绝", color: "error" }, supplement_required: { text: "待补件", color: "warning" }, cancelled: { text: "已取消", color: "default" }
};
const typeText: Record<string, string> = { registration: "会员注册", qualification: "资质证件" };

export function MembershipReviewPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canRegistrationReview = hasPermission("rental-os:member:review");
  const canQualificationReview = hasPermission("rental-os:member:qualification-review");
  const [filter, setFilter] = useState<{ status?: string; type?: string }>({ status: "pending" });
  const [selected, setSelected] = useState<CustomerMembershipReview>();
  const [detailTarget, setDetailTarget] = useState<CustomerMembershipReview>();
  const [form] = Form.useForm<{ status: "approved" | "rejected" | "supplement_required" | "cancelled"; reason?: string }>();
  const reviews = useQuery({ queryKey: ["membership-reviews", filter], queryFn: () => membershipApi.reviews(filter) });
  const decide = useMutation({
    mutationFn: (values: { status: "approved" | "rejected" | "supplement_required" | "cancelled"; reason?: string }) => membershipApi.review(selected!.id, values),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["membership-reviews"] }); setSelected(undefined); form.resetFields(); message.success("审核结果已保存"); }
  });
  const canHandle = (row: CustomerMembershipReview) => row.reviewType === "registration" ? canRegistrationReview : canQualificationReview;

  return <QueryState loading={reviews.isLoading} error={reviews.error}>
    <PageHeader title="会员审核" description="注册审核与证件审核分开处理；审核方式由当前经营空间配置。" view={<Space><Select value={filter.status} style={{ width: 120 }} options={[{ value: "", label: "全部状态" }, ...Object.entries(statusMeta).map(([value, item]) => ({ value, label: item.text }))]} onChange={(status) => setFilter((value) => ({ ...value, status: status || undefined }))} /><Select value={filter.type} style={{ width: 120 }} options={[{ value: "", label: "全部类型" }, { value: "registration", label: "会员注册" }, { value: "qualification", label: "资质证件" }]} onChange={(type) => setFilter((value) => ({ ...value, type: type || undefined }))} /></Space>} />
    <Card>
      <Table<CustomerMembershipReview> rowKey="id" dataSource={reviews.data ?? []} pagination={{ pageSize: 20 }} columns={[
        { title: "会员", dataIndex: "customerName" }, { title: "审核类型", render: (_, row) => typeText[row.reviewType] ?? row.reviewType },
        { title: "证件类型", dataIndex: "qualificationType", render: (value) => value ?? "—" },
        { title: "渠道", dataIndex: "channel", render: (value) => value === "app" ? "APP 注册" : "后台" },
        { title: "状态", render: (_, row) => <Tag color={statusMeta[row.status].color}>{statusMeta[row.status].text}</Tag> },
        { title: "提交时间", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString() },
         { title: "操作", render: (_, row) => <Space>
           <Button type="link" onClick={() => setDetailTarget(row)}>查看</Button>
           {row.status === "pending" || row.status === "supplement_required"
             ? <Button type="link" disabled={!canHandle(row)} onClick={() => { form.setFieldsValue({ status: "approved" }); setSelected(row); }}>审核</Button>
             : <span>{row.reason ?? "—"}</span>}
         </Space> }
      ]} />
    </Card>
    <Modal title={selected ? `${typeText[selected.reviewType]}审核` : "审核"} open={Boolean(selected)} onCancel={() => setSelected(undefined)} onOk={() => form.submit()} confirmLoading={decide.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values) => decide.mutate(values)}>
        <Form.Item label="审核结论" name="status" rules={[{ required: true }]}><Radio.Group options={[{ value: "approved", label: "通过" }, { value: "supplement_required", label: "补充资料" }, { value: "rejected", label: "拒绝" }, { value: "cancelled", label: "取消" }]} /></Form.Item>
        <Form.Item label="说明" name="reason" dependencies={["status"]} rules={[({ getFieldValue }) => ({ required: getFieldValue("status") !== "approved", message: "补件、拒绝或取消审核必须填写原因" })]}><Input.TextArea maxLength={500} rows={3} placeholder="补件、拒绝或取消时请说明原因" /></Form.Item>
      </Form>
    </Modal>
    <Drawer title={detailTarget ? `${typeText[detailTarget.reviewType] ?? detailTarget.reviewType}详情` : "审核详情"} open={Boolean(detailTarget)} onClose={() => setDetailTarget(undefined)} size={520} destroyOnHidden>
      {detailTarget && <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Card size="small" title="审核任务">
          <div>会员：{detailTarget.customerName ?? detailTarget.customerId}</div>
          <div>证件类型：{detailTarget.qualificationType ?? "—"}</div>
          <div>提交渠道：{detailTarget.channel === "app" ? "APP" : "后台"}</div>
          <div>提交时间：{new Date(detailTarget.createdAt).toLocaleString()}</div>
          <div>审核状态：<Tag color={statusMeta[detailTarget.status].color}>{statusMeta[detailTarget.status].text}</Tag></div>
          <div>审核意见：{detailTarget.reason ?? "—"}</div>
        </Card>
        {detailTarget.qualificationSnapshot && <Card size="small" title="本次证件快照">
          <div>证件编号：{detailTarget.qualificationSnapshot.referenceNoMasked ?? "—"}</div>
          <div>签发时间：{detailTarget.qualificationSnapshot.issuedAt?.slice(0, 10) ?? "—"}</div>
          <div>失效时间：{detailTarget.qualificationSnapshot.expiresAt?.slice(0, 10) ?? "—"}</div>
          <div>适用范围：{detailTarget.qualificationSnapshot.applicableScope.categoryCode} / {detailTarget.qualificationSnapshot.applicableScope.workspaceId}</div>
          <div>附件引用：{detailTarget.qualificationSnapshot.evidenceRef ?? "未关联"}</div>
          <div>快照审核结果：{statusMeta[detailTarget.qualificationSnapshot.reviewStatus].text}</div>
        </Card>}
      </Space>}
    </Drawer>
  </QueryState>;
}
