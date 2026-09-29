import {
  FeatureEntitlementSource, FeatureReleaseStatus, SubscriptionPlan, SubscriptionRequestStatus, SubscriptionRequestType, SubscriptionSource,
  type SubscriptionFeatureEntitlement, type SubscriptionRequestRecord, type TenantSubscriptionOverview
} from "@rental-os/shared";

/** Local wall-clock input is always interpreted in the subscription's service zone, never the browser's. */
export function serviceLocalTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(iso));
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  const fraction = new Date(iso).getUTCMilliseconds();
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${fraction ? `.${String(fraction).padStart(3, "0")}` : ""}`;
}

export function serviceTimeToIso(local: string, timeZone: string): string {
  if (!timeZone) throw new Error("请明确服务时区");
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(withSeconds)) throw new Error("请填写完整日期和时间");
  const wall = Date.parse(`${withSeconds}Z`);
  const normalized = Number.isFinite(wall) ? serviceLocalTime(new Date(wall).toISOString(), "UTC") : "";
  const padded = withSeconds.includes(".") ? withSeconds.replace(/\.(\d{1,3})$/, (_, digits: string) => `.${digits.padEnd(3, "0")}`) : `${withSeconds}.000`;
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, -1) !== padded) throw new Error("日期或时间无效");
  // Sample both sides of a DST transition and require an exact local-time round trip.
  const candidates = new Set<number>();
  for (const days of [-2, -1, 0, 1, 2]) {
    const probe = wall + days * 86400000;
    const offset = Date.parse(`${serviceLocalTime(new Date(probe).toISOString(), timeZone)}Z`) - probe;
    const candidate = wall - offset;
    if (serviceLocalTime(new Date(candidate).toISOString(), timeZone) === normalized) candidates.add(candidate);
  }
  if (!candidates.size) throw new Error("该服务时区不存在此时刻（夏令时跳转），请选择其他时间");
  // Repeated wall-clock times select the earlier occurrence, matching the server's service-zone policy.
  return new Date(Math.min(...candidates)).toISOString();
}

/** Preview only; the server remains authoritative. Preserve the original leap-day anchor on contiguous renewals. */
export function calendarAnniversary(startAt: string, years: number, timeZone: string, anchorAt?: string): string {
  if (!Number.isInteger(years) || years < 1) throw new Error("服务年数须为正整数");
  const start = serviceLocalTime(startAt, timeZone);
  const anchor = serviceLocalTime(anchorAt ?? startAt, timeZone);
  const targetYear = Number(start.slice(0, 4)) + years;
  const month = Number(anchor.slice(5, 7));
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const day = Math.min(Number(anchor.slice(8, 10)), lastDay);
  return serviceTimeToIso(`${targetYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}${anchor.slice(10)}`, timeZone);
}

export type SubscriptionOperation = "activate" | "upgrade" | "renew" | "extend" | "next_standard";
export type SubscriptionEditSnapshot = TenantSubscriptionOverview & { anniversaryAnchor?: string };
export interface SubscriptionActionValues {
  operationType: SubscriptionOperation;
  plan: SubscriptionPlan;
  source: SubscriptionSource;
  timeZone: string;
  startAt?: string;
  serviceYears?: number | null;
  endAt?: string;
  termMode: "years" | "custom";
  amount?: number | null;
  currency?: string;
  taxInclusive?: boolean;
  priceVersion?: string;
  note?: string;
  reason?: string;
}

export function operationForRequest(request: SubscriptionRequestRecord, overview?: SubscriptionEditSnapshot): SubscriptionOperation | null {
  if (request.status !== SubscriptionRequestStatus.Pending) throw new Error("申请已关闭，请刷新记录");
  const needsProvision = overview && (!overview.startAt || !overview.endAt);
  switch (request.type) {
    case SubscriptionRequestType.UpgradePro: return needsProvision || (overview && !["active", "expiring"].includes(overview.serviceStatus)) ? "activate" : "upgrade";
    case SubscriptionRequestType.RenewPro:
    case SubscriptionRequestType.RenewStandard: return needsProvision ? "activate" : "renew";
    case SubscriptionRequestType.NextStandard: return "next_standard";
    case SubscriptionRequestType.UpgradeConsult:
    case SubscriptionRequestType.NoRenew: return null;
  }
}

export function canCancelRequest(request: SubscriptionRequestRecord | undefined, canManage: boolean): boolean {
  return canManage && request?.status === SubscriptionRequestStatus.Pending;
}

export function requestHandlingPayload(request: SubscriptionRequestRecord, status: SubscriptionRequestStatus, expectedRevision: number, publicReason: string) {
  if (request.status !== SubscriptionRequestStatus.Pending) throw new Error("申请已关闭，请刷新记录");
  if (status !== SubscriptionRequestStatus.Rejected && status !== SubscriptionRequestStatus.Processed) throw new Error("无效的处理状态");
  if (status === SubscriptionRequestStatus.Processed && operationForRequest(request)) throw new Error("此申请须通过实际授权操作办理，不能仅标记已办理");
  if (!publicReason.trim()) throw new Error("请填写可向租户公开的处理原因");
  return { status, expectedRevision, publicReason: publicReason.trim() };
}

export function initialSubscriptionAction(overview: SubscriptionEditSnapshot, operationType: SubscriptionOperation = "activate", now = Date.now(), request?: SubscriptionRequestRecord): SubscriptionActionValues {
  const timeZone = overview.timeZone ?? "";
  const isContiguous = operationType === "next_standard" || operationType === "renew" && Boolean(overview.endAt && Date.parse(overview.endAt) > now);
  const startAt = isContiguous && overview.endAt && timeZone ? serviceLocalTime(overview.endAt, timeZone) : undefined;
  return {
    operationType, plan: request?.targetPlan ?? (operationType === "renew" ? overview.plan : SubscriptionPlan.Standard),
    source: SubscriptionSource.Sale, timeZone, startAt, termMode: "years", serviceYears: 1
  };
}

export function subscriptionTermPreview(values: SubscriptionActionValues, snapshot: SubscriptionEditSnapshot): { startAt?: string; endAt?: string } {
  if (values.operationType === "upgrade") return { startAt: snapshot.startAt, endAt: snapshot.endAt };
  if (values.operationType === "extend") return { startAt: snapshot.startAt, endAt: serviceTimeToIso(values.endAt ?? "", values.timeZone) };
  if (!values.startAt) throw new Error("请确认本次服务开始时点；过期续费不自动追补过去期间");
  const unchangedBoundary = (values.operationType === "renew" || values.operationType === "next_standard") && snapshot.endAt && values.timeZone === snapshot.timeZone && values.startAt === serviceLocalTime(snapshot.endAt, values.timeZone);
  const startAt = unchangedBoundary ? snapshot.endAt! : serviceTimeToIso(values.startAt, values.timeZone);
  const hasYears = values.serviceYears !== undefined && values.serviceYears !== null;
  if (hasYears && (!Number.isInteger(values.serviceYears) || values.serviceYears! < 1 || values.serviceYears! > 100)) throw new Error("服务年数须为 1–100 的整数");
  if (hasYears === Boolean(values.endAt)) throw new Error("服务年数与自定义截止时间必须二选一");
  const contiguous = (values.operationType === "renew" || values.operationType === "next_standard") && snapshot.endAt && Date.parse(startAt) === Date.parse(snapshot.endAt);
  const originalAnchor = contiguous ? snapshot.anniversaryAnchor : undefined;
  const yearsCovered = originalAnchor ? Number(serviceLocalTime(startAt, values.timeZone).slice(0, 4)) - Number(serviceLocalTime(originalAnchor, values.timeZone).slice(0, 4)) : 0;
  let alignedAnchor: string | undefined;
  if (hasYears && originalAnchor && yearsCovered > 0) {
    try { if (Date.parse(calendarAnniversary(originalAnchor, yearsCovered, values.timeZone)) === Date.parse(startAt)) alignedAnchor = originalAnchor; }
    catch { /* A DST gap means the explicitly agreed cutoff is not anniversary-aligned. */ }
  }
  const endAt = hasYears
    ? calendarAnniversary(startAt, values.serviceYears!, values.timeZone, alignedAnchor)
    : serviceTimeToIso(values.endAt!, values.timeZone);
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("截止时点必须晚于开始时点");
  return { startAt, endAt };
}

/** Called with the snapshot captured at form opening, never the latest refetched revision. */
export function buildSubscriptionAction(values: SubscriptionActionValues, snapshot: SubscriptionEditSnapshot, request?: SubscriptionRequestRecord) {
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error("授权修订号缺失，请刷新后重试");
  const expectedRevision = snapshot.revision;
  const reason = values.reason?.trim();
  if (!reason) throw new Error("请填写租户可见的办理依据或调整原因");
  if (request) {
    if (operationForRequest(request, snapshot) !== values.operationType) throw new Error("办理类型与申请不一致");
    const targetPlan = request.type === SubscriptionRequestType.RenewPro ? SubscriptionPlan.Pro : request.type === SubscriptionRequestType.RenewStandard ? SubscriptionPlan.Standard : request.targetPlan;
    if (values.operationType === "renew" && targetPlan !== values.plan) throw new Error("续购套餐与申请目标不一致");
  }
  const term = subscriptionTermPreview(values, snapshot);
  if (values.operationType === "extend") {
    if (!snapshot.endAt || Date.parse(term.endAt!) <= Date.parse(snapshot.endAt)) throw new Error("新截止必须晚于当前截止");
    return { operation: "extend" as const, payload: { endAt: term.endAt!, reason, expectedRevision } };
  }
  if (values.source === SubscriptionSource.TempExtension) throw new Error("临时延长请使用专用办理类型，不得记录收款");
  const hasAmount = values.amount !== undefined && values.amount !== null;
  if ((values.source === SubscriptionSource.Sale || hasAmount) && (!hasAmount || !Number.isFinite(values.amount) || values.amount! <= 0)) throw new Error("收费办理须填写大于 0 的实际金额");
  if (hasAmount && !/^[A-Z]{3}$/.test(values.currency?.trim().toUpperCase() ?? "")) throw new Error("请填写三位币种代码");
  if (hasAmount && (!Number.isFinite(values.amount) || values.amount! > 9999999999.99 || Math.abs(values.amount! * 100 - Math.round(values.amount! * 100)) > 0.0001)) throw new Error("金额最多两位小数且不得超出允许范围");
  if (values.source === SubscriptionSource.Sale && !values.priceVersion) throw new Error("收费办理必须核对已发布的价格版本");
  if (hasAmount && typeof values.taxInclusive !== "boolean") throw new Error("请明确含税 / 未税口径");
  const money = hasAmount ? { amount: values.amount!, currency: values.currency!.trim().toUpperCase(), taxInclusive: values.taxInclusive } : {};
  const common = { source: values.source, ...money, reason, note: values.note?.trim() || undefined, expectedRevision, ...(request ? { requestId: request.id } : {}), ...(values.priceVersion ? { priceVersion: values.priceVersion } : {}) };
  if (values.operationType === "upgrade") return { operation: "upgrade" as const, payload: common };
  const length = values.serviceYears != null ? { serviceYears: values.serviceYears } : { endAt: term.endAt! };
  switch (values.operationType) {
    case "activate": return { operation: "activate" as const, payload: { ...common, plan: values.plan, startAt: term.startAt!, ...length, timeZone: values.timeZone } };
    case "renew": return { operation: "renew" as const, payload: { ...common, plan: values.plan, startAt: term.startAt!, ...length } };
    case "next_standard": return { operation: "next_standard" as const, payload: { ...common, plan: SubscriptionPlan.Standard, effectiveAt: term.startAt!, ...length } };
  }
}

export function groupSubscriptionFeatures(features: SubscriptionFeatureEntitlement[]) {
  return {
    included: features.filter((f) => f.releaseStatus === FeatureReleaseStatus.Released && f.source !== FeatureEntitlementSource.NeedsUpgrade),
    additional: features.filter((f) => f.releaseStatus === FeatureReleaseStatus.Released && f.source === FeatureEntitlementSource.NeedsUpgrade),
    pilot: features.filter((f) => f.releaseStatus === FeatureReleaseStatus.Pilot),
    planned: features.filter((f) => f.releaseStatus === FeatureReleaseStatus.Planned),
    unavailable: features.filter((f) => f.releaseStatus === FeatureReleaseStatus.Paused || f.releaseStatus === FeatureReleaseStatus.Retired)
  };
}

export function subscriptionError(error: unknown, fallback = "保存失败，请稍后重试"): string {
  const value = error as { response?: { data?: { message?: string | string[]; error?: { message?: string } } }; message?: string };
  const detail = value?.response?.data?.message ?? value?.response?.data?.error?.message ?? value?.message;
  return Array.isArray(detail) ? detail.join("；") : typeof detail === "string" && detail ? detail : fallback;
}
