import { moneyParts } from "../../core/money";

/** 金额：币种与数字一起出现；缺币种时明确标注，不默认成人民币（需求 §4.3）。tone: price/primary。 */
Component({
  options: { addGlobalClass: true },
  properties: {
    amount: { type: null, value: null },
    currency: { type: String, value: "" },
    size: { type: String, value: "normal" },
    signed: { type: Boolean, value: false },
    prefix: { type: String, value: "" },
    tone: { type: String, value: "" }
  },
  data: { symbol: "", number: "", negative: false, sign: "", unknownCurrency: false },
  lifetimes: {
    attached() {
      this.render();
    }
  },
  observers: {
    "amount, currency, signed"() {
      this.render();
    }
  },
  methods: {
    render() {
      const { amount, currency, signed } = this.data as { amount: unknown; currency: string; signed: boolean };
      const numeric = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : undefined;
      const parts = moneyParts(numeric, currency || undefined);
      const sign = parts.negative ? "-" : signed && numeric !== undefined && numeric > 0 ? "+" : "";
      this.setData({ symbol: parts.symbol, number: parts.number, negative: parts.negative, sign, unknownCurrency: numeric !== undefined && !currency });
    }
  }
});
