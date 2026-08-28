import {
  type RentalCapabilityEquipmentLine,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookResult
} from "@store-rental/shared";

/**
 * CAM-01A：摄影器材兼容性规则集（首个真实运行模块）。
 *
 * 这是**代码化、版本化**的规则，不是静态演示数据——它真的去读器材行的属性
 * （角色、卡口、画幅、供电、存储）并算出结论。规则升级 = `RULESET_VERSION` 递增，
 * 由 capability 的 `implementationVersion` 承载；有效报价与在途订单按各自固化的版本判定
 * （CORE-EXT-02D 的快照机制保证），因此升级不改写历史。
 *
 * 判定只有三种，与 Hook 契约一致：
 *   - `block`：物理上不兼容（卡口硬冲突、镜头像场覆盖不了机身画幅、供电不足）——服务端必拒；
 *   - `warn`：有风险但可用（需转接环、供电余量偏低、缺存储介质）——需带原因的例外确认才放行；
 *   - `allow`：无风险。
 *
 * 规则只做兼容性，**不**碰附件清点、使用量、检查与养护（那些属 CAM-01）。
 */
export const CAMERA_COMPATIBILITY_RULESET_VERSION = "cam-1.0";

const DEFAULT_POWER_MARGIN_PERCENT = 15;

/** 卡口硬不兼容对：即便加转接环也无法安全使用（法兰距倒挂），必须阻止。 */
const HARD_INCOMPATIBLE_MOUNTS: ReadonlyArray<readonly [string, string]> = [
  // 短法兰距机身用长法兰距镜头可加环；反之（长法兰距机身配短法兰距镜头）无法合焦。
  ["EF", "E"], // EF 机身 + E 卡口镜头：法兰距倒挂，不可转接
  ["EF", "Z"],
  ["EF", "RF"]
];

const FORMAT_RANK: Record<string, number> = { m43: 1, aps_c: 2, full_frame: 3, medium_format: 4 };

type Attr = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const num = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

interface CompatFinding {
  decision: "warn" | "block";
  code: string;
  message: string;
  evidence: Record<string, string | number | boolean>;
}

/**
 * 纯函数：对一组器材行算出全部兼容性发现。与 Hook 运行时解耦，便于单测直接覆盖。
 */
export function evaluateCameraCompatibility(
  equipment: RentalCapabilityEquipmentLine[],
  config: Record<string, string | number | boolean> = {}
): CompatFinding[] {
  const findings: CompatFinding[] = [];
  const roleOf = (line: RentalCapabilityEquipmentLine): string =>
    str((line.attributes as Attr).role) ?? "";
  const bodies = equipment.filter((line) => roleOf(line) === "body");
  const lenses = equipment.filter((line) => roleOf(line) === "lens");
  const powers = equipment.filter((line) => roleOf(line) === "power");

  // 1) 卡口：镜头卡口与机身卡口不一致时，硬冲突→阻止，否则→需转接环（风险）。
  for (const body of bodies) {
    const bodyMount = str((body.attributes as Attr).mount);
    for (const lens of lenses) {
      const lensMount = str((lens.attributes as Attr).mount);
      if (!bodyMount || !lensMount || bodyMount === lensMount) continue;
      const hardConflict = HARD_INCOMPATIBLE_MOUNTS.some(
        ([b, l]) => (b === bodyMount && l === lensMount) || (b === lensMount && l === bodyMount)
      );
      // 可转接卡口：属性是逗号分隔字符串（动态字段不支持数组类型）。
      const adapters = (str((lens.attributes as Attr).adapterMounts) ?? "")
        .split(",")
        .map((row) => row.trim())
        .filter(Boolean);
      if (adapters.includes(bodyMount)) continue; // 显式声明可转接到该机身卡口
      findings.push({
        decision: hardConflict ? "block" : "warn",
        code: hardConflict ? "mount_incompatible" : "mount_needs_adapter",
        message: hardConflict
          ? `机身卡口 ${bodyMount} 与镜头卡口 ${lensMount} 硬不兼容，无法安全转接`
          : `机身卡口 ${bodyMount} 与镜头卡口 ${lensMount} 不同，需转接环`,
        evidence: { body: body.itemGroupName, lens: lens.itemGroupName, bodyMount, lensMount }
      });
    }
  }

  // 2) 画幅覆盖：镜头像场必须覆盖机身画幅，否则严重暗角/裁切→阻止。
  for (const body of bodies) {
    const bodyFormat = str((body.attributes as Attr).sensorFormat);
    const bodyRank = bodyFormat ? FORMAT_RANK[bodyFormat] : undefined;
    if (!bodyRank) continue;
    for (const lens of lenses) {
      const covers = str((lens.attributes as Attr).coversFormat);
      const coverRank = covers ? FORMAT_RANK[covers] : undefined;
      if (!coverRank) continue;
      if (coverRank < bodyRank) {
        findings.push({
          decision: "block",
          code: "image_circle_too_small",
          message: `镜头像场仅覆盖 ${covers}，无法覆盖机身画幅 ${bodyFormat}`,
          evidence: { body: body.itemGroupName, lens: lens.itemGroupName, bodyFormat: bodyFormat ?? "", covers: covers ?? "" }
        });
      }
    }
  }

  // 3) 供电：机身峰值功耗合计对供电额定合计的余量不足→风险；完全供电不足→阻止。
  const totalDraw = bodies.reduce(
    (sum, body) => sum + (num((body.attributes as Attr).powerDrawW) ?? 0) * body.quantity,
    0
  );
  const totalSupply = powers.reduce(
    (sum, power) => sum + (num((power.attributes as Attr).powerSupplyW) ?? 0) * power.quantity,
    0
  );
  if (totalDraw > 0 && powers.length > 0) {
    const marginPercent = num(config.powerMarginPercent) ?? DEFAULT_POWER_MARGIN_PERCENT;
    if (totalSupply < totalDraw) {
      findings.push({
        decision: "block",
        code: "power_insufficient",
        message: `供电额定合计 ${totalSupply}W 低于器材峰值功耗 ${totalDraw}W`,
        evidence: { totalSupply, totalDraw }
      });
    } else if (totalSupply < totalDraw * (1 + marginPercent / 100)) {
      findings.push({
        decision: "warn",
        code: "power_margin_low",
        message: `供电余量低于 ${marginPercent}%（额定 ${totalSupply}W / 峰值 ${totalDraw}W）`,
        evidence: { totalSupply, totalDraw, marginPercent }
      });
    }
  }

  return findings;
}

