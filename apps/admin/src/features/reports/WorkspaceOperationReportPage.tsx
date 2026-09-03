import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  RentalWorkspaceCustomerBreakdownRow,
  RentalWorkspaceLocationBreakdownRow,
  RentalWorkspaceOperationReport,
  RentalWorkspaceReportFilter
} from "@store-rental/shared";
import { RentalCoreOrderStatus, formatRentalMoney, rentalCurrencySymbol } from "@store-rental/shared";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Input, Row, Select, Space, Statistic, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

/**
 * REPORT-01A/01B：当前经营空间经营报表。
 *
 * 三条口径在这一层就固定：
 *   1. **指标定义不随品类变化**。页面标题用当前品类术语（器材/装备/车辆/设备），
 *      但「租赁收入」「应收金额」的算法四个品类完全一致，因此指标卡的标签
 *      是固定文案，不做术语替换——否则同一个数字在两个空间会被读成两种含义。
 *   2. **不展示任何车辆/门市专用字段**。车牌、门店、计费模式在非车辆品类里
 *      根本不存在；报表只显示 Rental Core 规范化事实。
 *   3. **库存与资产是当前快照，不是区间利用率**。库里没有资产状态历史，
 *      因此区间利用率在数据上不存在；页面必须把这一点显著标出来，
 *      否则运营会拿快照当区间利用率做决策。
 */
const statusLabels: Record<string, string> = {
  [RentalCoreOrderStatus.Reserved]: "已预订",
  [RentalCoreOrderStatus.ReadyForPickup]: "待取",
  [RentalCoreOrderStatus.Renting]: "在租",
  [RentalCoreOrderStatus.ReturnInspection]: "归还检查",
  [RentalCoreOrderStatus.Settling]: "待结算",
  [RentalCoreOrderStatus.Completed]: "已关闭",
  [RentalCoreOrderStatus.Cancelled]: "已取消"
};

const exceptionLabels: Record<string, string> = {
  overdue: "逾期费用",
  damage: "损坏费用",
  cancellation: "取消费用"
};

const assetStatusLabels: Record<string, string> = {
  available: "可租", reserved: "已预占", rented: "在租",
  inspection: "检查中", maintenance: "维修中", disabled: "已停用"
};

