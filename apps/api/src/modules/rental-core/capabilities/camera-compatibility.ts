import {
  type RentalCapabilityEquipmentLine,
  type RentalCapabilityConfig,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookResult,
  type RentalCompatibilityEntityRef,
  type RentalCompatibilityRelation
} from "@rental-os/shared";

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

/**
 * 卡口**有方向**的硬不兼容对：`[机身卡口, 镜头卡口]`。
 *
 * 方向性是物理事实：短法兰距机身用长法兰距镜头可以加转接环（多出的距离由环补上）；
 * 反过来，长法兰距机身配短法兰距镜头则无论如何都无法合焦，没有"负厚度"的环。
 * 因此**只能按 `[bodyMount, lensMount]` 单向匹配**——早前同时匹配反向组合，
 * 把有方向的关系当成了对称关系，于是「Z 机身 + EF 镜头」这种本可转接的组合被判死。
 */
const HARD_INCOMPATIBLE_MOUNTS: ReadonlyArray<readonly [string, string]> = [
  // 单反机身（长法兰距）+ 无反镜头（短法兰距）：无法合焦，不可转接。
  ["EF", "E"], ["EF", "Z"], ["EF", "RF"], ["EF", "L"], ["EF", "X"],
  ["F", "E"], ["F", "Z"], ["F", "RF"], ["F", "L"], ["F", "X"]
];

/**
 * 已知**可通过转接环**使用的对：`[机身卡口, 镜头卡口]`。
 *
 * 刻意用白名单而不是「不在硬冲突表里就算能转接」：后者会把任何没登记过的新卡口组合
 * 默默判成可用，而我们并不知道那对组合到底有没有可靠的转接方案。
 * 未登记的异卡口组合按 `mount_relation_unknown` 阻止（fail-closed），
 * 需要支持时显式加进本表，或在能力配置的结构化 `mount_adapter` 关系中登记。
 */
