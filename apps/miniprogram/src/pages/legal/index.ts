import { cachedMerchant, loadMerchant, type MerchantInfo } from "../../core/merchant";
import { ROUTES, back, callPhone } from "../../core/ui";

/**
 * P18 协议 / 租赁规则 / 帮助与客服。协议名称与版本来自商户渠道配置；商户未提供正文时如实说明，
 * 不内置占位协议冒充商户文件。
 */
type DocKind = "agreement" | "privacy" | "rental-rules" | "help";

interface LegalData {
  kind: DocKind;
  title: string;
  docName: string;
  version: string;
  provided: boolean;
  url: string;
  servicePhone: string;
  serviceHours: string;
  ruleVersion: string;
}

const TITLES: Record<DocKind, string> = { agreement: "用户服务协议", privacy: "隐私政策", "rental-rules": "租赁规则", help: "帮助与客服" };

const FAQ = [
  { q: "如何预约设备？", a: "在设备详情点“立即预约”，选择租赁时间与自提门店，确认商户报价后提交；付款到账后商户开始备货。" },
  { q: "押金怎么办理？", a: "本期押金在领取前与商户线下办理，归还并确认无损后原路退还；押金不计入小程序内的租赁款付款。" },
  { q: "可以取消或续租吗？", a: "在订单详情中，允许时会显示“取消订单”和“申请续租”；取消前会先显示取消费预估，续租先预览差额再提交。" },
  { q: "付款后订单没有变化？", a: "付款结果以商户系统入账为准，可在付款页点“刷新结果”；如仍未更新请联系商户，不要重复付款。" }
];

Page({
  data: { kind: "agreement", title: "", docName: "", version: "", provided: false, url: "", servicePhone: "", serviceHours: "", ruleVersion: "", faq: FAQ } as LegalData & { faq: typeof FAQ },

  onLoad(options: Record<string, string | undefined>) {
    const kind = (["agreement", "privacy", "rental-rules", "help"].includes(options.doc ?? "") ? options.doc : "agreement") as DocKind;
    this.setData({ kind, title: TITLES[kind], ruleVersion: options.version ?? "" });
    const cached = cachedMerchant();
    if (cached) this.apply(cached);
    loadMerchant(false).then((info) => this.apply(info)).catch(() => undefined);
  },

  apply(info: MerchantInfo) {
    const doc = this.data.kind === "agreement" ? info.agreements?.userAgreement : this.data.kind === "privacy" ? info.agreements?.privacyPolicy : undefined;
    this.setData({
      docName: doc?.name ?? TITLES[this.data.kind],
      version: doc?.version ?? "",
      provided: Boolean(doc),
      url: doc?.url ?? "",
      servicePhone: info.servicePhone ?? "",
      serviceHours: info.serviceHours ?? ""
    });
  },

  onCopyUrl() {
    // 协议链接是公开文档地址，不含私有信息；不复制任何令牌。
    if (this.data.url) wx.setClipboardData({ data: this.data.url });
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  onBack() {
    back(ROUTES.me);
  }
});
