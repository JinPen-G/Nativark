import { DownloadOutlined } from "@ant-design/icons";
import { App, Button, Card, Col, Row, Statistic, Table } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

export function ReportsPage() {
  const { message } = App.useApp();
  const operator = useAuthStore((state) => state.user?.displayName ?? "报表用户");
  const dashboard = useQuery({ queryKey: ["reports-dashboard"], queryFn: api.dashboard });
  const vehicles = useQuery({ queryKey: ["reports-assets"], queryFn: api.reportVehicles });
  const infra = useQuery({ queryKey: ["integrations"], queryFn: api.integrations });
  const exportJob = useMutation({ mutationFn: api.createDataExchangeJob, onSuccess: () => message.success("导出任务已创建，可在平台运维中心查看执行状态"), onError: () => message.error("导出任务创建失败") });
  const loading = dashboard.isLoading || vehicles.isLoading;
  const error = dashboard.error ?? vehicles.error;

  function createExport() {
    const template = infra.data?.dataExchangeTemplates.find((item) => item.operation === "export" && item.targetObject === "orders") ?? infra.data?.dataExchangeTemplates.find((item) => item.operation === "export");
    if (!template) {
      message.warning("当前租户没有可用的导出模板");
      return;
    }
    exportJob.mutate({ operation: "export", targetModule: "store-rental", targetObject: template.targetObject, templateCode: template.templateCode, filters: { report: "overview" }, operator });
  }

  return (
    <>
      <PageHeader title="经营报表" description="汇总订单、资产利用率和资金表现。导出权限与后端数据范围在服务端执行。" extra={<Button icon={<DownloadOutlined />} loading={exportJob.isPending || infra.isLoading} onClick={createExport}>创建导出任务</Button>} />
      <QueryState loading={loading} error={error}>
        {dashboard.data && vehicles.data && <>
          <Row className="page-metrics" gutter={[16, 16]}>
            {[
              { label: "订单总数", value: dashboard.data.metricCards.find((item) => item.key.includes("order"))?.value ?? 0 },
              { label: "可用资产", value: vehicles.data.summary.rentableVehicles },
              { label: "履约中资产", value: vehicles.data.summary.rentingVehicles },
              { label: "资产利用率", value: vehicles.data.summary.utilizationPercent, suffix: "%" }
            ].map((item) => <Col xs={12} xl={6} key={item.label}><Card className="data-panel"><Statistic title={item.label} value={item.value} suffix={item.suffix} precision={item.suffix ? 1 : 0} /></Card></Col>)}
          </Row>
          <Card className="data-panel" title="标的分组表现">
            <Table rowKey="name" pagination={false} dataSource={dashboard.data.topVehicleGroups} columns={[
              { title: "标的分组", dataIndex: "name" },
              { title: "订单量", dataIndex: "value", align: "right" },
              { title: "收入", dataIndex: "amount", align: "right", render: (value) => value === undefined ? "-" : `¥${value.toLocaleString()}` },
              { title: "完成率", dataIndex: "completionRate", align: "right", render: (value) => value === undefined ? "-" : `${Math.round(value * 100)}%` }
            ]} />
          </Card>
          <Card className="data-panel" title="资产利用情况" style={{ marginTop: 16 }}>
            <Table rowKey="vehicleId" dataSource={vehicles.data.rows} scroll={{ x: 1000 }} columns={[
              { title: "资产编号", dataIndex: "plateNo" },
              { title: "标的分组", dataIndex: "vehicleGroupName" },
              { title: "当前网点", dataIndex: "currentStoreName" },
              { title: "订单量", dataIndex: "orderCount", align: "right" },
              { title: "利用率", dataIndex: "utilizationPercent", align: "right", render: (value) => `${value}%` },
              { title: "收入", dataIndex: "revenueAmount", align: "right", render: (value) => `¥${Number(value).toLocaleString()}` }
            ]} />
          </Card>
        </>}
      </QueryState>
    </>
  );
}
