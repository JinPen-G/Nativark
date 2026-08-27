import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  OfficialCalendarSource,
  OfficialCalendarSourceVersion,
  OfficialCalendarSourceVersionSummary,
  RegisterOfficialCalendarSourceVersionRequest,
  SaveOfficialCalendarSourceRequest
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { isCalendarDateKey } from "./rental-business-day";

/**
 * 公共官方日历来源注册表（需求 4.5.2/4.5.8）。
 *
 * 这是**平台级**资源：官方节假日数据是公共基础来源，由 SaaS 平台管理员维护，
 * 经营空间只能引用某个来源版本生成自己的年度草稿，再由有权限的空间人员确认发布。
 * 早前空间侧直接 POST 原始 days，等于让每个租户自行编造公共数据，且「导入即生效」
 * 与需求「不得导入后自动影响全部经营空间」相反。
 *
 * 来源版本只追加：同一来源同一年度的每次官方调整都新增一行，旧版本保留，
 * 因此已发布的空间日历、有效报价和订单不会被静默覆盖——它们各自指向当时那一版。
 */
@Injectable()
export class OfficialCalendarSourceService {
  constructor(private readonly prisma: PrismaService) {}

  async listSources(): Promise<OfficialCalendarSource[]> {
    const rows = await this.prisma.officialCalendarSource.findMany({ orderBy: [{ region: "asc" }, { name: "asc" }] });
    return rows.map((row) => this.toSource(row));
  }

  async saveSource(input: SaveOfficialCalendarSourceRequest, _operator?: string): Promise<OfficialCalendarSource> {
    const name = input.name?.trim();
    const url = input.url?.trim();
    if (!name) throw new BadRequestException("来源名称不能为空");
    // 来源不可验证的数据不该进入公共来源库：它会被所有租户引用，出错面是全平台。
    if (!url || !/^https:\/\//.test(url)) throw new BadRequestException("官方来源地址必须使用 HTTPS");
    const data = {
      region: input.region,
      name,
      url,
      notes: input.notes?.trim() || null,
      isActive: input.isActive ?? true
    };
    if (input.id) {
      const existing = await this.prisma.officialCalendarSource.findUnique({ where: { id: input.id } });
      if (!existing) throw new NotFoundException("指定的官方日历来源不存在");
      return this.toSource(await this.prisma.officialCalendarSource.update({ where: { id: input.id }, data }));
    }
    const duplicate = await this.prisma.officialCalendarSource.findFirst({
      where: { region: data.region, name: data.name }
    });
    if (duplicate) throw new ConflictException("同一地区下已存在同名官方来源");
    return this.toSource(await this.prisma.officialCalendarSource.create({ data }));
  }

  /** 某来源的全部年度版本摘要（不含整年 days，只给条数）。 */
  async listVersions(sourceId?: string, year?: number): Promise<OfficialCalendarSourceVersionSummary[]> {
    const rows = await this.prisma.officialCalendarSourceVersion.findMany({
      where: { ...(sourceId ? { sourceId } : {}), ...(year ? { year } : {}) },
      include: { source: true },
      orderBy: [{ year: "desc" }, { version: "desc" }]
    });
    return rows.map((row) => {
      const { days, ...rest } = this.toVersion(row);
      return { ...rest, dayCount: days.length };
    });
  }

  async getVersion(id: string): Promise<OfficialCalendarSourceVersion> {
    const row = await this.prisma.officialCalendarSourceVersion.findUnique({
      where: { id },
      include: { source: true }
    });
    if (!row) throw new NotFoundException("指定的官方来源版本不存在");
    return this.toVersion(row);
  }

  /**
   * 登记一个新的年度来源版本。版本号由服务端在该 (来源, 年度) 下递增——
   * 让调用方自报版本号会让「再次调整必须形成新版本」这条要求可以被绕过。
   */
  async registerVersion(
    sourceId: string,
    input: RegisterOfficialCalendarSourceVersionRequest,
    operator?: string
  ): Promise<OfficialCalendarSourceVersion> {
    const source = await this.prisma.officialCalendarSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException("指定的官方日历来源不存在");
    if (!source.isActive) throw new ConflictException("该官方来源已停用，无法登记新版本");
    if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2999) {
      throw new BadRequestException("年度无效");
    }
    if (!input.days?.length) throw new BadRequestException("官方来源版本必须包含至少一个日期");
    if (!input.publishedAt || Number.isNaN(new Date(input.publishedAt).getTime())) {
      throw new BadRequestException("官方公告发布日期无效");
    }
    const seen = new Set<string>();
    for (const day of input.days) {
      // 严格日期校验：`2026-02-30` 会被 `new Date` 静默滚到 3 月 2 日，
      // 那天的节假日安排就落到了错误的日期上，而这份数据会被所有租户引用。
      if (!isCalendarDateKey(day.date)) throw new BadRequestException(`日期 ${day.date} 不是有效的 YYYY-MM-DD 日期`);
      if (!day.date.startsWith(`${input.year}-`)) throw new BadRequestException(`日期 ${day.date} 与年度不一致`);
      if (!["statutory_holiday", "makeup_workday"].includes(day.dayType)) {
        throw new BadRequestException("官方数据只允许法定节假日或调休工作日");
      }
      if (!day.name?.trim()) throw new BadRequestException(`日期 ${day.date} 缺少节日或调休名称`);
      // 同一批里重复给同一天说明来源数据本身有问题；静默取最后一条会让结果取决于数组顺序。
      if (seen.has(day.date)) throw new BadRequestException(`日期 ${day.date} 在本次登记中重复`);
      seen.add(day.date);
    }
    const latest = await this.prisma.officialCalendarSourceVersion.findMany({
      where: { sourceId, year: input.year },
      select: { version: true }
    });
    const version = nextSourceVersion(latest.map((row) => row.version));
    const created = await this.prisma.officialCalendarSourceVersion.create({
      data: {
        sourceId,
        year: input.year,
        version,
        publishedAt: new Date(input.publishedAt),
        importedBy: operator ?? null,
        days: input.days as unknown as object
      },
      include: { source: true }
    });
    return this.toVersion(created);
  }

