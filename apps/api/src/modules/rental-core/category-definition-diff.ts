import { isDeepStrictEqual } from "node:util";
import type { CategoryDefinitionDifference, CategoryDraftSection } from "@rental-os/shared";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const read = (value: unknown, keys: string[]): unknown => keys.reduce<unknown>((current, key) => record(current) ? current[key] : undefined, value);
const fieldLabels: Record<string, string> = { type: "字段类型", required: "必填要求", unique: "唯一要求", options: "可选值", label: "显示名称", unit: "计量单位", usageMetric: "使用量读数" };

/** Configuration-only differences. No tenant facts are read or modified. */
export function categoryDefinitionDifferences(before: unknown, after: unknown): CategoryDefinitionDifference[] {
  const result: CategoryDefinitionDifference[] = [];
  const add = (section: CategoryDraftSection, path: string, label: string, left: unknown, right: unknown, kind: CategoryDefinitionDifference["kind"] = "changed") => {
    if (isDeepStrictEqual(left, right)) return;
    result.push({ section, path, label, kind: left === undefined && kind === "changed" ? "added" : right === undefined && kind === "changed" ? "removed" : kind,
      before: left === undefined ? null : structuredClone(left), after: right === undefined ? null : structuredClone(right) });
  };
  const walk = (section: CategoryDraftSection, path: string, label: string, left: unknown, right: unknown) => {
    if (isDeepStrictEqual(left, right)) return;
    if (record(left) && record(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(section, `${path}.${key}`, `${label} · ${fieldLabels[key] ?? key}`, left[key], right[key]);
    } else add(section, path, label, left, right);
  };
  const scopedFields = (section: CategoryDraftSection, keys: string[], label: string) => {
    const map = (value: unknown) => new Map((Array.isArray(value) ? value : []).filter(record).map((field) => [`${field.scope ?? "inspection"}:${field.code}`, field]));
    const left = map(read(before, keys)); const right = map(read(after, keys));
    for (const identity of new Set([...left.keys(), ...right.keys()])) {
      const old = left.get(identity); const next = right.get(identity);
      const name = `${label} · ${String(next?.label ?? old?.label ?? identity)}`;
      const path = `${keys.join(".")}[${identity}]`;
      if (!old || !next) { add(section, path, name, old, next, next?.required === true ? "required_added" : next ? "added" : "removed"); continue; }
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        let kind: CategoryDefinitionDifference["kind"] = "changed";
        if (key === "required" && next.required === true && old.required !== true) kind = "required_added";
        if (key === "unique" && next.unique === true && old.unique !== true) kind = "unique_enabled";
        if (key === "type") kind = "type_changed";
        if (key === "options" && Array.isArray(old.options) && Array.isArray(next.options) && old.options.some((value) => !(next.options as unknown[]).includes(value))) kind = "scope_narrowed";
        add(section, `${path}.${key}`, `${name} · ${fieldLabels[key] ?? key}`, old[key], next[key], kind);
      }
    }
  };
  scopedFields("attributes", ["businessModel", "assetFields"], "商品/资产字段");
  scopedFields("inspection", ["businessModel", "defaults", "inspectionFields"], "交接检查字段");
  for (const [section, keys, label] of [
    ["inventory", ["supportedInventoryModes"], "库存形态"],
    ["inventory", ["businessModel", "fulfillmentModes"], "履约方式"],
    ["inventory", ["businessModel", "locationTypes"], "地点类型"],
    ["pricing", ["businessModel", "pricingUnits"], "计价单位"]
  ] as Array<[CategoryDraftSection, string[], string]>) {
    const left = read(before, keys); const right = read(after, keys);
    const narrowed = Array.isArray(left) && Array.isArray(right) && left.some((entry) => !right.includes(entry));
    add(section, keys.join("."), label, left, right, narrowed ? "scope_narrowed" : "changed");
  }
  const roots: Array<[CategoryDraftSection, string, string]> = [
    ["basic", "name", "中文名称"], ["basic", "description", "中文说明"], ["basic", "display", "中英文展示设置"], ["basic", "terminology", "业务术语"],
    ["attributes", "attributeSchema", "属性概要"], ["capabilities", "defaultCapabilities", "默认能力"], ["capabilities", "requiredCapabilities", "必选能力"]
  ];
  for (const [section, key, label] of roots) walk(section, key, label, read(before, [key]), read(after, [key]));
  const business: Array<[CategoryDraftSection, string, string]> = [
    ["attributes", "catalogPresentation", "主档展示"], ["inventory", "deliveryDestination", "配送目的地"],
    ["pricing", "defaultPricingUnit", "默认计价单位"], ["pricing", "settingModules", "设置模块"], ["pricing", "supportsHolidayPricing", "节假日定价"],
    ["pricing", "supportsUsagePricing", "使用量计价"], ["pricing", "supportsPreauthorization", "预授权"],
    ["inspection", "supportsQualificationReview", "资质审核"], ["capabilities", "valueAddedServicePresets", "增值服务预设"]
  ];
  for (const [section, key, label] of business) walk(section, `businessModel.${key}`, label, read(before, ["businessModel", key]), read(after, ["businessModel", key]));
  for (const [section, key, label] of [["pricing", "payment", "支付默认规则"], ["pricing", "overdue", "逾时默认规则"], ["pricing", "fulfillment", "履约默认规则"], ["inspection", "rules", "资格/取消默认规则"]] as Array<[CategoryDraftSection, string, string]>) {
    walk(section, `businessModel.defaults.${key}`, label, read(before, ["businessModel", "defaults", key]), read(after, ["businessModel", "defaults", key]));
  }
  return result;
}
