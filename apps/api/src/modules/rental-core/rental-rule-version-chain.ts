import { BadRequestException, ConflictException } from "@nestjs/common";
import type { RentalRuleVersionStatus } from "@store-rental/shared";

/**
 * RULE-01A：规则版本链的时点匹配、展示状态与冲突判定（需求 4.6.1、4.6.14）。
 *
 * 抽成纯函数的理由：「这张报价凭什么套用这个版本的条款」必须能逐条回放，而匹配一旦
 * 出错，错的是已经对客户生效的规则，不是一个可以下次修好的展示问题。
 *
 * 关键取舍：匹配只看 effectiveFrom 与「发布过且未作废」，不看 pending/published/
 * superseded 这三个标签。标签会随时间自然过期——待生效版本到点就该显示已生效，
 * 已生效版本被更新版本盖过就该显示已被替代。若把定价挂在库里存的标签上，就必须有
 * 定时任务去翻状态，任务漏跑一次即报价错版；因此标签在此处按 now 现算。
 */

/** 发布过且未作废的版本参与匹配。已被替代仍要参与：上月开始的租期必须匹配当时的版本。 */
export const RULE_VERSION_ISSUED_STATUSES: readonly RentalRuleVersionStatus[] = [
  "pending",
  "published",
  "superseded"
];

export const isIssuedRuleVersion = (status: RentalRuleVersionStatus) =>
  RULE_VERSION_ISSUED_STATUSES.includes(status);

/** 匹配所需的最小事实。取子集是为了让测试不必构造整份规则配置。 */
export interface RuleVersionTimelineEntry {
  id: string;
  version: string;
  status: RentalRuleVersionStatus;
  effectiveFrom?: string;
}

const timeOf = (value: string) => new Date(value).getTime();

/** 参与匹配的版本：发布过、未作废、且有生效时点。 */
const issuedWithEffectiveFrom = <T extends RuleVersionTimelineEntry>(versions: readonly T[]) =>
  versions.filter((row) => isIssuedRuleVersion(row.status) && !!row.effectiveFrom);

/**
 * 按租期开始时间匹配唯一版本（需求 4.6.1）。
 *
 * 没有覆盖该时点的版本时**抛错而不回落**：回落到「最近一条 published」会让报价悄悄
 * 用上一份条款，客户签的与系统算的不是同一套规则，事后无从分辨。
 * 同一时点存在两条版本时同样抛错——那是发布环节漏掉的冲突，不能在报价时随机挑一条。
 */
export function matchRuleVersionAt<T extends RuleVersionTimelineEntry>(
  versions: readonly T[],
  rentalStartAt: string
): T {
  const at = timeOf(rentalStartAt);
  if (Number.isNaN(at)) throw new BadRequestException("租期开始时间不是有效时间");
  const covering = issuedWithEffectiveFrom(versions).filter((row) => timeOf(row.effectiveFrom!) <= at);
  if (covering.length === 0) {
    throw new ConflictException(
      `该租期开始时（${new Date(at).toISOString()}）没有生效的租赁规则版本，` +
        `请先发布覆盖该时点的规则版本后再报价`
    );
  }
  const latest = Math.max(...covering.map((row) => timeOf(row.effectiveFrom!)));
  const winners = covering.filter((row) => timeOf(row.effectiveFrom!) === latest);
  if (winners.length > 1) {
    throw new ConflictException(
      `该租期开始时有 ${winners.length} 个规则版本同时生效（${winners.map((row) => row.version).join("、")}），` +
        `无法唯一确定，请先作废多余版本`
    );
  }
  return winners[0];
}

/**
 * 展示状态：待生效 / 已生效 / 已被替代。草稿与已作废原样返回。
 *
 * 「已被替代」的判据是**有更新的版本已经生效**，而不是「不是最后一条」：一条待生效的
 * 未来版本不该让当前生效版本提前显示成已被替代，否则管理端会看到当下没有任何生效规则。
 */
export function resolveRuleVersionStatus<T extends RuleVersionTimelineEntry>(
  row: T,
  versions: readonly T[],
  now: string
): RentalRuleVersionStatus {
  if (!isIssuedRuleVersion(row.status)) return row.status;
  if (!row.effectiveFrom) return row.status;
  const nowAt = timeOf(now);
  const mine = timeOf(row.effectiveFrom);
  if (mine > nowAt) return "pending";
  const supersededByNewerEffective = issuedWithEffectiveFrom(versions).some(
    (other) => other.id !== row.id && timeOf(other.effectiveFrom!) > mine && timeOf(other.effectiveFrom!) <= nowAt
  );
  return supersededByNewerEffective ? "superseded" : "published";
}

/** 批量刷新展示状态，供列表与详情返回使用。 */
export function withResolvedRuleVersionStatuses<T extends RuleVersionTimelineEntry>(
  versions: readonly T[],
  now: string
): T[] {
  return versions.map((row) => ({ ...row, status: resolveRuleVersionStatus(row, versions, now) }));
}

