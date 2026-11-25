/**
 * 「品类与业务规则」区域各下拉框的中文选项标签。
 *
 * 页面里多处 Select 曾直接把英文枚举当作 label 渲染（`label: value`），租户看到的是
 * `offline_terms`、`fixed_amount`、`app_push` 这种代码。这里集中维护枚举 → 中文的映射，
 * 各页签统一引用，避免同一枚举在不同页签各翻译一遍或漏翻。
 *
 * 约定：租户能看到的 Select 一律显示中文；未知代码兜底显示原始代码，并在渲染处包成
 * 明显是「代码」的样式（见 NotificationsTab 的事件下拉）。
 */

/** 晚取消收费方式 / 爽约费用类型：两个字段共用同一组取值（none/fixed_amount/percentage）。 */
export const lateFeeTypeLabels: Record<string, string> = {
  none: "不收取",
  fixed_amount: "固定金额",
  percentage: "应付金额百分比",
};

/** 逾期收费方式。详细语义在字段 tooltip 里说明，这里给短标签便于下拉浏览。 */
export const overdueFeeModeLabels: Record<string, string> = {
  none: "不收取",
  hourly: "按小时",
  next_period: "按下一计费周期",
  multiplier: "租金倍数",
  manual_review: "人工核定",
  hourly_to_daily: "按小时折日",
};

/** 支付时点。 */
export const paymentTimingLabels: Record<string, string> = {
  order: "下单时",
  confirmation: "确认时",
  pickup: "领取时",
  offline_terms: "线下账期",
};

/** 会员奖励类型（注册赠礼 / 邀请奖励）。 */
export const rewardTypeLabels: Record<string, string> = {
  points: "积分",
  balance: "营销余额",
  coupon: "优惠券",
};

/** 营业日历日期类型（与服务端枚举一致：workday/weekend/statutory_holiday/makeup_workday/tenant_special）。 */
export const calendarDayTypeLabels: Record<string, string> = {
  workday: "工作日",
  weekend: "周末",
  statutory_holiday: "法定节假日",
  makeup_workday: "调休工作日",
  tenant_special: "本空间特殊日",
};

/** 通知渠道（与租户设置 editableChannels 的取值一致）。 */
export const notificationChannelLabels: Record<string, string> = {
  sms: "短信",
  app_push: "应用推送",
  wechat: "微信",
  email: "邮件",
};

/**
 * 已知通知事件编码 → 中文。取值取自服务端默认启用事件（rental-core.service.ts 的
 * enabledEvents 种子）。未知编码不在表里，由渲染处兜底显示原始代码。
 */
export const notificationEventLabels: Record<string, string> = {
  "member.registered": "会员注册",
  "order.created": "订单创建",
  "order.confirmed": "订单确认",
  "order.cancelled": "订单取消",
  "order.pickup_overdue": "超时未取",
  "order.no_show": "爽约",
  "order.overdue": "订单逾期",
  "pickup.completed": "已领取",
  "return.completed": "已归还",
  "pickup.reminder": "领取提醒",
  "return.reminder": "归还提醒",
};
