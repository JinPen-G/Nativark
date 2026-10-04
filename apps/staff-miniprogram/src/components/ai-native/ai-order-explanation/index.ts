import { boundedText, displayMeasurement } from "../display-format";
const detachedViews = new WeakSet<object>();
function customerText(value: unknown): string {
  if (typeof value === "string") return boundedText(value);
  if (typeof value === "number" || typeof value === "bigint") return displayMeasurement(value, null).text;
  return "未知";
}
Component({
  properties: { order: { type: Object, value: null }, available: { type: Boolean, value: false } },
  data: { projection: null as Record<string, string> | null },
  lifetimes: { attached() { detachedViews.delete(this); this.project(); }, detached() { detachedViews.add(this); this.setData({ projection: null }); } },
  observers: { "order,available"() { this.project(); } },
  methods: {
    project() {
      if (detachedViews.has(this)) return;
      const order = this.data.order as Record<string, unknown> | null;
      if (!this.data.available || !order) { this.setData({ projection: null }); return; }
      this.setData({ projection: {
        title: typeof order.title === "string" ? boundedText(order.title, 200) : "订单信息不可用",
        receivable: customerText(order.receivable), paid: customerText(order.paid),
        deposit: customerText(order.deposit), preAuth: customerText(order.preAuth),
        refundStatus: typeof order.refundStatus === "string" ? order.refundStatus.slice(0, 200) : "待核对",
        availabilityLabel: typeof order.availabilityLabel === "string" ? order.availabilityLabel.slice(0, 200) : "状态待核对",
      } });
    },
  },
});
