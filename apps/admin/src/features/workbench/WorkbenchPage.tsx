import { ArrowRightOutlined, InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Progress, Segmented, Space, Statistic, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function WorkbenchPage() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const [period, setPeriod] = useState("本月");
  const navigate = useNavigate();

  return <>
    <PageHeader
      title="运营概览"
      description="当前登录租户的订单、资产与资金运行状态。"
      view={<Segmented value={period} onChange={(value) => setPeriod(String(value))} options={["今日", "本周", "本月"]} />}
      extra={<Button shape="circle" aria-label="刷新经营概览" icon={<ReloadOutlined />} onClick={() => void query.refetch()} />}
    />
    <QueryState loading={query.isLoading} error={query.error}>
      {query.data && <>
        <div className="context-note"><InfoCircleOutlined /><span>当前概览仍读取车辆兼容 API；新的多品类库存与订单闭环请进入 Rental Core。</span></div>
        <div className="metric-grid">
          {query.data.metricCards.slice(0, 4).map((metric) => <Card className="metric-card" key={metric.key}>
            <Statistic title={metric.label} value={metric.displayValue} valueStyle={metric.severity === "danger" ? { color: "var(--rental-color-error)" } : undefined} />
            <div className="metric-foot"><span>{period}统计</span><span className={metric.severity === "danger" ? "" : "metric-trend"}>{metric.trendText ?? "数据已更新"}</span></div>
          </Card>)}
        </div>
        <div className="workspace-grid">
          <Card
            className="workspace-panel"
            title={<span className="panel-title">订单履约漏斗 <span className="panel-count">{query.data.orderFunnel.length}</span></span>}
            extra={<Button type="link" onClick={() => navigate("/rental/orders")}>查看订单 <ArrowRightOutlined /></Button>}
          >
            <Table pagination={false} rowKey="name" dataSource={query.data.orderFunnel} columns={[
              { title: "阶段", dataIndex: "name", render: (value) => <Typography.Text strong>{value}</Typography.Text> },
              { title: "订单数", dataIndex: "value", align: "right" },
              { title: "金额", dataIndex: "amount", align: "right", render: (value: number | undefined) => value === undefined ? "-" : `¥${value.toLocaleString()}` },
              { title: "完成率", dataIndex: "completionRate", align: "right", render: (value: number | undefined) => value === undefined ? "-" : <Progress percent={Math.round(value * 100)} size="small" style={{ minWidth: 112 }} /> }
            ]} />
          </Card>
          <Card
            className="workspace-panel"
            title="资产状态"
            extra={<Button type="link" onClick={() => navigate("/rental/assets")}>全部资产 <ArrowRightOutlined /></Button>}
          >
            <Space direction="vertical" size={0} style={{ width: "100%" }}>
              {query.data.vehicleStatusDistribution.map((item) => <div className="status-row" key={item.name}>
                <div><Typography.Text strong>{item.name}</Typography.Text><Typography.Text type="secondary">当前库存状态</Typography.Text></div>
                <Tag color={item.riskCount ? "orange" : "blue"}>{item.value} 项</Tag>
              </div>)}
            </Space>
          </Card>
        </div>
      </>}
    </QueryState>
  </>;
}