/**
 * 发布时的生效时点校验（需求 4.6.1「阻止重叠或无法唯一确定的版本」）。
 *
 * 两条硬约束：
 * 1. 不得与已发布版本共用同一生效时点——那正是匹配无法唯一确定的成因。
 * 2. 不得早于或等于已有最新生效时点——往时间轴中间插一条会改写已过时点该套哪份条款，
 *    与「新版本不得改变旧报价和历史订单」同源；已锁定的报价靠快照免疫，但尚未报价的
 *    历史时点会被追溯改写，这是发布环节必须拦下的。
 */
export function assertRuleEffectiveFromAvailable<T extends RuleVersionTimelineEntry>(
  versions: readonly T[],
  effectiveFrom: string,
  excludeId?: string
): void {
  const at = timeOf(effectiveFrom);
  if (Number.isNaN(at)) throw new BadRequestException("生效时间不是有效时间");
  const issued = issuedWithEffectiveFrom(versions).filter((row) => row.id !== excludeId);
  const clash = issued.find((row) => timeOf(row.effectiveFrom!) === at);
  if (clash) {
    throw new ConflictException(`版本 ${clash.version} 已占用生效时点 ${new Date(at).toISOString()}，请另选时点`);
  }
  const latest = issued.reduce<T | undefined>(
    (best, row) => (!best || timeOf(row.effectiveFrom!) > timeOf(best.effectiveFrom!) ? row : best),
    undefined
  );
  if (latest && timeOf(latest.effectiveFrom!) > at) {
    throw new ConflictException(
      `生效时点必须晚于已发布的最新版本 ${latest.version}（${new Date(timeOf(latest.effectiveFrom!)).toISOString()}），` +
        `否则会改写已过时点适用的条款`
    );
  }
}

/** 已发布版本不可修改（需求 4.6.1）：只有草稿能改，恢复旧版必须生成新草稿。 */
export function assertRuleVersionEditable(status: RentalRuleVersionStatus, version: string): void {
  if (status === "draft") return;
  throw new ConflictException(`版本 ${version} 已发布或已作废，不能直接修改；请基于它恢复为新草稿后再改`);
}

/** 只有草稿能发布；已发布或已作废版本重复发布是调用方状态没刷新，不能静默放过。 */
export function assertRuleVersionPublishable(status: RentalRuleVersionStatus, version: string): void {
  if (status === "draft") return;
  throw new ConflictException(`版本 ${version} 不是草稿，无法发布`);
}

/**
 * 只有待生效与已生效版本能作废（需求 4.6.14「作废已发布或待生效版本」）。
 * 已被替代的版本仍是历史租期的匹配依据，作废它等于让当时开始的租期算不出规则。
 * 传入的必须是**按当前时间现算的展示状态**，否则库里滞后的标签会放开这道闸。
 */
export function assertRuleVersionVoidable(displayStatus: RentalRuleVersionStatus, version: string): void {
  if (displayStatus === "void") throw new ConflictException(`版本 ${version} 已作废`);
  if (displayStatus === "draft") throw new ConflictException(`版本 ${version} 是草稿，不需要作废`);
  if (displayStatus === "superseded") {
    throw new ConflictException(`版本 ${version} 已被替代，仍是历史租期的匹配依据，不能作废`);
  }
}

/** 版本号自增。恢复与发布都追加新号，永不复用旧号，历史因此可按号定位。 */
export function nextRuleVersionNumber(versions: readonly { version: string }[]): string {
  const highest = versions.reduce((max, row) => {
    const parsed = Number.parseFloat(row.version);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
  return (Math.round((highest + 0.1) * 10) / 10).toFixed(1);
}

/** 发布预览：新版本生效后哪些版本会被替代、时间轴缺口在哪里。只读推演。 */
export function previewRulePublish<T extends RuleVersionTimelineEntry>(
  versions: readonly T[],
  draft: T,
  effectiveFrom: string,
  now: string
): {
  draftVersion: string;
  effectiveFrom: string;
  scheduled: boolean;
  currentVersion?: string;
  supersededVersions: string[];
} {
  const at = timeOf(effectiveFrom);
  const issued = issuedWithEffectiveFrom(versions).filter((row) => row.id !== draft.id);
  const nowAt = timeOf(now);
  const currentlyEffective = issued
    .filter((row) => timeOf(row.effectiveFrom!) <= nowAt)
    .sort((a, b) => timeOf(b.effectiveFrom!) - timeOf(a.effectiveFrom!))[0];
  return {
    draftVersion: draft.version,
    effectiveFrom: new Date(at).toISOString(),
    scheduled: at > nowAt,
    currentVersion: currentlyEffective?.version,
    // 生效时点早于新版本的版本，在新版本生效后不再覆盖任何新租期。
    supersededVersions: issued
      .filter((row) => timeOf(row.effectiveFrom!) < at)
      .map((row) => row.version)
  };
}