  private toSource(row: {
    id: string;
    region: string;
    name: string;
    url: string;
    notes: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): OfficialCalendarSource {
    return {
      id: row.id,
      region: row.region as OfficialCalendarSource["region"],
      name: row.name,
      url: row.url,
      notes: row.notes ?? undefined,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toVersion(row: {
    id: string;
    sourceId: string;
    year: number;
    version: string;
    publishedAt: Date;
    importedAt: Date;
    importedBy: string | null;
    days: unknown;
    source: { name: string; url: string; region: string };
  }): OfficialCalendarSourceVersion {
    return {
      id: row.id,
      sourceId: row.sourceId,
      sourceName: row.source.name,
      sourceUrl: row.source.url,
      region: row.source.region as OfficialCalendarSourceVersion["region"],
      year: row.year,
      version: row.version,
      publishedAt: row.publishedAt.toISOString(),
      importedAt: row.importedAt.toISOString(),
      importedBy: row.importedBy ?? undefined,
      days: (row.days ?? []) as OfficialCalendarSourceVersion["days"]
    };
  }
}

/** 来源版本号按段取数值递增，避免字典序把 1.10 排在 1.9 之前。 */
function nextSourceVersion(existing: string[]): string {
  if (!existing.length) return "1.0";
  let best = { major: 1, minor: 0 };
  for (const value of existing) {
    const [major, minor] = value.split(".").map(Number);
    const candidate = { major: Number.isFinite(major) ? major : 1, minor: Number.isFinite(minor) ? minor : 0 };
    if (candidate.major > best.major || (candidate.major === best.major && candidate.minor > best.minor)) {
      best = candidate;
    }
  }
  return `${best.major}.${best.minor + 1}`;
}
