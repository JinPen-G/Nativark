import { ReloadOutlined } from "@ant-design/icons";
import type { RentalWorkspaceOperationReport } from "@store-rental/shared";
import { RentalCoreOrderStatus } from "@store-rental/shared";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Col, DatePicker, Row, Space, Statistic, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

/**
 * REPORT-01A：当前经营空间经营报表。
 *
 * 两条口径在这一层就固定：
 *   1. **指标定义不随品类变化**。页面标题用当前品类术语（器材/装备/车辆/设备），
 *      但「租赁收入」「应收金额」的算法四个品类完全一致，因此指标卡的标签
 *      是固定文案，不做术语替换——否则同一个数字在两个空间会被读成两种含义。
 *   2. **不展示任何车辆/门市专用字段**。车牌、门店、计费模式在非车辆品类里
 *      根本不存在；报表只显示 Rental Core 规范化事实。
 */
const statusLabels: Record<string, string> = {
  [RentalCoreOrderStatus.Reserved]: "已预订",
  [RentalCoreOrderStatus.ReadyForPickup]: "待取",
  [RentalCoreOrderStatus.Renting]: "在租",
  [RentalCoreOrderStatus.ReturnInspection]: "归还检查",
  [RentalCoreOrderStatus.Completed]: "已完成",
  [RentalCoreOrderStatus.Cancelled]: "已取消"
};

const exceptionLabels: Record<string, string> = {
  overdue: "逾期费用",
  damage: "损坏费用",
  cancellation: "取消费用"
};

const money = (value: number) => `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function WorkspaceOperationReportPage() {
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const from = range?.[0]?.startOf("day").toISOString();
  const to = range?.[1]?.endOf("day").toISOString();
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const report = useQuery({
    queryKey: ["rental-core", "operation-report", from ?? "all", to ?? "all"],
    queryFn: () => rentalCoreApi.operationReport({ from, to })
  });

  const data = report.data;
  const itemLabel = profile.data?.terminology.itemLabel ?? "租赁标的";

  return (
    <>
      <PageHeader
        title="经营报表"
        description={`当前经营空间的${itemLabel}订单、收入、优惠与异常口径。指标定义四个品类一致，仅标题使用品类术语。`}
        view={
          <DatePicker.RangePicker
            allowEmpty={[true, true]}
            value={range}
            onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)}
            presets={[
              { label: "本月", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
              { label: "近 30 天", value: [dayjs().add(-29, "day"), dayjs()] }
            ]}
          />
        }
        extra={<ReloadOutlined aria-label="刷新经营报表" onClick={() => void report.refetch()} />}
      />
      <Alert
        type="info"
        showIcon
        title="口径说明"
        description="订单量为非草稿订单数；租赁收入只含租金；优惠金额为方案优惠与券优惠合计；应收金额为调账后应收；异常费用取订单费用行中的逾期、损坏与取消。仅统计当前经营空间，不做跨空间汇总。"
        style={{ marginBottom: 16 }}
      />
      <QueryState loading={report.isLoading} error={report.error}>
        {data && <ReportBody data={data} />}
      </QueryState>
    </>
  );
}

function ReportBody({ data }: { data: RentalWorkspaceOperationReport }) {
  // 空空间返回全零是服务端口径；页面如实显示 0，不显示「暂无数据」——
  // 「0 单」与「没查到」是两件事，后者会让人以为报表坏了。
  const cards = [
    { label: "订单量", value: data.orderCount, precision: 0 },
    { label: "租赁收入", value: data.rentalRevenue, prefix: "¥", precision: 2 },
    { label: "优惠金额", value: data.discountTotal, prefix: "¥", precision: 2 },
    { label: "应收金额", value: data.receivableTotal, prefix: "¥", precision: 2 },
    { label: "异常费用", value: data.exceptionFeeTotal, prefix: "¥", precision: 2 },
    { label: "异常订单", value: data.exceptionOrderCount, precision: 0 }
  ];

  return (
    <>
      <Row className="page-metrics" gutter={[16, 16]}>
        {cards.map((card) => (
          <Col xs={12} xl={4} key={card.label}>
            <Card className="data-panel">
              <Statistic title={card.label} value={card.value} prefix={card.prefix} precision={card.precision} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="data-panel" title="订单量按状态" style={{ marginTop: 16 }}>
        {data.statusBreakdown.length ? (
          <Space wrap>
            {data.statusBreakdown.map((row) => (
              <Tag key={row.status} color={row.status === RentalCoreOrderStatus.Cancelled ? "default" : "processing"}>
                {statusLabels[row.status] ?? row.status}：{row.count}
              </Tag>
            ))}
          </Space>
        ) : (
          <span className="muted">当前经营空间尚无非草稿订单</span>
        )}
      </Card>

      <Card className="data-panel" title="异常费用构成" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="type"
          pagination={false}
          dataSource={data.exceptionFeeBreakdown}
          locale={{ emptyText: "当前经营空间没有异常费用" }}
          columns={[
            { title: "类型", render: (_: unknown, row) => exceptionLabels[row.type] ?? row.type },
            { title: "金额", align: "right", render: (_: unknown, row) => money(row.amount) },
            { title: "涉及订单", align: "right", dataIndex: "orderCount" }
          ]}
        />
        <div className="muted" style={{ marginTop: 8 }}>
          一张订单同时逾期与损坏时，「异常订单」按去重后的订单计，因此可能小于各类型涉及订单之和。
        </div>
      </Card>
    </>
  );
}
