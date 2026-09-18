import type { RentalCustomerCoupon } from "@rental-os/shared";
import { fetchCoupons } from "../../api/catalog";
import { formatMoney } from "../../core/money";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState } from "../../core/page";
import { currentService } from "../../core/session";
import { ROUTES, requireSignIn } from "../../core/ui";

/** 优惠券：当前服务下本人已有的券（可用/已用/已过期分组）。领券中心属后续任务，这里不放领券入口。 */
interface CouponRow {
  id: string;
  name: string;
  value: string;
  threshold: string;
  period: string;
  status: string;
  statusLabel: string;
  usable: boolean;
}

Page({
  data: { view: loadingState(), serviceName: "", usable: [] as CouponRow[], others: [] as CouponRow[] },

  onLoad() {
    if (!requireSignIn(ROUTES.coupons)) return;
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ serviceName: currentService()?.name ?? "" });
    try {
      const coupons = await fetchCoupons();
      const rows = coupons.map((coupon) => this.row(coupon));
      const usable = rows.filter((row) => row.usable);
      const others = rows.filter((row) => !row.usable);
      this.setData({ usable, others, view: rows.length ? readyState() : emptyState("暂无优惠券", "商户发放的优惠券会显示在这里；确认订单时可直接选用。", "", "", "none") });
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  row(coupon: RentalCustomerCoupon): CouponRow {
    const usable = coupon.status === "claimed" && Date.parse(coupon.effectiveTo) > Date.now();
    const labels: Record<string, string> = { claimed: usable ? "可用" : "已过期", locked: "使用中", redeemed: "已使用", expired: "已过期", void: "已作废" };
    return {
      id: coupon.id,
      name: coupon.templateName,
      value: coupon.discountType === "percentage" ? `${coupon.discountValue}% 折扣` : `减 ${formatMoney(coupon.discountValue)}`.replace("（币种待确认）", ""),
      threshold: coupon.minimumSpend > 0 ? `满 ${coupon.minimumSpend} 可用` : "无门槛",
      period: `${coupon.effectiveFrom.slice(0, 10)} 至 ${coupon.effectiveTo.slice(0, 10)}`,
      status: coupon.status,
      statusLabel: labels[coupon.status] ?? coupon.status,
      usable
    };
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.coupons })) return;
    void this.load();
  }
});