const percent = (value: number) => `${(Number(value) * 100).toFixed(2)}%`;
export function WorkspaceOperationReportPage() {
  const { message } = App.useApp();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [locationId, setLocationId] = useState<string>();
  const [customerId, setCustomerId] = useState<string>();
  const [customerType, setCustomerType] = useState<RentalWorkspaceReportFilter["customerType"]>();
  const [exporting, setExporting] = useState(false);

  const filter: RentalWorkspaceReportFilter = {
    from: range?.[0]?.startOf("day").toISOString(),
    to: range?.[1]?.endOf("day").toISOString(),
    locationId,
    customerId: customerId?.trim() || undefined,
    customerType
  };
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const report = useQuery({
    // 查询键必须包含全部筛选项，否则换了地点却命中上一次的缓存。
    queryKey: ["rental-core", "operation-report", filter],
    queryFn: () => rentalCoreApi.operationReport(filter)
  });

  const data = report.data;
  const itemLabel = profile.data?.terminology.itemLabel ?? "租赁标的";

  /**
   * 导出走同一组筛选。
   *
   * 刻意不用 `<a download>` 直链：那样绕过 axios 实例，也就绕过了鉴权头与
   * 令牌刷新，会出现「页面能看、点导出却 401」。这里取回文本再本地存盘。
   */
  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await rentalCoreApi.exportOperationReport(filter);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `operation-report-${dayjs().format("YYYYMMDDHHmmss")}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success("报表已导出（口径、筛选与权限与页面一致）");
    } catch (error) {
      message.error((error as Error).message || "导出失败");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <PageHeader
        title="经营报表"
        description={`当前经营空间的${itemLabel}订单、收入、优惠、异常、库存与地点客户口径。指标定义四个品类一致，仅标题使用品类术语。`}
        view={
          <Space wrap>
            <DatePicker.RangePicker
              allowEmpty={[true, true]}
              value={range}
              onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)}
              presets={[
                { label: "本月", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
                { label: "近 30 天", value: [dayjs().add(-29, "day"), dayjs()] }
              ]}
            />
            <Select
              allowClear
              placeholder="履约地点"
              style={{ minWidth: 180 }}
              value={locationId}
              onChange={(value) => setLocationId(value)}
              options={(locations.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
            />
            <Select
              allowClear
              placeholder="客户类型"
              style={{ minWidth: 130 }}
              value={customerType}
              onChange={(value) => setCustomerType(value)}
              options={[{ value: "personal", label: "个人客户" }, { value: "corporate", label: "企业客户" }]}
            />
            <Input
              allowClear
              placeholder="客户 id"
              style={{ width: 200 }}
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            />
          </Space>
        }
        note={{
          title: "口径说明",
          description: "订单量为非草稿订单数；租赁收入只含租金；优惠金额为方案优惠与券优惠合计；应收金额为调账后应收，税为价内税——「不含税应收」与「其中税额」是它的拆分，不要相加；异常费用取订单费用行中的逾期、损坏与取消。仅统计当前经营空间，不做跨空间汇总；导出与本页使用同一份数据与筛选。"
        }}
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportCsv()}>
              导出 CSV
            </Button>
            <Button icon={<ReloadOutlined />} aria-label="刷新经营报表" onClick={() => void report.refetch()} />
          </Space>
        }
      />
      <QueryState loading={report.isLoading} error={report.error}>
        {data && <ReportBody data={data} />}
      </QueryState>
    </>
  );
}
function ReportBody({ data }: { data: RentalWorkspaceOperationReport }) {
  // 币种取报表自带的快照，而不是再去读一次业务设置：金额是按这个币种算出来的，
  // 两处各读一次就有机会显示成不一致的单位。
  const money = (value: number) => formatRentalMoney(Number(value), data.currency);
  const symbol = rentalCurrencySymbol(data.currency);
  // 空空间返回全零是服务端口径；页面如实显示 0，不显示「暂无数据」——
  // 「0 单」与「没查到」是两件事，后者会让人以为报表坏了。
  const cards = [
    { label: "订单量", value: data.orderCount, precision: 0 },
    { label: "租赁收入", value: data.rentalRevenue, prefix: symbol, precision: 2 },
    { label: "优惠金额", value: data.discountTotal, prefix: symbol, precision: 2 },
    { label: "应收金额", value: data.receivableTotal, prefix: symbol, precision: 2 },
    // 价内税：税额已含在应收里，两个卡片是同一笔钱的拆分，不是可以相加的两项。
    { label: "不含税应收", value: data.netOfTaxTotal, prefix: symbol, precision: 2 },
    { label: "其中税额", value: data.taxTotal, prefix: symbol, precision: 2 },
    { label: "异常费用", value: data.exceptionFeeTotal, prefix: symbol, precision: 2 },
    { label: "异常订单", value: data.exceptionOrderCount, precision: 0 }
  ];
  const assets = data.utilization.serializedAssets;
  const stock = data.utilization.quantityStock;
  const occupancy = data.utilization.orderOccupancy;

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
      {/* 快照与区间必须在同一张卡里说清楚，否则「在租占比」会被当成区间利用率。 */}
      <Card className="data-panel" title="库存与资产（当前快照）" style={{ marginTop: 16 }}>
        <Alert
          type="warning"
          showIcon
          title="这一节是读取瞬间的快照，不是区间利用率"
          description={data.historicalCaliberGaps.map((gap) => <div key={gap}>· {gap}</div>)}
          style={{ marginBottom: 12 }}
        />
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Descriptions
              size="small"
              column={1}
              title={`序列化资产（时点 ${assets.snapshotAt.slice(0, 19).replace("T", " ")}）`}
              items={[
                { key: "total", label: "在册资产数", children: `${assets.totalCount}（含停用）` },
                { key: "operable", label: "可运营资产数（分母）", children: `${assets.operableCount}　= 在册 - 停用` },
                { key: "rented", label: "在租资产数（分子）", children: assets.rentedCount },
                { key: "ratio", label: "在租占比", children: percent(assets.rentedRatio) }
              ]}
            />
            <Space wrap style={{ marginTop: 8 }}>
              {assets.statusBreakdown.length
                ? assets.statusBreakdown.map((row) => (
                    <Tag key={row.status}>{assetStatusLabels[row.status] ?? row.status}：{row.count}</Tag>
                  ))
                : <span className="muted">当前经营空间尚无序列化资产</span>}
            </Space>
          </Col>
          <Col xs={24} xl={12}>
            <Descriptions
              size="small"
              column={1}
              title={`数量库存（时点 ${stock.snapshotAt.slice(0, 19).replace("T", " ")}）`}
              items={[
                { key: "onhand", label: "在库总量（分母）", children: stock.onHandTotal },
                { key: "reserved", label: "已占用（分子）", children: stock.reservedTotal },
                { key: "maintenance", label: "维修占用", children: `${stock.maintenanceTotal}　既不可租也不算已出租` },
                { key: "available", label: "可租余量", children: `${stock.availableTotal}　= 在库 - 已占用 - 维修` },
                { key: "ratio", label: "占用比", children: percent(stock.reservedRatio) }
              ]}
            />
            <Descriptions
              size="small"
              column={1}
              title="区间订单占用"
              style={{ marginTop: 8 }}
              items={[
                { key: "hours", label: "占用时长合计", children: `${occupancy.totalHours} 小时（只有分子，不产出比率）` },
                { key: "avg", label: "平均租期", children: `${occupancy.averageHours} 小时` }
              ]}
            />
          </Col>
        </Row>
      </Card>
      {/* 维度表分页展示：地点与客户基数可能很大，一次全渲染会把页面拖死。
          分页只是展示层的事——数字本身已由服务端聚合，不受翻页影响。 */}
      <Card className="data-panel" title="地点维度" style={{ marginTop: 16 }}>
        <Table<RentalWorkspaceLocationBreakdownRow>
          size="small"
          rowKey="locationId"
          dataSource={data.locationBreakdown}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: "当前筛选下没有订单" }}
          columns={[
            { title: "履约地点", render: (_: unknown, row) => <><b>{row.locationName}</b><br /><span className="muted">{row.locationId}</span></> },
            { title: "订单量", align: "right", dataIndex: "orderCount" },
            { title: "租赁收入", align: "right", render: (_: unknown, row) => money(row.rentalRevenue) },
            { title: "优惠金额", align: "right", render: (_: unknown, row) => money(row.discountTotal) },
            { title: "应收金额", align: "right", render: (_: unknown, row) => money(row.receivableTotal) },
            { title: "异常费用", align: "right", render: (_: unknown, row) => money(row.exceptionFeeTotal) }
          ]}
        />
        <div className="muted" style={{ marginTop: 8 }}>
          地点名称取下单时快照；主档改名不改写历史订单，因此这里显示的是该地点订单最多的那个名称。
          逐行订单量与金额相加等于上方总量，可与订单明细对账。
        </div>
      </Card>

      <Card className="data-panel" title="客户维度" style={{ marginTop: 16 }}>
        <Table<RentalWorkspaceCustomerBreakdownRow>
          size="small"
          rowKey={(row) => row.customerId ?? `name:${row.customerName}`}
          dataSource={data.customerBreakdown}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: "当前筛选下没有订单" }}
          columns={[
            { title: "客户", render: (_: unknown, row) => <><b>{row.customerName}</b><br /><span className="muted">{row.customerId ?? "无主档 id"}</span></> },
            { title: "类型", render: (_: unknown, row) => <Tag color={row.customerType === "corporate" ? "purple" : "blue"}>{row.customerType === "corporate" ? "企业" : "个人"}</Tag> },
            { title: "订单量", align: "right", dataIndex: "orderCount" },
            { title: "租赁收入", align: "right", render: (_: unknown, row) => money(row.rentalRevenue) },
            { title: "优惠金额", align: "right", render: (_: unknown, row) => money(row.discountTotal) },
            { title: "应收金额", align: "right", render: (_: unknown, row) => money(row.receivableTotal) },
            { title: "异常费用", align: "right", render: (_: unknown, row) => money(row.exceptionFeeTotal) }
          ]}
        />
        <div className="muted" style={{ marginTop: 8 }}>
          只展示客户名与类型；手机号、证件号不进报表与导出——报表不是客户资料的第二个出口。
        </div>
      </Card>
    </>
  );
}
