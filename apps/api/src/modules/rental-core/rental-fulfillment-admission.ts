import { ConflictException } from "@nestjs/common";
import { Prisma, type RentalFulfillmentLocation, type RentalFulfillmentOperator } from "@prisma/client";
import type { RentalFulfillmentLocation as Location } from "@rental-os/shared";

/** New-business admission only. Historical snapshots and physical returns do not
 * use this gate. Configuration writers share the workspace row lock; raw locking
 * reads also avoid an earlier RepeatableRead snapshot after waiting for a writer. */
export interface RentalFulfillmentRequirement {
  locationId: string;
  capability?: Location["capabilities"][number];
  partner?: boolean;
}
export async function readRentalFulfillmentAdmission(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  requirements: readonly RentalFulfillmentRequirement[]
) {
  if (!requirements.length || requirements.length > 100 || requirements.some(row =>
    typeof row.locationId !== "string" || !row.locationId || row.locationId.length > 191)) {
    throw new ConflictException("履约准入地点无效或超出读取上限");
  }
  const workspace = (await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT status FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE
  `))[0];
  if (!workspace || workspace.status.toLowerCase() !== "active") throw new ConflictException("经营空间不可用，不能承接新业务");
  const ids = [...new Set(requirements.map(row => row.locationId))].sort();
  const locations = await tx.$queryRaw<RentalFulfillmentLocation[]>(Prisma.sql`
    SELECT * FROM rental_fulfillment_locations WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `);
  if (locations.length !== ids.length || locations.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId
    || !ids.includes(row.id))) throw new ConflictException("履约地点不存在或不属于当前经营空间");
  const operatorIds = [...new Set(locations.map(row => row.operatorId).filter((id): id is string => Boolean(id)))].sort();
  const operators = operatorIds.length ? await tx.$queryRaw<RentalFulfillmentOperator[]>(Prisma.sql`
    SELECT * FROM rental_fulfillment_operators WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      AND id IN (${Prisma.join(operatorIds)}) ORDER BY id FOR UPDATE
  `) : [];
  for (const requirement of requirements) {
    const location = locations.find(row => row.id === requirement.locationId)!;
    const operator = operators.find(row => row.id === location.operatorId);
    if (location.status !== "enabled") throw new ConflictException(`${location.name}已停用`);
    if (!operator || operator.tenantId !== tenantId || operator.workspaceId !== workspaceId || operator.status !== "enabled") {
      throw new ConflictException(`${location.name}所属经营主体已停用或不存在`);
    }
    if (!Array.isArray(location.capabilities) || location.capabilities.some(value => typeof value !== "string")) {
      throw new ConflictException(`${location.name}缺少可信履约能力配置`);
    }
    if (requirement.capability && !location.capabilities.includes(requirement.capability)) {
      throw new ConflictException(`${location.name}不支持${requirement.capability === "pickup" ? "领取" : requirement.capability === "return" ? "归还" : requirement.capability === "delivery" ? "配送" : "仓储"}`);
    }
    if (requirement.partner && operator.type !== "partner") throw new ConflictException("合作点取还必须选择合作经营主体的地点");
  }
  return { locations, operators };
}
