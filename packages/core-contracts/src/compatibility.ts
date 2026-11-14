/** 受控宿主组合的纯预检；通过只说明声明兼容，不注册或执行任何 Core。 */
import { z } from "zod";
import type { CoreManifest } from "./manifest";
import { CoreReleaseVersionSchema, isCoreVersionSupported } from "./version";

export const CoreHostVersionsSchema = z.object({
  platform: CoreReleaseVersionSchema,
  contract: CoreReleaseVersionSchema,
  node: CoreReleaseVersionSchema,
  capabilities: z.record(CoreReleaseVersionSchema)
}).strict();
export type CoreHostVersions = z.infer<typeof CoreHostVersionsSchema>;

export interface CoreCompatibilityIssue {
  coreId: string;
  code: "duplicate_core" | "platform_version" | "contract_version" | "node_version" | "missing_capability" | "capability_version";
  field: string;
  message: string;
}

/** 入口先用清单和宿主 schema 解析；这里只检查跨声明约束，不重复验证字段。 */
export function checkCoreCombination(manifests: readonly CoreManifest[], host: CoreHostVersions): {
  manifests: readonly CoreManifest[];
  issues: CoreCompatibilityIssue[];
} {
  const issues: CoreCompatibilityIssue[] = [];
  const ids = new Set<string>();
  for (const manifest of manifests) {
    const add = (code: CoreCompatibilityIssue["code"], field: string, message: string) =>
      issues.push({ coreId: manifest.id, code, field, message });
    if (ids.has(manifest.id)) add("duplicate_core", "id", "同一组合不能装配两个相同 Core 标识，请核对版本和来源");
    ids.add(manifest.id);
    if (!isCoreVersionSupported(host.platform, manifest.compatibility.platform))
      add("platform_version", "compatibility.platform", "底座版本不在 Core 声明的兼容区间内");
    if (!isCoreVersionSupported(host.contract, manifest.compatibility.contract))
      add("contract_version", "compatibility.contract", "Core 接入合同版本不兼容");
    if (!isCoreVersionSupported(host.node, manifest.runtime.node))
      add("node_version", "runtime.node", "Node.js 版本不在 Core 声明的支持区间内");
    for (const [index, requirement] of manifest.requires.entries()) {
      const actual = Object.hasOwn(host.capabilities, requirement.capability)
        ? host.capabilities[requirement.capability] : undefined;
      if (actual === undefined) add("missing_capability", `requires.${index}`, `宿主未提供必需能力 ${requirement.capability}`);
      else if (!isCoreVersionSupported(actual, requirement.version))
        add("capability_version", `requires.${index}.version`, `能力 ${requirement.capability} 的版本不兼容`);
    }
  }
  return { manifests, issues };
}
