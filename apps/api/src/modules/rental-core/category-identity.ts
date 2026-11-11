/** Rental identity encoding and minimal published labels. Version adoption stays with its owning operation. */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isRentalCategoryCode, RentalCategoryCode, RENTAL_CATEGORY_WORKSPACE_NAMES, type RentalCategoryDefinition } from "@rental-os/shared";

export function rentalDefaultWorkspaceName(definition: RentalCategoryDefinition) {
  return definition.display?.defaultWorkspaceName?.trim() || RENTAL_CATEGORY_WORKSPACE_NAMES[definition.code] || definition.name;
}

const legacyCodes = new Map(Object.values(RentalCategoryCode).map(code => [code.toUpperCase(), code]));

/** Old Prisma enum names also reached historical string snapshots. Decode those four aliases without rewriting history. */
export function readRentalCategoryCode(value: unknown): RentalCategoryCode {
  if (isRentalCategoryCode(value)) return value;
  const legacy = typeof value === "string" ? legacyCodes.get(value) : undefined;
  if (!legacy) throw new ConflictException("已存品类编码缺少兼容解释");
  return legacy;
}

/** Scanners keep malformed sources in their existing compatibility issue lists. */
export function matchesRentalCategoryCode(value: unknown, canonicalCode: string): boolean {
  try { return readRentalCategoryCode(value) === canonicalCode; }
  catch { return false; }
}

export function rentalCategoryStorageCode(value: string): RentalCategoryCode {
  if (!isRentalCategoryCode(value)) throw new BadRequestException("经营品类编码格式无效");
  return value;
}

type IdentityReader = Pick<Prisma.TransactionClient, "rentalCategoryDefinition">;
const publishedIdentity = { versions: { some: { status: { in: ["published", "legacy_baseline"] } } } };

/** Minimal labels for existing rental configuration. Stopping new spaces does not retire an existing benefit scope. */
export async function rentalCategoryIdentityOptions(db: IdentityReader, tenantId?: string) {
  const rows = await db.rentalCategoryDefinition.findMany({
    where: { ...publishedIdentity, ...(tenantId ? { OR: [
      { openingScope: "all" }, { openingScope: "pilot", openingTenantIds: { array_contains: tenantId } }, { workspaces: { some: { tenantId } } }
    ] } : {}) },
    select: { code: true, name: true, recommendedVersion: { select: { status: true, definition: true } } },
    orderBy: { code: "asc" }
  });
  return rows.map((row) => {
    const code = readRentalCategoryCode(row.code);
    const version = row.recommendedVersion;
    const body = version?.definition;
    const name = version && ["published", "legacy_baseline"].includes(version.status) && body &&
      typeof body === "object" && !Array.isArray(body) && body.code === code &&
      typeof body.name === "string" && body.name.trim() ? body.name : row.name;
    return { code, name };
  });
}

/** A format-valid code alone cannot become a membership scope. Adoption checks remain separate. */
export async function assertPublishedRentalCategoryIdentities(db: IdentityReader, codes: readonly string[]) {
  const unique = [...new Set(codes)];
  unique.forEach(rentalCategoryStorageCode);
  if (!unique.length) return;
  const count = await db.rentalCategoryDefinition.count({ where: { ...publishedIdentity, code: { in: unique } } });
  if (count !== unique.length) throw new BadRequestException("权益适用范围包含不存在或未发布的租赁品类");
}
