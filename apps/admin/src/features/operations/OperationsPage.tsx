import type { StoreRentalDispatchTask } from "@store-rental/shared";
import { Alert, App, Button, Card, Col, Row, Space, Statistic, Table, Tag, Tabs } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

export function OperationsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "调度员");
  const board = useQuery({ queryKey: ["dispatch-board"], queryFn: api.dispatchBoard });
  const tasks = useQuery({ queryKey: ["dispatch-tasks"], queryFn: api.dispatchTasks });
  const loading = board.isLoading || tasks.isLoading;
  const error = board.error ?? tasks.error;
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["dispatch-tasks"] }), queryClient.invalidateQueries({ queryKey: ["dispatch-board"] })]); };
  const claim = useMutation({ mutationFn: (task: StoreRentalDispatchTask) => api.claimDispatchTask({ taskId: task.id, orderId: task.orderId, taskType: task.taskType, operator }), onSuccess: async (result) => { await refresh(); message.success(result.message); }, onError: () => message.error("任务领取失败，可能已被其他调度员处理") });
  const complete = useMutation({ mutationFn: (task: StoreRentalDispatchTask) => api.processDispatchTask({ taskId: task.id, orderId: task.orderId, taskType: task.taskType, status: "completed", operator, memo: "React 营运端完成任务" }), onSuccess: async (result) => { await refresh(); message.success(result.message); }, onError: () => message.error("任务完成失败") });

  function confirmComplete(task: StoreRentalDispatchTask) {
    modal.confirm({ title: `完成任务：${task.title}？`, content: "完成后会写入调度事件并刷新任务池。请先确认资产分配或人工处置已经落实。", okText: "确认完成", onOk: () => complete.mutateAsync(task) });
  }

  return (
    <>
      <PageHeader title="资产运营" description="处理资产分配、履约风险和运营任务。车辆调度是当前后端能力，通用资产运营将按品类 capability 接入。" />
      <QueryState loading={loading} error={error}>
        {board.data && (
          <>
            <Alert showIcon type="warning" style={{ marginBottom: 16 }} title="车辆调度仅对启用调度能力的品类显示；摄影和露营设备默认使用资产准备、领取与归还质检任务。" />
            <Row className="page-metrics" gutter={[16, 16]}>
              {[
                { label: "参与订单", value: board.data.metrics.activeOrders },
                { label: "待分配", value: board.data.metrics.pendingOrders },
                { label: "已锁定", value: board.data.metrics.lockedOrders },
                { label: "人工处理", value: board.data.metrics.manualRequiredOrders }
              ].map((item) => (
                <Col xs={12} xl={6} key={item.label}>
                  <Card className="data-panel">
                    <Statistic title={item.label} value={item.value} />
                  </Card>
                </Col>
              ))}
            </Row>
            <Card className="tabbed-workspace">
              <Tabs
                className="standalone-tabs"
                items={[
                  {
                    key: "board",
                    label: "资产分配",
                    children: (
                      <Table
                        rowKey="orderId"
                        dataSource={board.data.rows}
                        scroll={{ x: 1100 }}
                        columns={[
                          { title: "订单", dataIndex: "orderNo" },
                          { title: "客户", dataIndex: "customerName" },
                          { title: "标的分组", dataIndex: "vehicleGroupName" },
                          { title: "领取时间", dataIndex: "pickupAt" },
                          { title: "已分配资产", dataIndex: "currentPlateNo", render: (value) => value || <Tag color="orange">待分配</Tag> },
                          { title: "状态", dataIndex: "dispatchStatus", render: (value) => <Tag color={value === "locked" ? "success" : "blue"}>{value}</Tag> },
                          { title: "候选资产", dataIndex: "candidates", render: (value) => value?.length ?? 0 }
                        ]}
                      />
                    )
                  },
                  {
                    key: "tasks",
                    label: "运营任务",
                    children: (
                      <Table
                        rowKey="id"
                        dataSource={tasks.data?.tasks ?? []}
                        scroll={{ x: 1000 }}
                        columns={[
                          { title: "任务", dataIndex: "title" },
                          { title: "订单", dataIndex: "orderNo" },
                          { title: "优先级", dataIndex: "priority", render: (value) => <Tag color={value === "high" ? "error" : value === "medium" ? "orange" : "blue"}>{value}</Tag> },
                          { title: "说明", dataIndex: "description" },
                          { title: "状态", dataIndex: "taskStatus", render: (value) => <Tag>{value ?? "open"}</Tag> },
                          { title: "处理人", dataIndex: "claimedBy", render: (value) => value ?? "—" },
                          { title: "操作", fixed: "right", render: (_, record) => <Space>{(!record.taskStatus || record.taskStatus === "open") && <Button type="link" loading={claim.isPending} onClick={() => claim.mutate(record)}>领取</Button>}{["claimed", "processing"].includes(record.taskStatus ?? "") && <Button type="link" loading={complete.isPending} onClick={() => confirmComplete(record)}>完成</Button>}</Space> }
                        ]}
                      />
                    )
                  }
                ]}
              />
            </Card>
          </>
        )}
      </QueryState>
    </>
  );
}