const ADAPTABLE_MOUNTS: ReadonlyArray<readonly [string, string]> = [
  ["E", "EF"], ["E", "F"], ["E", "A"],
  ["Z", "F"], ["Z", "EF"],
  ["RF", "EF"], ["RF", "F"],
  ["L", "EF"], ["L", "F"],
  ["X", "EF"], ["X", "F"],
  ["m43", "EF"], ["m43", "F"]
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

const relationsOf = (config: RentalCapabilityConfig): RentalCompatibilityRelation[] =>
  Array.isArray(config.relations) ? config.relations : [];

function refMatches(ref: RentalCompatibilityEntityRef, line: RentalCapabilityEquipmentLine): boolean {
  if (ref.kind === "item_group") return Boolean(ref.id) && ref.id === line.itemGroupId;
  if (ref.kind === "asset") return Boolean(ref.id) && ref.id === line.assetId;
  return Boolean(ref.field && ref.value) && str((line.attributes as Attr)[ref.field!]) === ref.value;
}

function related(
  relations: RentalCompatibilityRelation[],
  relationType: RentalCompatibilityRelation["relationType"],
  source: RentalCapabilityEquipmentLine,
  target: RentalCapabilityEquipmentLine,
  outcomes: RentalCompatibilityRelation["outcome"][] = ["allow"]
): RentalCompatibilityRelation | undefined {
  return relations.find(
    (row) =>
      row.relationType === relationType &&
      outcomes.includes(row.outcome) &&
      refMatches(row.source, source) &&
      refMatches(row.target, target)
  );
}

function targetsFor(
  source: RentalCapabilityEquipmentLine,
  candidates: RentalCapabilityEquipmentLine[],
  relations: RentalCompatibilityRelation[]
): RentalCapabilityEquipmentLine[] {
  const explicit = candidates.filter((target) => related(relations, "equipment_target", source, target, ["allow", "warn"]));
  if (explicit.length) return explicit;
  return candidates.length <= 1 ? candidates : [];
}

/**
 * 纯函数：对一组器材行算出全部兼容性发现。与 Hook 运行时解耦，便于单测直接覆盖。
 */
export function evaluateCameraCompatibility(
  equipment: RentalCapabilityEquipmentLine[],
  config: RentalCapabilityConfig = {}
): CompatFinding[] {
  const findings: CompatFinding[] = [];
  const roleOf = (line: RentalCapabilityEquipmentLine): string =>
    str((line.attributes as Attr).role) ?? "";
  const bodies = equipment.filter((line) => roleOf(line) === "body");
  const lenses = equipment.filter((line) => roleOf(line) === "lens");
  const powers = equipment.filter((line) => roleOf(line) === "power");
  const batteries = equipment.filter((line) => roleOf(line) === "battery");
  const chargers = equipment.filter((line) => roleOf(line) === "charger");
  const storages = equipment.filter((line) => roleOf(line) === "storage");
  const accessories = equipment.filter((line) => roleOf(line) === "accessory");
  const monitors = equipment.filter((line) => roleOf(line) === "monitor");
  const relations = relationsOf(config);

  // 1) 卡口：多套机身/镜头同单时必须用 equipment_target 明确配对，禁止做笛卡尔积。
  for (const lens of lenses) {
    const pairedBodies = targetsFor(lens, bodies, relations);
    if (bodies.length > 1 && !pairedBodies.length) {
      findings.push({
        decision: "block",
        code: "equipment_target_ambiguous",
        message: `镜头 ${lens.itemGroupName} 未登记目标机身，多机身订单无法确定兼容组合`,
        evidence: { lens: lens.itemGroupName, bodyCount: bodies.length }
      });
      continue;
    }
    for (const body of pairedBodies) {
    // 资产级覆盖优先（P1-8）：配货阶段传入的是实际资产，其卡口可能与商品组登记的不同
    // （改装或小改款）。报价阶段没有资产属性，自然回落到商品组。
    const bodyMount = str((body.attributes as Attr).assetMountOverride) ?? str((body.attributes as Attr).mount);
      const lensMount = str((lens.attributes as Attr).mount);
      if (!bodyMount || !lensMount || bodyMount === lensMount) continue;
      // 可维护关系优先于代码内的通用物理表；来源与原因随配置版本固化并可审计。
      const maintained = related(relations, "mount_adapter", lens, body, ["allow", "warn", "block"]);
      if (maintained?.outcome === "allow") continue;

      const evidence = { body: body.itemGroupName, lens: lens.itemGroupName, bodyMount, lensMount };
      if (maintained?.outcome === "block") {
        findings.push({ decision: "block", code: "mount_incompatible", message: maintained.reason, evidence });
        continue;
      }
      if (maintained?.outcome === "warn") {
        findings.push({ decision: "warn", code: "mount_needs_adapter", message: maintained.reason, evidence });
        continue;
      }
      // 只按 [机身, 镜头] 单向匹配硬冲突。
      if (HARD_INCOMPATIBLE_MOUNTS.some(([b, l]) => b === bodyMount && l === lensMount)) {
        findings.push({
          decision: "block",
          code: "mount_incompatible",
          message: `机身卡口 ${bodyMount} 与镜头卡口 ${lensMount} 硬不兼容（法兰距倒挂），无法安全转接`,
          evidence
        });
        continue;
      }
      if (ADAPTABLE_MOUNTS.some(([b, l]) => b === bodyMount && l === lensMount)) {
        findings.push({
          decision: "warn",
          code: "mount_needs_adapter",
          message: `机身卡口 ${bodyMount} 与镜头卡口 ${lensMount} 不同，需转接环`,
          evidence
        });
        continue;
      }
      // 既不在硬冲突表也不在可转接表：关系未登记。不能因为"没说不行"就当成能用。
      findings.push({
        decision: "block",
        code: "mount_relation_unknown",
        message:
          `机身卡口 ${bodyMount} 与镜头卡口 ${lensMount} 的转接关系未登记，无法确认可用；` +
          `如确有可靠转接方案，请在能力配置中登记结构化 mount_adapter 关系`,
        evidence
      });
    }
  }

  // 2) 画幅覆盖沿用同一配对关系，不能把 A 套镜头拿去和 B 套机身互相判定。
  for (const lens of lenses) {
    for (const body of targetsFor(lens, bodies, relations)) {
      const bodyFormat = str((body.attributes as Attr).sensorFormat);
      const bodyRank = bodyFormat ? FORMAT_RANK[bodyFormat] : undefined;
      if (!bodyRank) continue;
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
    (sum, body) =>
      sum +
      // 资产级实际功耗优先（P1-8）：同型号机身经改装后功耗可能不同。
      ((num((body.attributes as Attr).assetPowerDrawW) ?? num((body.attributes as Attr).powerDrawW)) ?? 0) *
        body.quantity,
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

  // 4) 电池与充电器（P1-7）。机身声明 `batteryModel`；电池行声明 `batteryModel`；
  //    充电器支持关系来自结构化 `battery_support` 数据。
  //    - 机身要求某型号电池但整单没有该型号 → 缺件风险（承租方可能自备，故 warn）；
  //    - 带了电池但型号与机身不符 → 阻止（装不上）；
  //    - 带了充电器但不支持所带电池型号 → 阻止（充不了，等于没带）；
  //    - 有电池但没带充电器 → 缺件风险。
  for (const body of bodies) {
    const need = str((body.attributes as Attr).batteryModel);
    if (!need) continue;
    const models = batteries.map((row) => str((row.attributes as Attr).batteryModel)).filter(Boolean) as string[];
    if (!models.length) {
      findings.push({
        decision: "warn",
        code: "battery_missing",
        message: `机身 ${body.itemGroupName} 需要 ${need} 电池，本单未包含任何电池`,
        evidence: { body: body.itemGroupName, requiredBattery: need }
      });
      continue;
    }
    if (!models.includes(need)) {
      findings.push({
        decision: "block",
        code: "battery_incompatible",
        message: `机身 ${body.itemGroupName} 需要 ${need} 电池，本单电池型号为 ${models.join("、")}`,
        evidence: { body: body.itemGroupName, requiredBattery: need, provided: models.join("、") }
      });
    }
  }
  if (batteries.length) {
    const batteryModels = batteries
      .map((row) => str((row.attributes as Attr).batteryModel))
      .filter(Boolean) as string[];
    if (!chargers.length) {
      findings.push({
        decision: "warn",
        code: "charger_missing",
        message: `本单包含电池（${batteryModels.join("、") || "型号未登记"}）但未包含充电器`,
        evidence: { batteryModels: batteryModels.join("、") }
      });
    } else {
      // 每种电池只要被任意一个充电器覆盖即可；逐充电器与全部电池做笛卡尔积会把
      // “两种电池 + 两个各自匹配的充电器”错误判成双方都不兼容。
      for (const battery of batteries) {
        const model = str((battery.attributes as Attr).batteryModel);
        if (!model) continue;
        const compatible = chargers.some((charger) => related(relations, "battery_support", charger, battery, ["allow", "warn"]));
        if (!compatible) {
          findings.push({
            decision: "block",
            code: "charger_incompatible",
            message: `电池 ${battery.itemGroupName}（${model}）没有已登记支持它的充电器`,
            evidence: { battery: battery.itemGroupName, batteryModel: model, chargerCount: chargers.length }
          });
        }
      }
    }
  }

  // 5) 存储介质：机身与存储卡通过结构化 storage_support 关系维护。
  for (const body of bodies) {
    const declared = relations.some((row) => row.relationType === "storage_support" && refMatches(row.source, body));
    if (!declared) continue;
    if (!storages.length) {
      findings.push({
        decision: "warn",
        code: "storage_missing",
        message: `机身 ${body.itemGroupName} 已登记存储要求，但本单未包含存储卡`,
        evidence: { body: body.itemGroupName }
      });
      continue;
    }
    if (!storages.some((storage) => related(relations, "storage_support", body, storage, ["allow", "warn"]))) {
      findings.push({
        decision: "block",
        code: "storage_incompatible",
        message: `本单存储介质均未命中机身 ${body.itemGroupName} 的已登记支持关系`,
        evidence: { body: body.itemGroupName, provided: storages.map((row) => row.itemGroupName).join("、") }
      });
    }
  }

  // 6) 接口：按配件目标机身与 port_support 关系判定，避免多机身订单交叉误判。
  for (const accessory of [...accessories, ...monitors]) {
    const portRelations = relations.filter((row) => row.relationType === "port_support" && refMatches(row.target, accessory));
    if (!portRelations.length) continue;
    const pairedBodies = targetsFor(accessory, bodies, relations);
    if (bodies.length > 1 && !pairedBodies.length) {
      findings.push({ decision: "block", code: "equipment_target_ambiguous", message: `${accessory.itemGroupName} 未登记目标机身`, evidence: { accessory: accessory.itemGroupName, bodyCount: bodies.length } });
      continue;
    }
    for (const body of pairedBodies) {
      if (!related(relations, "port_support", body, accessory, ["allow", "warn"])) {
        findings.push({
          decision: "block",
          code: "port_unavailable",
          message: `${accessory.itemGroupName} 与机身 ${body.itemGroupName} 未登记可用接口关系`,
          evidence: { accessory: accessory.itemGroupName, body: body.itemGroupName }
        });
      }
    }
  }

  // 7) 配件承载与安装（P1-7）。稳定器按载重、闪光灯按热靴、兔笼按适配机型。
  for (const accessory of accessories) {
    const kind = str((accessory.attributes as Attr).accessoryKind);
    const attrs = accessory.attributes as Attr;
    const targetBodies = targetsFor(accessory, bodies, relations);
    const targetLenses = targetsFor(accessory, lenses, relations);

    if (kind === "stabilizer") {
      const payload = num(attrs.maxPayloadG);
      const ambiguous = (bodies.length > 1 && !targetBodies.length) || (lenses.length > 1 && !targetLenses.length);
      if (ambiguous) {
        findings.push({ decision: "block", code: "equipment_target_ambiguous", message: `稳定器 ${accessory.itemGroupName} 未登记承载的机身/镜头组合`, evidence: { accessory: accessory.itemGroupName } });
        continue;
      }
      const rigWeight =
        targetBodies.reduce((sum, row) => sum + (num((row.attributes as Attr).weightG) ?? 0) * row.quantity, 0) +
        targetLenses.reduce((sum, row) => sum + (num((row.attributes as Attr).weightG) ?? 0) * row.quantity, 0);
      if (payload && rigWeight > 0) {
        if (rigWeight > payload) {
          findings.push({
            decision: "block",
            code: "stabilizer_overload",
            message: `稳定器 ${accessory.itemGroupName} 最大载重 ${payload}g，机身+镜头合计 ${rigWeight}g`,
            evidence: { accessory: accessory.itemGroupName, maxPayloadG: payload, rigWeightG: rigWeight }
          });
        } else if (rigWeight > payload * 0.9) {
          findings.push({
            decision: "warn",
            code: "stabilizer_payload_tight",
            message: `稳定器 ${accessory.itemGroupName} 载重余量不足 10%（上限 ${payload}g / 实际 ${rigWeight}g）`,
            evidence: { accessory: accessory.itemGroupName, maxPayloadG: payload, rigWeightG: rigWeight }
          });
        }
      }
    }

    if (kind === "flash") {
      const shoe = str(attrs.shoeType);
      if (bodies.length > 1 && !targetBodies.length) {
        findings.push({ decision: "block", code: "equipment_target_ambiguous", message: `闪光灯 ${accessory.itemGroupName} 未登记目标机身`, evidence: { accessory: accessory.itemGroupName } });
        continue;
      }
      for (const body of targetBodies) {
        const bodyShoe = str((body.attributes as Attr).shoeType);
        if (!shoe || !bodyShoe || shoe === bodyShoe) continue;
        findings.push({
          decision: "warn",
          code: "flash_shoe_mismatch",
          message: `闪光灯热靴 ${shoe} 与机身热靴 ${bodyShoe} 不同，需热靴转接件且可能失去 TTL`,
          evidence: { accessory: accessory.itemGroupName, body: body.itemGroupName, shoe, bodyShoe }
        });
      }
    }

    if (kind === "cage") {
      const declared = relations.some((row) => row.relationType === "model_fit" && refMatches(row.source, accessory));
      if (!declared) continue;
      if (bodies.length > 1 && !targetBodies.length) {
        findings.push({ decision: "block", code: "equipment_target_ambiguous", message: `兔笼 ${accessory.itemGroupName} 未登记目标机身`, evidence: { accessory: accessory.itemGroupName } });
        continue;
      }
      for (const body of targetBodies) {
        if (!related(relations, "model_fit", accessory, body, ["allow", "warn"])) {
          findings.push({
            decision: "block",
            code: "cage_model_mismatch",
            message: `兔笼 ${accessory.itemGroupName} 与机身 ${body.itemGroupName} 未登记适配关系`,
            evidence: { accessory: accessory.itemGroupName, body: body.itemGroupName }
          });
        }
      }
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
    config: RentalCapabilityConfig
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