/** Hook 看到的富化 subject：Core 把已解析器材行与例外确认随业务对象一并传入。 */
interface CameraCompatibilitySubject {
  equipment?: RentalCapabilityEquipmentLine[];
  /** 本次请求提交的全部能力例外确认；本模块只认 capability === "camera_compatibility" 的那些。 */
  capabilityExceptions?: Array<{ capability: string; code: string; reason: string }>;
}

/**
 * 构造摄影兼容性的 Hook 模块。由装配时登记到运行时。
 *
 * 三个节点的判定差异只在「风险如何处理」，卡口硬冲突与像场覆盖不足在任何节点都 block：
 *   - `quote_validation`：风险 → warn（报价照出，带提示，让运营知道下单时要确认）；
 *   - `order_confirmation`：风险**未确认 → block**（不能带风险下单），已确认 → warn（放行并记确认）；
 *   - `allocation_dispatch`：风险 → warn（订单已建、风险已在下单时裁决，这里只兜硬冲突）。
 */
export function buildCameraCompatibilityHookModule(): RentalCapabilityHookModule {
  const evaluate = (
    point: "quote_validation" | "order_confirmation" | "allocation_dispatch",
    subject: CameraCompatibilitySubject,
    config: Record<string, string | number | boolean>
  ): RentalCapabilityHookResult => {
    const findings = evaluateCameraCompatibility(subject.equipment ?? [], config);
    if (!findings.length) return { decision: "allow" };

    // 只认本能力的确认，且原因必须非空——空白原因不构成确认，
    // 否则「已确认带风险」与「随手点过」在审计里无法区分。
    const confirmedCodes = new Set(
      (subject.capabilityExceptions ?? [])
        .filter((row) => row.capability === "camera_compatibility" && row.reason?.trim())
        .map((row) => row.code)
    );
    const blockReasons: RentalCapabilityHookResult["blockReasons"] = [];
    const notices: RentalCapabilityHookResult["notices"] = [];

    for (const finding of findings) {
      const asNotice = { code: finding.code, message: finding.message, evidence: finding.evidence };
      if (finding.decision === "block") {
        blockReasons.push(asNotice);
        continue;
      }
      // 风险项：按节点决定阻止还是提示。
      const confirmed = confirmedCodes.has(finding.code);
      if (point === "order_confirmation" && !confirmed) {
        blockReasons.push({
          code: finding.code,
          message: `${finding.message}（风险组合需填写原因并由具备权限者确认后方可下单）`,
          evidence: finding.evidence
        });
      } else {
        notices.push({
          code: finding.code,
          message: confirmed ? `${finding.message}（已确认：带风险放行）` : finding.message,
          evidence: { ...finding.evidence, confirmed }
        });
      }
    }

    if (blockReasons.length) return { decision: "block", blockReasons, notices };
    return { decision: "warn", notices };
  };

  return {
    code: "camera_compatibility",
    // 规则本体的版本。登记表按 (code, implementationVersion) 索引，因此这个值
    // 决定了哪些报价/订单快照会落到这份实现上。规则改变行为时必须发新版本并**保留旧版**，
    // 否则在途订单会落到「快照版本找不到」的 fail-closed 分支。
    implementationVersion: CAMERA_COMPATIBILITY_RULESET_VERSION,
    order: 20,
    hooks: {
      quote_validation: (context) => evaluate("quote_validation", context.subject as CameraCompatibilitySubject, context.capability.config),
      order_confirmation: (context) => evaluate("order_confirmation", context.subject as CameraCompatibilitySubject, context.capability.config),
      allocation_dispatch: (context) => evaluate("allocation_dispatch", context.subject as CameraCompatibilitySubject, context.capability.config)
    }
  };
}
