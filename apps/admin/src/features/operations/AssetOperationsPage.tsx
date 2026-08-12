import { LinkOutlined, PlusOutlined, SwapOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { AdvanceVehicleTransferTaskRequest, RunTboxCommandRequest, TboxDeviceSummary, VehicleTransferTask } from "@store-rental/shared";
import { App, Button, Card, Descriptions, Drawer, Form, Input, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const transferStatus: Record<string, { label: string; color: string }> = {
  pending: { label: "待审批", color: "warning" },
  approved: { label: "待出发", color: "blue" },
  departed: { label: "调拨中", color: "processing" },
  arrived: { label: "已到达", color: "cyan" },
  completed: { label: "已完成", color: "success" },
  cancelled: { label: "已取消", color: "default" }
};

const actionByStatus: Record<string, AdvanceVehicleTransferTaskRequest["action"] | undefined> = { pending: "approve", approved: "depart", departed: "arrive" };
const actionLabels: Record<string, string> = { approve: "审批通过", depart: "确认出发", arrive: "确认到达", cancel: "取消任务" };

export function AssetOperationsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "运营用户");
  const [createOpen, setCreateOpen] = useState(false);
  const [bindingDevice, setBindingDevice] = useState<TboxDeviceSummary>();
  const [detail, setDetail] = useState<VehicleTransferTask>();
  const [form] = Form.useForm();
  const [bindingForm] = Form.useForm<{ vehicleId: string }>();
  const tasks = useQuery({ queryKey: ["transfer-tasks"], queryFn: api.transferTasks });
  const assets = useQuery({ queryKey: ["assets", "transfer"], queryFn: () => api.assets({ page: 1, pageSize: 300 }) });
  const locations = useQuery({ queryKey: ["locations", "transfer"], queryFn: () => api.locations({ page: 1, pageSize: 300 }) });
  const devices = useQuery({ queryKey: ["tbox-devices"], queryFn: api.tboxDevices });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["transfer-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["assets"] })
    ]);
  };
  const createTask = useMutation({ mutationFn: api.createTransferTask, onSuccess: async (result) => { await refresh(); setCreateOpen(false); form.resetFields(); message.success(`调拨任务 ${result.task.taskNo} 已创建`); }, onError: () => message.error("调拨任务创建失败，请检查资产当前状态") });
  const advance = useMutation({ mutationFn: ({ id, action, reason }: { id: string; action: AdvanceVehicleTransferTaskRequest["action"]; reason?: string }) => api.advanceTransferTask(id, { action, reason, operator }), onSuccess: async (result) => { await refresh(); setDetail(result.task); message.success(result.task.status === "completed" ? "调拨已完成，资产位置已更新" : "任务状态已更新"); }, onError: () => message.error("任务流转失败，请刷新后重试") });
  const bindDevice = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId?: string }) => api.bindTboxDevice(id, { vehicleId, operator }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tbox-devices"] }); setBindingDevice(undefined); bindingForm.resetFields(); message.success("设备绑定关系已更新"); },
    onError: () => message.error("设备绑定失败，请检查资产是否已绑定其他设备")
  });
  const runCommand = useMutation({
    mutationFn: ({ id, command }: { id: string; command: RunTboxCommandRequest["command"] }) => api.runTboxCommand(id, { command, operator }),
    onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["tbox-devices"] }); message.success(result.message); },
    onError: () => message.error("设备指令下发失败，请检查在线状态")
  });

  function runAction(task: VehicleTransferTask, action: AdvanceVehicleTransferTaskRequest["action"]) {
    modal.confirm({
      title: `${actionLabels[action]} · ${task.taskNo}`,
      content: action === "arrive" ? "确认到达会更新任务内全部资产的归属网点和服务类型。" : "该操作会写入调拨任务状态与操作记录。",
      okText: actionLabels[action],
      okButtonProps: { danger: action === "cancel" },
      onOk: () => advance.mutateAsync({ id: task.id, action })
    });
  }

  function confirmCommand(device: TboxDeviceSummary, command: RunTboxCommandRequest["command"], label: string) {
    modal.confirm({
      title: `${label} · ${device.boundPlateNo ?? device.cid}`,
      content: command === "SYNC_STATUS" ? "将向设备请求最新状态。" : "这是车辆品类的真实设备控制入口，操作会写入指令记录。",
      okText: "确认下发",
      okButtonProps: { danger: command === "LOCK_DOOR" || command === "UNLOCK_DOOR" },
      onOk: () => runCommand.mutateAsync({ id: device.id, command })
    });
  }

  return (
    <>
      <PageHeader title="资产调拨与设备" description="管理资产跨网点调拨，并查看 TBox 等车载设备状态。非车辆品类后续将按品类能力隐藏设备页签。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建调拨</Button>} />
      <Card className="tabbed-workspace">
        <Tabs className="standalone-tabs" items={[
          {
            key: "transfer",
            label: "调拨任务",
            children: (
              <QueryState loading={tasks.isLoading} error={tasks.error}>
                <Table<VehicleTransferTask>
                  rowKey="id"
                  scroll={{ x: 1150 }}
                  dataSource={tasks.data ?? []}
                  columns={[
                    { title: "任务编号", dataIndex: "taskNo", fixed: "left", render: (value) => <b>{value}</b> },
                    { title: "来源", render: (_, record) => <>{record.sourceStoreName}<br /><span className="muted">{record.sourceStationName}</span></> },
                    { title: "目标", render: (_, record) => <>{record.targetStoreName}<br /><span className="muted">{record.targetStationName}</span></> },
                    { title: "资产数", dataIndex: "vehicleCount", align: "right" },
                    { title: "目标服务类型", dataIndex: "targetServiceType", render: (value) => <Tag>{value}</Tag> },
                    { title: "状态", dataIndex: "status", render: (value) => <Tag color={transferStatus[value]?.color}>{transferStatus[value]?.label ?? value}</Tag> },
                    { title: "创建时间", dataIndex: "createdAt" },
                    { title: "操作", fixed: "right", width: 240, render: (_, record) => {
                      const action = actionByStatus[record.status];
                      return <Space size={0}><Button type="link" onClick={() => setDetail(record)}>详情</Button>{action && <Button type="link" loading={advance.isPending} onClick={() => runAction(record, action)}>{actionLabels[action]}</Button>}{!["completed", "cancelled"].includes(record.status) && <Button type="link" danger onClick={() => runAction(record, "cancel")}>取消</Button>}</Space>;
                    } }
                  ]}
                />
              </QueryState>
            )
          },
          {
            key: "tbox",
            label: "TBox 设备",
            children: (
              <QueryState loading={devices.isLoading} error={devices.error}>
                <div className="table-toolbar"><Typography.Text type="secondary">设备绑定与控制属于车辆品类专属能力；切换为露营、摄影或工程设备租户后，应由品类能力配置隐藏本页签。</Typography.Text></div>
                <Table<TboxDeviceSummary>
                  rowKey="id"
                  scroll={{ x: 1180 }}
                  dataSource={devices.data ?? []}
                  columns={[
                    { title: "CID", dataIndex: "cid", render: (value) => <b>{value}</b> },
                    { title: "供应商 / 型号", render: (_, record) => <>{record.provider}<br /><span className="muted">{record.modelNo}</span></> },
                    { title: "绑定资产", render: (_, record) => <>{record.boundPlateNo ?? "未绑定"}<br /><span className="muted">{record.boundVehicleGroupName ?? "—"}</span></> },
                    { title: "所在网点", dataIndex: "currentStationName", render: (value) => value ?? "—" },
                    { title: "电量 / 信号", render: (_, record) => `${record.batteryLevel ?? "—"}% / ${record.signalStrength ?? "—"}%` },
                    { title: "心跳时间", dataIndex: "lastHeartbeatAt", render: (value) => value ?? "—" },
                    { title: "状态", render: (_, record) => <Space size={4}><Tag color={record.status === "active" ? "success" : record.status === "fault" ? "error" : "default"}>{record.status}</Tag><Tag color={record.onlineStatus === "online" ? "processing" : "default"}>{record.onlineStatus}</Tag></Space> },
                    { title: "操作", fixed: "right", width: 300, render: (_, record) => <Space size={0} wrap>
                      <Button type="link" icon={<LinkOutlined />} onClick={() => { setBindingDevice(record); bindingForm.setFieldsValue({ vehicleId: record.boundVehicleId }); }}>{record.boundVehicleId ? "改绑" : "绑定"}</Button>
                      {record.boundVehicleId && <Button type="link" danger onClick={() => modal.confirm({ title: `解绑 ${record.cid}？`, content: `当前绑定资产 ${record.boundPlateNo}，解绑会保留审计记录。`, okText: "确认解绑", okButtonProps: { danger: true }, onOk: () => bindDevice.mutateAsync({ id: record.id }) })}>解绑</Button>}
                      <Button type="link" icon={<ThunderboltOutlined />} disabled={!record.boundVehicleId} onClick={() => confirmCommand(record, "SYNC_STATUS", "同步状态")}>同步</Button>
                      <Button type="link" disabled={!record.boundVehicleId || record.onlineStatus !== "online"} onClick={() => confirmCommand(record, "FIND_CAR", "寻车")}>寻车</Button>
                      <Button type="link" danger disabled={!record.boundVehicleId || record.onlineStatus !== "online"} loading={runCommand.isPending} onClick={() => confirmCommand(record, "UNLOCK_DOOR", "解锁")}>解锁</Button>
                    </Space> }
                  ]}
                />
              </QueryState>
            )
          }
        ]} />
      </Card>

      <Drawer title="新建资产调拨" width={520} open={createOpen} destroyOnHidden onClose={() => setCreateOpen(false)} extra={<Button type="primary" icon={<SwapOutlined />} loading={createTask.isPending} onClick={() => form.submit()}>创建任务</Button>}>
        <Form form={form} layout="vertical" initialValues={{ targetServiceType: "STORE_STANDARD" }} onFinish={(values) => createTask.mutate({ ...values, operator })}>
          <Form.Item name="vehicleIds" label="待调拨资产" rules={[{ required: true, message: "请选择资产" }]}><Select mode="multiple" showSearch optionFilterProp="label" options={(assets.data?.rows ?? []).filter((item) => item.operationStatus === "idle").map((item) => ({ value: item.id, label: `${item.licensePlate} · ${item.vehicleGroupName} · ${item.currentStoreName}` }))} /></Form.Item>
          <Form.Item name="targetStoreName" label="目标门店" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={Array.from(new Set((locations.data?.rows ?? []).map((item) => item.parentStoreName))).map((value) => ({ value, label: value }))} /></Form.Item>
          <Form.Item name="targetStationName" label="目标履约点" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(locations.data?.rows ?? []).map((item) => ({ value: item.name, label: `${item.name} · ${item.parentStoreName}` }))} /></Form.Item>
          <Form.Item name="targetServiceType" label="目标服务类型" rules={[{ required: true }]}><Select options={[{ value: "STORE_STANDARD", label: "标准门店履约" }, { value: "STORE_24H", label: "24 小时自助" }]} /></Form.Item>
          <Form.Item name="reason" label="调拨原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={`调拨详情 · ${detail?.taskNo ?? ""}`} width={640} open={Boolean(detail)} onClose={() => setDetail(undefined)}>
        {detail && <>
          <Descriptions bordered size="small" column={2} items={[
            { key: "status", label: "状态", children: transferStatus[detail.status]?.label ?? detail.status },
            { key: "operator", label: "创建人", children: detail.operator },
            { key: "source", label: "来源", children: `${detail.sourceStoreName} / ${detail.sourceStationName}` },
            { key: "target", label: "目标", children: `${detail.targetStoreName} / ${detail.targetStationName}` },
            { key: "reason", label: "原因", span: 2, children: detail.reason ?? "—" }
          ]} />
          <Table style={{ marginTop: 20 }} rowKey="vehicleId" pagination={false} dataSource={detail.items} columns={[{ title: "资产", dataIndex: "licensePlate" }, { title: "来源网点", dataIndex: "sourceStationName" }, { title: "目标网点", dataIndex: "targetStationName" }, { title: "结果", dataIndex: "result", render: (value) => <Tag color={value === "completed" ? "success" : "default"}>{value}</Tag> }]} />
        </>}
      </Drawer>

      <Drawer title={`绑定设备 · ${bindingDevice?.cid ?? ""}`} width={460} open={Boolean(bindingDevice)} destroyOnHidden onClose={() => setBindingDevice(undefined)} extra={<Button type="primary" loading={bindDevice.isPending} onClick={() => bindingForm.submit()}>保存绑定</Button>}>
        <Form form={bindingForm} layout="vertical" onFinish={({ vehicleId }) => bindingDevice && bindDevice.mutate({ id: bindingDevice.id, vehicleId })}>
          <Form.Item name="vehicleId" label="车辆资产" rules={[{ required: true, message: "请选择车辆资产" }]}>
            <Select showSearch optionFilterProp="label" options={(assets.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.licensePlate} · ${item.vehicleGroupName} · ${item.currentStoreName}` }))} />
          </Form.Item>
          <Typography.Paragraph type="secondary">当前后端 TBox 能力以车辆 ID 绑定，因此这里只能选择车辆资产；这不是通用品类设备绑定模型。</Typography.Paragraph>
        </Form>
      </Drawer>
    </>
  );
}
