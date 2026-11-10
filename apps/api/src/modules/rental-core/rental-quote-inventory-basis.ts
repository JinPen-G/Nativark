/** Owns bounded inventory-object snapshots and content equality, not allocation,
 * pricing or authority. Callers retain the original workspace mutex and Core
 * inventory algorithm; missing legacy evidence never falls back to today's kit. */
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { RentalInventoryMode, type RentalQuoteInventoryBasis, type RentalQuoteRequest } from '@rental-os/shared';
import type { RentalConfigStore, RentalConfigTx } from './rental-core-config.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const component = z.object({ itemGroupId: id, itemGroupCode: z.string().min(1).max(191),
  itemGroupName: z.string().min(1).max(191), quantity: z.number().int().positive().safe(),
  optional: z.boolean(), substitutionGroup: z.string().min(1).max(191).optional() }).strict();
const group = z.object({ id, tenantId: id, categoryCode: z.string().min(1), code: z.string().min(1).max(191),
  name: z.string().min(1).max(191), inventoryMode: z.nativeEnum(RentalInventoryMode), unit: z.string().min(1).max(191),
  status: z.enum(['enabled', 'disabled']), bundleComponents: z.array(component).max(256) }).strict();
const basis = z.object({ version: z.literal('rental-quote-inventory-1'), tenantId: id, workspaceId: id,
  groups: z.array(group).min(1).max(100) }).strict();
const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const normalize = (value: RentalQuoteInventoryBasis) => ({ ...value,
  groups: value.groups.map(row => ({ ...row, bundleComponents: row.bundleComponents.map(part => ({
    itemGroupId: part.itemGroupId, itemGroupCode: part.itemGroupCode, itemGroupName: part.itemGroupName,
    quantity: part.quantity, optional: Boolean(part.optional),
    ...(part.substitutionGroup ? { substitutionGroup: part.substitutionGroup } : {})
  })).sort((a, b) => compareId({ id: a.itemGroupId }, { id: b.itemGroupId })) })).sort(compareId) });

export function inventoryBasisGroups(value: unknown, tenantId: string, workspaceId: string,
  lines: RentalQuoteRequest['lines']): RentalQuoteInventoryBasis['groups'] {
  const parsed = basis.safeParse(value);
  if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.workspaceId !== workspaceId
    || !lines.length || lines.length > 100) throw new ConflictException('报价库存对象依据缺失或无效，请重新准备并确认');
  const rows = parsed.data.groups;
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => row.tenantId !== tenantId))
    throw new ConflictException('报价库存对象归属无效');
  const needed = new Set(lines.map(row => row.itemGroupId));
  for (const rootId of [...needed]) {
    const root = rows.find(row => row.id === rootId);
    if (!root) throw new ConflictException('报价库存对象不完整');
    if (root.inventoryMode !== RentalInventoryMode.Bundle && root.bundleComponents.length)
      throw new ConflictException('非套装对象存在非法组成');
    if (new Set(root.bundleComponents.map(row => row.itemGroupId)).size !== root.bundleComponents.length)
      throw new ConflictException('报价套装组成重复');
    for (const part of root.bundleComponents) {
      const target = rows.find(row => row.id === part.itemGroupId);
      if (!target || target.inventoryMode === RentalInventoryMode.Bundle || target.bundleComponents.length
        || target.code !== part.itemGroupCode || target.name !== part.itemGroupName)
        throw new ConflictException('报价组成缺失、嵌套或对象不一致');
      needed.add(target.id);
    }
  }
  if (needed.size !== rows.length) throw new ConflictException('报价库存依据含无关对象');
  return normalize(parsed.data as RentalQuoteInventoryBasis).groups;
}

export async function readRentalInventoryBasis(store: Pick<RentalConfigStore, 'listItemGroupsPage'>,
  tenantId: string, workspaceId: string, lines: RentalQuoteRequest['lines'], tx?: RentalConfigTx): Promise<RentalQuoteInventoryBasis> {
  if (!store.listItemGroupsPage) throw new ServiceUnavailableException('库存对象持久化读取不可用');
  if (!lines.length || lines.length > 100) throw new ConflictException('报价库存明细超出上限');
  const pending = [...new Set(lines.map(row => row.itemGroupId))];
  const groups: RentalQuoteInventoryBasis['groups'] = [];
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > 100) throw new ConflictException('报价套装对象超出读取上限');
    const groupId = pending[index];
    const page = await store.listItemGroupsPage(tenantId, workspaceId, { itemGroupId: groupId, limit: 1 }, tx);
    if (page.source !== 'persisted_workspace_configuration' || page.truncated || page.rows.length !== 1
      || page.rows[0].id !== groupId || page.rows[0].tenantId !== tenantId)
      throw new ConflictException('报价库存对象来源缺失或无效');
    const row = page.rows[0];
    groups.push({ id: row.id, tenantId: row.tenantId, categoryCode: row.categoryCode, code: row.code, name: row.name,
      inventoryMode: row.inventoryMode, unit: row.unit, status: row.status,
      bundleComponents: row.bundleComponents.map(part => ({ ...part, optional: Boolean(part.optional) })) });
    if (row.inventoryMode === RentalInventoryMode.Bundle) for (const part of row.bundleComponents) {
      if (!pending.includes(part.itemGroupId)) pending.push(part.itemGroupId);
    }
  }
  const result: RentalQuoteInventoryBasis = { version: 'rental-quote-inventory-1', tenantId, workspaceId, groups };
  result.groups = inventoryBasisGroups(result, tenantId, workspaceId, lines);
  return result;
}

/** The price/Hook context and inventory snapshot must describe the same objects.
 * This compares a fresh preparation context; it never backfills an old quote. */
export function assertInventoryBasisContext(value: RentalQuoteInventoryBasis, lines: RentalQuoteRequest['lines'],
  rows: RentalQuoteInventoryBasis['groups']) {
  const ids = new Set(value.groups.map(row => row.id));
  const groups = rows.filter(row => ids.has(row.id)).map(row => ({ id: row.id, tenantId: row.tenantId,
    categoryCode: row.categoryCode, code: row.code, name: row.name, inventoryMode: row.inventoryMode, unit: row.unit,
    status: row.status, bundleComponents: row.bundleComponents.map(part => ({ ...part, optional: Boolean(part.optional) })) }));
  const context = inventoryBasisGroups({ ...value, groups }, value.tenantId, value.workspaceId, lines);
  if (!isDeepStrictEqual(value.groups, context)) throw new ConflictException('报价准备期间库存对象已变化，请重新准备');
}

/** Must run under the same workspace lock used by item-group writers. */
export async function assertRentalInventoryBasis(store: Pick<RentalConfigStore, 'listItemGroupsPage'>,
  tenantId: string, workspaceId: string, lines: RentalQuoteRequest['lines'], value: unknown, tx: RentalConfigTx) {
  const original = inventoryBasisGroups(value, tenantId, workspaceId, lines);
  const current = await readRentalInventoryBasis(store, tenantId, workspaceId, lines, tx);
  if (!isDeepStrictEqual(original, current.groups)) throw new ConflictException('报价库存对象或套装组成已变化，请重新准备并确认');
}
