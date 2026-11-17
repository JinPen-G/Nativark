/** 平台公共来源的私有存储视图。版本写入只提供追加入口，序号与快照沿原事务保存。 */
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";

export interface StoredOfficialCalendarSource {
  id: string;
  region: string;
  name: string;
  url: string;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredOfficialCalendarVersion {
  id: string;
  sourceId: string;
  year: number;
  version: string;
  sequence: number;
  sourceNameSnapshot: string;
  sourceUrlSnapshot: string;
  regionSnapshot: string;
  publishedAt: Date;
  importedAt: Date;
  importedBy: string | null;
  days: PlatformJsonValue;
}

interface StoredVersionWithSource extends StoredOfficialCalendarVersion {
  source: StoredOfficialCalendarSource;
}

type SourceWrite = Omit<StoredOfficialCalendarSource, "id" | "createdAt" | "updatedAt">;
type VersionWrite = Omit<StoredOfficialCalendarVersion, "id" | "importedAt" | "days"> & {
  days: Exclude<PlatformJsonValue, null>;
};
type VersionWhere = { sourceId?: string; year?: number; source?: { isActive: true } };

export interface OfficialCalendarTransaction {
  officialCalendarSourceVersion: {
    findFirst(query: {
      where: { sourceId: string; year: number };
      orderBy: { sequence: "desc" };
      select: { sequence: true };
    }): PromiseLike<{ sequence: number } | null>;
    create(query: { data: VersionWrite; include: { source: true } }): PromiseLike<StoredVersionWithSource>;
  };
}

export interface OfficialCalendarDataStore {
  officialCalendarSource: {
    findMany(query: { orderBy: [{ region: "asc" }, { name: "asc" }] }): PromiseLike<StoredOfficialCalendarSource[]>;
    findUnique(query: { where: { id: string } }): PromiseLike<StoredOfficialCalendarSource | null>;
    findFirst(query: { where: { region: string; name: string } }): PromiseLike<StoredOfficialCalendarSource | null>;
    create(query: { data: SourceWrite }): PromiseLike<StoredOfficialCalendarSource>;
    update(query: { where: { id: string }; data: SourceWrite }): PromiseLike<StoredOfficialCalendarSource>;
    count(query: { where: { isActive?: true; versions: { some: { year: number } } } }): PromiseLike<number>;
  };
  officialCalendarSourceVersion: {
    findMany(query: {
      where: VersionWhere;
      include: { source: true };
      orderBy: [{ year: "desc" }, { sequence: "desc" }];
    }): PromiseLike<StoredVersionWithSource[]>;
    findUnique(query: { where: { id: string }; include: { source: true } }): PromiseLike<StoredVersionWithSource | null>;
    findFirst(query: {
      where: { year: number; sourceId: string; source: { isActive: true } };
      include: { source: true };
      orderBy: [{ sequence: "desc" }];
    }): PromiseLike<StoredVersionWithSource | null>;
  };
  $transaction<T>(work: (transaction: OfficialCalendarTransaction) => Promise<T>): Promise<T>;
}

export const OFFICIAL_CALENDAR_DATA_STORE = "OFFICIAL_CALENDAR_DATA_STORE";
export const OFFICIAL_CALENDAR_APPLICATION = "OFFICIAL_CALENDAR_APPLICATION";
