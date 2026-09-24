import type { CustomerMembershipReview, ReviewCustomerMembershipRequest } from "@rental-os/shared";
import { decideMembershipReview, listMembershipReviews } from "../../api/reviews";
import { staffUploadDownloadUrl } from "../../api/uploads";
import { cachedContext, loadContext } from "../../core/context";
import { errorText } from "../../core/errors";
import type { Tone } from "../../core/labels";
import { blockedState, emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { initialOf, relativeDay } from "../../core/presenters";
import { canTenant, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime } from "../../core/time";
import { ROUTES, confirmDialog, promptDialog, relaunch, toast } from "../../core/ui";

/**
 * S14 审核待办：会员注册审核 + 证件审核。两者都是**租户级**动作（跨经营空间），入口用 canTenant()
 * 判定（需对应权限 + 租户级 dataScope=all）；注册类只对 member:review 者可决策，证件类只对
 * member:qualification-review 者可决策，按钮显隐分别判断，服务端仍独立校验。
 * 本页只展示审核所需最小资料，不提供客户主档编辑、账号管理或完整证件号揭示。
 */

const DEFAULT_ZONE = "Asia/Shanghai";

type TabKey = "pending" | "registration" | "qualification" | "all";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "pending", label: "待处理" },
  { key: "registration", label: "注册审核" },
  { key: "qualification", label: "证件审核" },
  { key: "all", label: "全部" }
];

/** 服务端拉取参数：待处理按状态过滤，注册/证件按 type 过滤，全部不加过滤。 */
function tabQuery(tab: TabKey): { status?: string; type?: "registration" | "qualification" } {
  switch (tab) {
    case "pending":
      return { status: "pending" };
    case "registration":
      return { type: "registration" };
    case "qualification":
      return { type: "qualification" };
    default:
      return {};
  }
}

const EMPTY_TITLE: Record<TabKey, string> = {
  pending: "没有待处理的审核",
  registration: "暂无注册审核记录",
  qualification: "暂无证件审核记录",
  all: "暂无审核记录"
};
const EMPTY_HINT: Record<TabKey, string> = {
  pending: "新的会员注册或证件提交会显示在这里",
  registration: "",
  qualification: "",
  all: ""
};

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "待处理", tone: "warning" },
  approved: { label: "已通过", tone: "success" },
  rejected: { label: "已驳回", tone: "danger" },
  supplement_required: { label: "需补件", tone: "info" },
  cancelled: { label: "已取消", tone: "neutral" }
};
function statusMeta(status: string): { label: string; tone: Tone } {
  return STATUS_META[status] ?? { label: status, tone: "neutral" };
}

/** 列表短标签（注册/证件）。 */
const TYPE_LABEL: Record<string, string> = { registration: "注册", qualification: "证件" };
/** 详情面板标题。 */
const TYPE_TITLE: Record<string, string> = { registration: "会员注册审核", qualification: "证件资质审核" };
/** 详情内“审核类型”取值。 */
const TYPE_NAME: Record<string, string> = { registration: "会员注册", qualification: "证件资质" };
/** 提交渠道文案。 */
const CHANNEL_LABEL: Record<string, string> = { admin: "后台录入", app: "会员端", web: "官网", "staff-miniprogram": "员工端" };

function dateOnly(iso?: string): string {
  return iso ? iso.slice(0, 10) : "";
}

interface ReviewRow {
  id: string;
  name: string;
  initial: string;
  typeLabel: string;
  isQualification: boolean;
  qualificationType: string;
  timeText: string;
  statusLabel: string;
  statusTone: Tone;
}

interface DetailVM {
  id: string;
  name: string;
  initial: string;
  typeTitle: string;
  typeName: string;
  isQualification: boolean;
  qualificationType: string;
  channelLabel: string;
  timeText: string;
  statusLabel: string;
  statusTone: Tone;
  reason: string;
  reviewedBy: string;
  reviewedAt: string;
  hasSnapshot: boolean;
  referenceNoMasked: string;
  issuedAt: string;
  expiresAt: string;
  hasEvidence: boolean;
  attachmentUrl: string;
  attachmentNote: string;
  canDecide: boolean;
  viewOnly: boolean;
}

