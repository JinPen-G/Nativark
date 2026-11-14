/** 发布版本和兼容区间的唯一规则；平台、合同和 Core 分别传入自己的版本。 */
import { z } from "zod";

// 首版只接收确定的三段数字发行版本；不解释 npm 范围、latest 或预发行标签。
const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$(?![\s\S])/;
export const CoreReleaseVersionSchema = z.string().max(80)
  .regex(releasePattern, "使用三段数字发行版本，例如 0.1.0");

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export const CoreVersionRangeSchema = z.object({
  minInclusive: CoreReleaseVersionSchema,
  maxExclusive: CoreReleaseVersionSchema
}).strict().refine(range => {
  // 字段格式错误由字段 schema 返回；对象级 refine 也会收到这些不合格字符串。
  if (!releasePattern.test(range.minInclusive) || !releasePattern.test(range.maxExclusive)) return true;
  return compareVersions(range.minInclusive, range.maxExclusive) < 0;
}, {
  message: "兼容区间的上限必须大于下限",
  path: ["maxExclusive"]
});

export type CoreVersionRange = z.infer<typeof CoreVersionRangeSchema>;

/** 只作版本比较；调用前由清单/宿主 schema 校验版本，不能据此推断数据库就绪。 */
export function isCoreVersionSupported(version: string, range: CoreVersionRange): boolean {
  return compareVersions(version, range.minInclusive) >= 0
    && compareVersions(version, range.maxExclusive) < 0;
}
