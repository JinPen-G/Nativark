import { themeBehavior } from "../../core/theme-behavior";
import type { CustomerMembershipQualificationType, CustomerQualificationRevision } from "@rental-os/shared";
import { completeQualificationUpload, createQualificationUpload, fetchQualificationTypes, fetchQualifications, qualificationFileUrl, submitQualification } from "../../api/profile";
import { describeError } from "../../core/errors";
import { newKey } from "../../core/keys";
import { qualificationLabel, reviewLabel } from "../../core/labels";
import { membershipStatus, currentServiceCode } from "../../core/session";
import { cachedMerchant } from "../../core/merchant";
import { type FieldErrors, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { formatBusinessDate, zonedToInstant } from "../../core/time";
import { ROUTES, callPhone, requireSignIn, toast } from "../../core/ui";
import { ensureCurrentZone, zoneOf } from "../../core/zones";

/**
 * P15 我的资质（需求 §11.2）。
 * 列表：当前服务要求的证件类型 × 本人已提交记录（租户共享，跨服务复用）。
 * 提交：证件类型（服务端声明）→ 号码/日期 → 选择图片（用户触发，JPEG/PNG，≤10MB）→
 *       上传会话 → 对象上传 → 完成确认 → 取得文件引用 → 提交审核。任一步失败可重试，进度 100% 不等于审核通过。
 * 服务端当前对提交/上传要求会员 active（待审核会员补件属 MP-12 待调整），失败时如实提示。
 */
interface TypeRow {
  code: string;
  name: string;
  required: boolean;
  latest?: {
    status: string;
    statusLabel: string;
    tone: string;
    reviewLabel: string;
    reason: string;
    expiresText: string;
    submittedText: string;
    evidenceRef: string;
  };
}

interface QualificationData {
  view: ViewState;
  rows: TypeRow[];
  history: Array<{ id: string; typeName: string; statusLabel: string; tone: string; submittedText: string; reason: string }>;
  showForm: boolean;
  formType: string;
  formTypeName: string;
  referenceNo: string;
  issuedAt: string;
  expiresAt: string;
  longTerm: boolean;
  imagePath: string;
  imageSize: number;
  imageMime: string;
  uploadStage: "idle" | "uploading" | "uploaded" | "failed";
  uploadedRef: string;
  submitting: boolean;
  errors: FieldErrors;
  formError: string;
  membershipNote: string;
  servicePhone: string;
  zoneNote: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    rows: [],
    history: [],
    showForm: false,
    formType: "",
    formTypeName: "",
    referenceNo: "",
    issuedAt: "",
    expiresAt: "",
    longTerm: false,
    imagePath: "",
    imageSize: 0,
    imageMime: "",
    uploadStage: "idle",
    uploadedRef: "",
    submitting: false,
    errors: {},
    formError: "",
    membershipNote: "",
    servicePhone: "",
    zoneNote: ""
  } as QualificationData,

  uploadKey: "" as string,
  types: [] as CustomerMembershipQualificationType[],

  onLoad() {
    this.setData({ servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(ROUTES.qualifications)) return;
  },

  onShow() {
    void this.load();
  },

  async load() {
    const status = membershipStatus();
    this.setData({ membershipNote: status && status !== "active" ? "会员资料尚在审核或受限：当前系统要求会员正常后才能提交资质，若需补件请联系商户。" : "" });
    try {
      const [types, revisions] = await Promise.all([fetchQualificationTypes(), fetchQualifications(), ensureCurrentZone()]);
      this.types = types.filter((row) => row.status === "enabled");
      this.render(revisions);
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  /** 证件日期按营业时区解释与显示；未取得营业时区时退回 Asia/Shanghai 并在页面标注。 */
  zone(): string {
    return zoneOf(currentServiceCode()) ?? "Asia/Shanghai";
  },

  render(revisions: CustomerQualificationRevision[]) {
    const zone = this.zone();
    const latestByType = new Map<string, CustomerQualificationRevision>();
    for (const revision of revisions) {
      if (!latestByType.has(revision.qualificationType)) latestByType.set(revision.qualificationType, revision);
    }
    const tone = (status: string) => (status === "approved" ? "success" : status === "pending" ? "warning" : status === "not_submitted" ? "neutral" : "danger");
    const rows: TypeRow[] = this.types.map((type) => {
      const latest = latestByType.get(type.code);
      return {
        code: type.code,
        name: type.name,
        required: type.requiredForBooking,
        latest: latest
          ? {
              status: latest.qualificationStatus,
              statusLabel: qualificationLabel(latest.qualificationStatus),
              tone: tone(latest.qualificationStatus),
              reviewLabel: reviewLabel(latest.reviewStatus),
              reason: latest.reviewReason ?? "",
              expiresText: latest.expiresAt ? `有效期至 ${formatBusinessDate(latest.expiresAt, zone)}` : "长期有效",
              submittedText: formatBusinessDate(latest.submittedAt, zone),
              evidenceRef: latest.evidenceRef ?? ""
            }
          : undefined
      };
    });
    const typeNames = new Map(this.types.map((row) => [row.code, row.name]));
    const history = revisions.slice(0, 20).map((revision) => ({
      id: revision.id,
      typeName: typeNames.get(revision.qualificationType) ?? revision.qualificationType,
      statusLabel: `${qualificationLabel(revision.qualificationStatus)} · ${reviewLabel(revision.reviewStatus)}`,
      tone: tone(revision.qualificationStatus),
      submittedText: formatBusinessDate(revision.submittedAt, zone),
      reason: revision.reviewReason ?? ""
    }));
    this.setData({ view: readyState(), rows, history, zoneNote: zoneOf(currentServiceCode()) ? "" : "营业时区暂未获取，日期按 Asia/Shanghai 显示" });
  },

  onOpenForm(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    const type = this.types.find((row) => row.code === code);
    if (!type) return;
    this.uploadKey = "";
    this.setData({ showForm: true, formType: type.code, formTypeName: type.name, referenceNo: "", issuedAt: "", expiresAt: "", longTerm: false, imagePath: "", imageSize: 0, imageMime: "", uploadStage: "idle", uploadedRef: "", errors: {}, formError: "" });
  },

  onCloseForm() {
    if (this.data.submitting || this.data.uploadStage === "uploading") return;
    this.setData({ showForm: false });
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: String(event.detail.value ?? ""), [`errors.${field}`]: "", formError: "" });
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: String(event.detail.value ?? ""), [`errors.${field}`]: "" });
  },

  onClearDate(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: "" });
  },

  onLongTermChange(event: WechatMiniprogram.SwitchChange) {
    this.setData({ longTerm: Boolean(event.detail.value), expiresAt: event.detail.value ? "" : this.data.expiresAt });
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file) return;
        const path = file.tempFilePath;
        const mime = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
        if (file.size > MAX_IMAGE_BYTES) {
          this.setData({ formError: "图片超过 10MB，请压缩后重试" });
          return;
        }
        this.uploadKey = newKey("qualification-upload");
        this.setData({ imagePath: path, imageSize: file.size, imageMime: mime, uploadStage: "idle", uploadedRef: "", formError: "" });
      },
      fail: () => {
        // 用户取消选择：不提示。
      }
    });
  },

  /** 上传会话 → PUT 对象 → 完成确认。开发环境（simulation 模式）没有上传地址，直接完成确认。 */
  async upload(): Promise<string> {
    const { imagePath, imageSize, imageMime, formType } = this.data;
    this.setData({ uploadStage: "uploading" });
    const session = await createQualificationUpload({ qualificationType: formType, fileName: `qualification-${Date.now()}.${imageMime === "image/png" ? "png" : "jpg"}`, mimeType: imageMime, sizeBytes: imageSize, idempotencyKey: this.uploadKey });
    if (session.status === "completed") {
      this.setData({ uploadStage: "uploaded", uploadedRef: session.fileAssetId });
      return session.fileAssetId;
    }
    if (session.mode === "provider" && session.uploadUrl) {
      await new Promise<void>((resolve, reject) => {
        const manager = wx.getFileSystemManager();
        manager.readFile({
          filePath: imagePath,
          success: (read) => {
            wx.request({
              url: session.uploadUrl!,
              method: "PUT",
              header: session.uploadHeaders ?? { "Content-Type": imageMime },
              data: read.data as ArrayBuffer,
              success: (res) => (res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`对象存储返回 HTTP ${res.statusCode}`))),
              fail: () => reject(new Error("上传到对象存储失败，请重试"))
            });
          },
          fail: () => reject(new Error("读取图片失败"))
        });
      });
    }
    const completed = await completeQualificationUpload(session.sessionId);
    const ref = completed.id ?? completed.fileAssetId ?? session.fileAssetId;
    this.setData({ uploadStage: "uploaded", uploadedRef: ref });
    return ref;
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const errors: FieldErrors = {};
    if (this.data.issuedAt && this.data.expiresAt && this.data.expiresAt < this.data.issuedAt) errors.expiresAt = "有效期不能早于签发日期";
    if (!this.data.imagePath && !this.data.uploadedRef) errors.image = "请上传证件图片";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    this.setData({ submitting: true, formError: "" });
    try {
      const evidenceRef = this.data.uploadedRef || (await this.upload());
      const zone = this.zone();
      await submitQualification({
        qualificationType: this.data.formType,
        referenceNo: this.data.referenceNo.trim() || undefined,
        // 签发日取当天 00:00、有效期取当天 23:59，都按营业时区解释，不用 UTC 造成跨日偏移。
        issuedAt: this.data.issuedAt ? zonedToInstant(this.data.issuedAt, "00:00", zone) : undefined,
        expiresAt: !this.data.longTerm && this.data.expiresAt ? zonedToInstant(this.data.expiresAt, "23:59", zone) : undefined,
        evidenceRef
      });
      this.setData({ showForm: false });
      toast("已提交，等待商户审核", { duration: 3000 });
      await this.load();
    } catch (error) {
      if (this.data.uploadStage === "uploading") this.setData({ uploadStage: "failed" });
      this.setData({ formError: `${describeError(error).message}${this.data.uploadStage === "failed" ? "（图片上传失败，可重试）" : ""}` });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onPreviewEvidence(event: WechatMiniprogram.TouchEvent) {
    const ref = String(event.currentTarget.dataset.ref ?? "");
    if (!ref) return;
    try {
      const url = await qualificationFileUrl(ref);
      if (/^https?:\/\//.test(url.downloadUrl)) wx.previewImage({ urls: [url.downloadUrl] });
      else toast("开发环境的附件地址不可预览", { duration: 2500 });
    } catch (error) {
      toast(describeError(error).message);
    }
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.qualifications, servicePhone: this.data.servicePhone })) return;
    void this.load();
  }
});