interface ReviewsData {
  view: ViewState;
  tabs: typeof TABS;
  tab: TabKey;
  canRegistration: boolean;
  canQualification: boolean;
  rows: ReviewRow[];
  sheetVisible: boolean;
  attachmentLoading: boolean;
  detail?: DetailVM;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    tabs: TABS,
    tab: "pending",
    canRegistration: false,
    canQualification: false,
    rows: [],
    sheetVisible: false,
    attachmentLoading: false
  } as ReviewsData,

  records: [] as CustomerMembershipReview[],
  timeZone: DEFAULT_ZONE,
  requestVersion: 0,
  attachmentToken: 0,

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    const canRegistration = canTenant("rental-os:member:review");
    const canQualification = canTenant("rental-os:member:qualification-review");
    if (!canRegistration && !canQualification) {
      this.setData({ view: blockedState("无审核权限", "会员/证件审核是租户级动作，需要租户级审核权限，请联系管理员", "联系管理员", "contact") });
      return;
    }
    this.setData({ canRegistration, canQualification });
    void this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (!this.records.length) this.setData({ view: loadingState() });
    const token = ++this.requestVersion;
    try {
      const context = cachedContext() ?? (await loadContext().catch(() => undefined));
      this.timeZone = context?.locations[0]?.timezone ?? DEFAULT_ZONE;
      const reviews = await listMembershipReviews(tabQuery(this.data.tab));
      if (token !== this.requestVersion) return;
      this.records = reviews.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const rows = this.records.map((review) => this.buildRow(review));
      this.setData({ rows, view: rows.length ? readyState() : emptyState(EMPTY_TITLE[this.data.tab], EMPTY_HINT[this.data.tab]) });
    } catch (error) {
      if (token !== this.requestVersion) return;
      this.setData({ view: errorState(error) });
    }
  },

  buildRow(review: CustomerMembershipReview): ReviewRow {
    const meta = statusMeta(review.status);
    return {
      id: review.id,
      name: review.customerName || "未命名会员",
      initial: initialOf(review.customerName),
      typeLabel: TYPE_LABEL[review.reviewType] ?? review.reviewType,
      isQualification: review.reviewType === "qualification",
      qualificationType: review.qualificationType ?? "",
      timeText: relativeDay(review.createdAt, this.timeZone),
      statusLabel: meta.label,
      statusTone: meta.tone
    };
  },

  canDecideReview(review: CustomerMembershipReview): boolean {
    if (review.status !== "pending") return false;
    if (review.reviewType === "registration") return this.data.canRegistration;
    if (review.reviewType === "qualification") return this.data.canQualification;
    return false;
  },

  buildDetail(review: CustomerMembershipReview): DetailVM {
    const meta = statusMeta(review.status);
    const snap = review.qualificationSnapshot;
    const canDecide = this.canDecideReview(review);
    return {
      id: review.id,
      name: review.customerName || "未命名会员",
      initial: initialOf(review.customerName),
      typeTitle: TYPE_TITLE[review.reviewType] ?? "会员审核",
      typeName: TYPE_NAME[review.reviewType] ?? review.reviewType,
      isQualification: review.reviewType === "qualification",
      qualificationType: review.qualificationType ?? snap?.qualificationType ?? "",
      channelLabel: CHANNEL_LABEL[review.channel] ?? review.channel ?? "—",
      timeText: relativeDay(review.createdAt, this.timeZone),
      statusLabel: meta.label,
      statusTone: meta.tone,
      reason: review.reason ?? snap?.reviewReason ?? "",
      reviewedBy: review.reviewedBy ?? "",
      reviewedAt: review.reviewedAt ? formatBusinessDateTime(review.reviewedAt, this.timeZone) : "",
      hasSnapshot: Boolean(snap),
      referenceNoMasked: snap?.referenceNoMasked ?? "",
      issuedAt: dateOnly(snap?.issuedAt),
      expiresAt: dateOnly(snap?.expiresAt),
      hasEvidence: Boolean(snap?.evidenceRef),
      attachmentUrl: "",
      attachmentNote: "附件需在 Web 查看",
      canDecide,
      viewOnly: review.status === "pending" && !canDecide
    };
  },

  current(): CustomerMembershipReview | undefined {
    const id = this.data.detail?.id;
    return id ? this.records.find((row) => row.id === id) : undefined;
  },

  onTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.key ?? "pending") as TabKey;
    if (tab === this.data.tab) return;
    this.setData({ tab });
    void this.load();
  },

  onOpen(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const review = this.records.find((row) => row.id === id);
    if (!review) return;
    const detail = this.buildDetail(review);
    this.setData({ detail, sheetVisible: true, attachmentLoading: detail.hasEvidence });
    const evidenceRef = review.qualificationSnapshot?.evidenceRef;
    if (!detail.hasEvidence || !evidenceRef) return;
    // 模拟存储没有可直接展示的图片地址（返回空串），此时保留“附件需在 Web 查看”，不伪装成有图。
    const token = ++this.attachmentToken;
    staffUploadDownloadUrl(evidenceRef)
      .then((url) => { if (token === this.attachmentToken) this.setData({ attachmentLoading: false, "detail.attachmentUrl": url }); })
      .catch(() => { if (token === this.attachmentToken) this.setData({ attachmentLoading: false }); });
  },

  onCloseSheet() {
    this.attachmentToken += 1;
    this.setData({ sheetVisible: false });
  },

  onPreview(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url ?? "");
    if (url) wx.previewImage({ urls: [url], current: url });
  },

  async onApprove() {
    const review = this.current();
    if (!review || !this.canDecideReview(review)) return;
    const ok = await confirmDialog({ title: "通过审核", content: "确认通过该审核？通过后立即对客户生效。" });
    if (ok) await this.submit(review.id, { status: "approved" });
  },

  async onReject() {
    const review = this.current();
    if (!review || !this.canDecideReview(review)) return;
    const reason = await promptDialog({ title: "驳回审核", placeholder: "请填写驳回原因（必填）", danger: true });
    if (reason === undefined) return;
    if (!reason) { toast("请填写驳回原因"); return; }
    await this.submit(review.id, { status: "rejected", reason });
  },

  async onSupplement() {
    const review = this.current();
    if (!review || !this.canDecideReview(review)) return;
    const reason = await promptDialog({ title: "要求补件", placeholder: "请说明需要补充的材料（必填）" });
    if (reason === undefined) return;
    if (!reason) { toast("请填写补件说明"); return; }
    await this.submit(review.id, { status: "supplement_required", reason });
  },

  async submit(reviewId: string, input: ReviewCustomerMembershipRequest) {
    try {
      await decideMembershipReview(reviewId, input);
      this.attachmentToken += 1;
      this.setData({ sheetVisible: false });
      toast("已提交审核结果", { icon: "success" });
      await this.load();
    } catch (error) {
      toast(errorText(error));
    }
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.reviews })) return;
    void this.load();
  }
});
