function customerText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "未知";
}
Component({
  properties: { order: { type: Object, value: null }, available: { type: Boolean, value: false } },
  data: { projection: null as Record<string, string> | null },
  lifetimes: { attached() { this.project(); }, detached() { this.setData({ projection: null }); } },
  observers: { "order,available"() { this.project(); } },
  methods: {
    project() {
      const order = this.data.order as Record<string, unknown> | null;
      if (!this.data.available || !order) { this.setData({ projection: null }); return; }
      this.setData({ projection: {
        title: typeof order.title === "string" ? order.title.slice(0, 200) : "订单信息不可用",
        receivable: customerText(order.receivable), paid: customerText(order.paid),
        deposit: customerText(order.deposit), preAuth: customerText(order.preAuth),
        refundStatus: typeof order.refundStatus === "string" ? order.refundStatus.slice(0, 200) : "待核对",
        availabilityLabel: typeof order.availabilityLabel === "string" ? order.availabilityLabel.slice(0, 200) : "状态待核对",
      } });
    },
  },
});
