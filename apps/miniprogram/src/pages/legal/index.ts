import { themeBehavior } from "../../core/theme-behavior";
import type { ClientHelpFaqItem, ClientPublicDocumentKind } from "@rental-os/shared";
import type { ClientRichTextNode } from "@rental-os/shared";
import { parseClientRichText } from "../../vendor/shared-rich-text/client-rich-text";
import { fetchPublicDocument } from "../../api/merchant";
import { cachedMerchant, loadMerchant, type MerchantInfo } from "../../core/merchant";
import { ROUTES, back, callPhone } from "../../core/ui";

/**
 * P18 协议 / 租赁规则 / 帮助与客服。协议名称、版本与正文来自商户在运营端配置的客户端渠道（CLIENT-CHANNEL-01）；
 * 正文经 GET /public/documents/{kind} 读取并在小程序内直接渲染，商户未提供时如实说明，不内置占位协议。
 * 帮助内容（说明 + 常见问题）同样来自后台，为空时只显示客服联系方式。
 */
type DocKind = "agreement" | "privacy" | "rental-rules" | "help";

const KIND_MAP: Record<"agreement" | "privacy" | "help", ClientPublicDocumentKind> = {
  agreement: "user_agreement",
  privacy: "privacy_policy",
  help: "help"
};

interface LegalData {
  kind: DocKind;
  title: string;
  docName: string;
  version: string;
  provided: boolean;
  body: string;
  richNodes: ClientRichTextNode[] | null;
  url: string;
  helpIntro: string;
  faq: ClientHelpFaqItem[];
  servicePhone: string;
  serviceHours: string;
  ruleVersion: string;
  loading: boolean;
}

const TITLES: Record<DocKind, string> = { agreement: "用户服务协议", privacy: "隐私政策", "rental-rules": "租赁规则", help: "帮助与客服" };

Page({
  behaviors: [themeBehavior],
  data: {
    kind: "agreement",
    title: "",
    docName: "",
    version: "",
    provided: false,
    body: "",
    richNodes: null,
    url: "",
    helpIntro: "",
    faq: [] as ClientHelpFaqItem[],
    servicePhone: "",
    serviceHours: "",
    ruleVersion: "",
    loading: false
  } as LegalData,

  onLoad(options: Record<string, string | undefined>) {
    const kind = (["agreement", "privacy", "rental-rules", "help"].includes(options.doc ?? "") ? options.doc : "agreement") as DocKind;
    this.setData({ kind, title: TITLES[kind], ruleVersion: options.version ?? "" });
    const cached = cachedMerchant();
    if (cached) this.applyMerchant(cached);
    loadMerchant(false).then((info) => this.applyMerchant(info)).catch(() => undefined);
    if (kind === "agreement" || kind === "privacy" || kind === "help") void this.loadDocument(KIND_MAP[kind]);
  },

  applyMerchant(info: MerchantInfo) {
    const doc = this.data.kind === "agreement" ? info.agreements?.userAgreement : this.data.kind === "privacy" ? info.agreements?.privacyPolicy : undefined;
    this.setData({
      docName: doc?.name ?? TITLES[this.data.kind],
      version: doc?.version ?? this.data.version,
      servicePhone: info.servicePhone ?? "",
      serviceHours: info.serviceHours ?? ""
    });
  },

  /** 从后台读取文档正文；未提供时 provided=false，页面如实提示。 */
  async loadDocument(kind: ClientPublicDocumentKind) {
    this.setData({ loading: true });
    try {
      const doc = await fetchPublicDocument(kind);
      if (!doc) {
        this.setData({ provided: false, loading: false });
        return;
      }
      if (kind === "help") {
        this.setData({ provided: true, helpIntro: doc.intro ?? "", faq: doc.faq ?? [], loading: false });
      } else {
        this.setData({ provided: true, docName: doc.name || this.data.docName, version: doc.version ?? this.data.version, body: doc.body ?? "", richNodes: parseClientRichText(doc.body ?? ""), url: doc.url ?? "", loading: false });
      }
    } catch {
      this.setData({ provided: false, loading: false });
    }
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
