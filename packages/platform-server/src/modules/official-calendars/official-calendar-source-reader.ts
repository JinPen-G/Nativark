/** 业务侧消费公共来源的只读接点。维护入口由平台 HTTP 的 SaaS 授权路径消费。 */
import type { OfficialCalendarSourceService } from "./official-calendar-source.service";

export type OfficialCalendarSourceReader = Pick<OfficialCalendarSourceService,
  "listVersions" | "getVersion" | "findVersionById" | "getApplicableVersion"
  | "latestVersionForYear" | "availableSourceSummaryForYear">;

export const OFFICIAL_CALENDAR_SOURCE_READER = "OFFICIAL_CALENDAR_SOURCE_READER";

export function createOfficialCalendarSourceReader(source: OfficialCalendarSourceService): OfficialCalendarSourceReader {
  return Object.freeze({
    listVersions: source.listVersions.bind(source),
    getVersion: source.getVersion.bind(source),
    findVersionById: source.findVersionById.bind(source),
    getApplicableVersion: source.getApplicableVersion.bind(source),
    latestVersionForYear: source.latestVersionForYear.bind(source),
    availableSourceSummaryForYear: source.availableSourceSummaryForYear.bind(source)
  });
}
