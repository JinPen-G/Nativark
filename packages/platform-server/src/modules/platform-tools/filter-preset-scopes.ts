/** 宿主源码登记的筛选偏好白名单。保留历史范围，新 Core 只能贡献自己的命名空间。 */
import type { PlatformFilterPresetContribution, PlatformFilterPresetScope } from "@rental-os/platform-contracts";

export const PLATFORM_FILTER_PRESET_SCOPES = ["rental-os.orders", "rental-os.vehicles", "rental-os.members",
  "rental-os.corporates", "rental-os.stations", "rental-os.vehicle-transfer"] as const;
export const PLATFORM_FILTER_PRESET_CONTRIBUTIONS = Symbol("platform.filter-preset.contributions");

export function collectPlatformFilterPresetScopes(contributions: readonly PlatformFilterPresetContribution[] = []): readonly PlatformFilterPresetScope[] {
  const scopes = new Set<PlatformFilterPresetScope>(PLATFORM_FILTER_PRESET_SCOPES), cores = new Set<string>();
  for (const contribution of contributions) {
    const { coreId } = contribution;
    if (typeof coreId !== "string" || coreId.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$(?![\s\S])/u.test(coreId)
      || coreId === "rental-os" || cores.has(coreId) || !Array.isArray(contribution.scopes))
      throw new Error("筛选预设贡献须使用唯一受控 Core 标识，不能占用历史命名空间");
    cores.add(coreId);
    for (const scope of contribution.scopes) {
      if (typeof scope !== "string" || scope.length > 191 || !scope.startsWith(`${coreId}.`)
        || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$(?![\s\S])/u.test(scope) || scopes.has(scope as PlatformFilterPresetScope))
        throw new Error("筛选预设 scope 须唯一且位于所属 Core 命名空间");
      scopes.add(scope as PlatformFilterPresetScope);
    }
  }
  return Object.freeze([...scopes]);
}
