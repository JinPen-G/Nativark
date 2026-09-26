import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  RentalAssetStatus,
  RentalCoreOrderStatus,
  RentalInventoryMode,
  type ManageRentalAllocationRequest,
  type RentalAllocation,
  type RentalAllocationCandidates,
  type RentalOrder,
  type RentalReservation,
  type RentalRuleConfig,
  type TenantRentalBusinessSettings,
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import {
  RentalCoreFactRepository,
  type RentalFactTx,
} from "./rental-core-fact.repository";
import { RentalCoreService } from "./rental-core.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { bufferedRentalPeriod, peakReservedQuantity } from "./rental-occupancy";
import { getRequestWorkspaceId, runWithRequestIdentity } from "../../common/request-identity";
import {
  ACTIVE_ASSIGNMENTS,
  allocationComplete,
  allocationConflict,
  lockedAssignment,
  type AssignmentOccupancy,
} from "./rental-allocation-policy";

@Injectable()
export class RentalAllocationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(RentalAllocationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: RentalCoreFactRepository,
    private readonly core: RentalCoreService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      void this.runDue().catch(() =>
        this.logger.error("自动分配任务失败，请检查数据库连接"),
      );
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async occupancies(
    tenantId: string,
    tx: RentalFactTx,
  ): Promise<AssignmentOccupancy[]> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await tx.rentalAllocation.findMany({
      where: {
        status: { in: ACTIVE_ASSIGNMENTS },
        assetId: { not: null },
        order: { tenantId, workspaceId },
      },
      include: { order: true },
    });
    return rows.map((r) => {
      const p = bufferedRentalPeriod(
        r.order.startAt.toISOString(),
        (r.order.effectiveEndAt ?? r.order.endAt).toISOString(),
        r.order.ruleSnapshot as unknown as RentalRuleConfig,
      );
      // 前单已逾期且实物未回库：不能继续依赖失效的计划归还时刻。
      if (
        r.status === "picked_up" &&
        (r.order.effectiveEndAt ?? r.order.endAt).getTime() <= Date.now()
      )
        p.endAt = "9999-12-31T00:00:00.000Z";
      return {
        orderId: r.orderId,
        assetId: r.assetId!,
        status: r.status,
        ...p,
        locationId: r.order.fulfillmentLocationId,
        returnLocationId:
          r.order.returnLocationId ?? r.order.fulfillmentLocationId,
      };
    });
  }

  async candidates(
    tenantId: string,
    orderId: string,
  ): Promise<RentalAllocationCandidates> {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.facts.findOrder(tenantId, orderId, tx);
      if (!order) throw new NotFoundException("订单不存在");
      return this.buildCandidates(tenantId, order, tx);
    });
  }

  /**
   * ORDER-CHANGE-01E：取货后换货只读候选资产。
   *
   * 不复用 `manage`：那条路径故意只允许待领取订单，放宽它会让已租赁订单被
   * 普通配货接口改写。这里单独复用同一套缓冲冲突判定，并排除当前订单自己的
   * 占用，确认时仍由核心事务重新加锁复查。
   */
  async exchangeAssetCandidates(
    tenantId: string,
    order: RentalOrder,
    itemGroupId: string,
    locationId: string,
    tx: RentalFactTx
  ) {
    if (locationId !== order.fulfillmentLocationId) return [];
    const group = this.core.listItemGroups(tenantId).find((row) => row.id === itemGroupId);
    if (!group || group.inventoryMode !== RentalInventoryMode.Serialized) return [];
    const [assets, occupancy] = await Promise.all([
      this.facts.listAssets(tenantId, tx),
      this.occupancies(tenantId, tx)
    ]);
    return assets
      .filter((asset) => asset.itemGroupId === itemGroupId && asset.locationId === locationId)
      .map((asset) => {
        const selectedByCurrent = order.allocations.some((row) => row.assetId === asset.id && ACTIVE_ASSIGNMENTS.includes(row.status));
        const reason = selectedByCurrent ? "资产已被当前订单占用" : allocationConflict(order, asset, occupancy);
        return { assetId: asset.id, assetNo: asset.assetNo, itemGroupId: asset.itemGroupId, available: !reason, reason };
      })
      .sort((left, right) => left.assetNo.localeCompare(right.assetNo));
  }

  private async buildCandidates(
    tenantId: string,
    order: RentalOrder,
    tx: RentalFactTx,
  ): Promise<RentalAllocationCandidates> {
    const [assets, occupancy] = await Promise.all([
      this.facts.listAssets(tenantId, tx),
      this.occupancies(tenantId, tx),
    ]);
    const groups = this.core.listItemGroups(tenantId);
    return {
      revision: order.assignment?.revision ?? 0,
      reservations: order.reservations
        .filter((r) => r.status === "confirmed")
        .map((r) => {
          const group = groups.find((g) => g.id === r.itemGroupId);
          const allowed = this.allowedModels(order, r);
          const models = groups.filter(
            (g) =>
              allowed.includes(g.id) &&
              g.inventoryMode === group?.inventoryMode,
          );
          const matches = order.allocations.filter(
            (a) =>
              ACTIVE_ASSIGNMENTS.includes(a.status) &&
              (a.metadata?.reservationId
                ? a.metadata.reservationId === r.id
                : a.orderLineId === r.orderLineId &&
                  a.itemGroupId === r.itemGroupId),
          );
          return {
            reservationId: r.id,
            orderLineId: r.orderLineId,
            itemGroupId: r.itemGroupId,
            itemGroupName:
              group?.name ??
              order.lines.find((l) => l.id === r.orderLineId)?.itemGroupName ??
              r.itemGroupId,
            locationId: r.locationId,
            inventoryMode:
              group?.inventoryMode ?? RentalInventoryMode.Serialized,
            quantity: r.quantity - r.releasedQuantity,
            assignedQuantity: matches.reduce((s, a) => s + a.quantity, 0),
            lockedQuantity: matches
              .filter(lockedAssignment)
              .reduce((s, a) => s + a.quantity, 0),
            models: models.map((g) => ({
              itemGroupId: g.id,
              name: g.name,
              enabled: g.status === "enabled",
            })),
            candidates: assets
              .filter(
                (a) =>
                  models.some((g) => g.id === a.itemGroupId) &&
                  a.locationId === r.locationId,
              )
              .map((a) => {
                const selectedElsewhere = order.allocations.some(
                  (x) =>
                    x.assetId === a.id &&
                    ACTIVE_ASSIGNMENTS.includes(x.status) &&
                    !(x.metadata?.reservationId
                      ? x.metadata.reservationId === r.id
                      : x.orderLineId === r.orderLineId &&
                        x.itemGroupId === r.itemGroupId),
                );
                const reason =
                  models.find((g) => g.id === a.itemGroupId)?.status !==
                  "enabled"
                    ? "型号已停用"
                    : selectedElsewhere
                      ? "已分配到本单其他明细"
                      : allocationConflict(order, a, occupancy);
                return {
                  assetId: a.id,
                  assetNo: a.assetNo,
                  itemGroupId: a.itemGroupId,
                  available: !reason,
                  reason,
                };
              })
              .sort((a, b) => a.assetNo.localeCompare(b.assetNo)),
          };
        }),
    };
  }

  /** 只使用下单时成员快照；套装组件不能借用父级定价组越界替换。 */
  private allowedModels(
    order: RentalOrder,
    reservation: RentalReservation,
  ): string[] {
    const line = order.lines.find((l) => l.id === reservation.orderLineId);
    if (
      !line?.pricingGroupId ||
      line.reservationPrecision === "exact_model" ||
      line.inventoryMode === RentalInventoryMode.Bundle ||
      !line.pricingGroupMemberItemGroupIds?.includes(reservation.itemGroupId)
    )
      return [reservation.itemGroupId];
    return [
      ...new Set([
        reservation.itemGroupId,
        ...line.pricingGroupMemberItemGroupIds,
      ]),
    ];
  }

  async manage(
    tenantId: string,
    orderId: string,
    input: ManageRentalAllocationRequest,
    tx: RentalFactTx,
    actor: string,
    source: "manual" | "automatic" = "manual",
  ) {
    await this.facts.lockOrder(tenantId, orderId, tx);
    const order = await this.facts.findOrder(tenantId, orderId, tx);
    if (!order) throw new NotFoundException("订单不存在");
    await this.core.assertCarrierOrderResourcesMutable(tenantId, order, tx, true);
    if (
      ![
        RentalCoreOrderStatus.Reserved,
        RentalCoreOrderStatus.ReadyForPickup,
      ].includes(order.status)
    )
      throw new ConflictException("只有已确认、尚未交付的订单可以分配");
    if (
      !["release", "unlock"].includes(input.action) &&
      this.core
        .listLocations(tenantId)
        .find((l) => l.id === order.fulfillmentLocationId)?.status !== "enabled"
    )
      throw new ConflictException("领取地点已停用，不能继续分配");
    const state = order.assignment ?? { revision: 0, history: [] };
    if (state.revision !== input.expectedRevision)
      throw new ConflictException("分配结果已更新，请刷新后重试");
    if (
      state.operationLock &&
      Date.parse(state.operationLock.expiresAt) > Date.now()
    )
      throw new ConflictException(
        `订单正在由 ${state.operationLock.ownerName} 办理，请先结束办理`,
      );
    if (state.operationLock)
      throw new ConflictException("办理已超时，请先接手并结束办理，再修改资源");
    if (
      ["unlock", "release", "reassign"].includes(input.action) &&
      !input.reason?.trim()
    )
      throw new BadRequestException("解锁、释放或改配必须填写原因");
    // 所有候选资产按固定顺序加锁；读占用必须在取锁后，避免最后一台被并发重复分配。
    const groups = this.core.listItemGroups(tenantId);
    const targets = order.reservations
      .filter((r) => r.status === "confirmed")
      .flatMap((r) =>
        this.allowedModels(order, r)
          .filter((id) => groups.some((g) => g.id === id))
          .map((itemGroupId) => ({ ...r, itemGroupId })),
      );
    for (const r of targets.sort((a, b) =>
      `${a.itemGroupId}:${a.locationId}`.localeCompare(
        `${b.itemGroupId}:${b.locationId}`,
      ),
    )) {
      const group = this.core
        .listItemGroups(tenantId)
        .find((g) => g.id === r.itemGroupId);
      if (!group) throw new ConflictException("预留型号不存在，请人工复核");
      await this.facts.lockInventoryTargets(
        tenantId,
        r.locationId,
        [{ itemGroupId: r.itemGroupId, inventoryMode: group.inventoryMode }],
        tx,
      );
      await this.facts.lockAssetsForAllocation(
        tenantId,
        r.itemGroupId,
        r.locationId,
        tx,
      );
    }
    const before = structuredClone(order.allocations);
    const movedModels = new Set<string>();
    const active = () =>
      order.allocations.filter((a) => ACTIVE_ASSIGNMENTS.includes(a.status));
    const at = new Date().toISOString();
    if (["preassign", "reassign"].includes(input.action)) {
      if (input.action === "reassign" && !input.selections?.length)
        throw new BadRequestException("请选择改配资源");
      const options = await this.buildCandidates(tenantId, order, tx);
      const selections: NonNullable<
        ManageRentalAllocationRequest["selections"]
      > =
        input.selections ??
        options.reservations
          .filter((r) => r.assignedQuantity < r.quantity)
          .map((r) => ({ reservationId: r.reservationId }));
      if (
        new Set(selections.map((s) => s.reservationId)).size !==
        selections.length
      )
        throw new BadRequestException("同一明细不可重复提交");
      const used = new Set(
        active()
          .map((a) => a.assetId)
          .filter(Boolean),
      );
      for (const selected of selections) {
        const r = options.reservations.find(
          (x) => x.reservationId === selected.reservationId,
        );
        if (!r) throw new BadRequestException("预留明细不存在或不属于本订单");
        const modelId = selected.itemGroupId ?? r.itemGroupId;
        const model = r.models.find((g) => g.itemGroupId === modelId);
        if (!model?.enabled)
          throw new ConflictException("型号已停用，不能继续分配");
        if (
          modelId !== r.itemGroupId &&
          (input.action !== "reassign" || !input.reason?.trim())
        )
          throw new BadRequestException("跨型号必须使用改配操作并填写原因");
        const previous = active().filter((a) =>
          a.metadata?.reservationId
            ? a.metadata.reservationId === r.reservationId
            : a.orderLineId === r.orderLineId &&
              a.itemGroupId === r.itemGroupId,
        );
        const preserveLock =
          input.action === "reassign" && previous.some(lockedAssignment);
        if (input.selections) {
          if (previous.some(lockedAssignment) && input.action !== "reassign")
            throw new ConflictException("已锁定资源只能通过改配更换");
          if (
            source === "automatic" &&
            previous.some((a) => a.metadata?.protected || lockedAssignment(a))
          )
            continue;
          previous.forEach((a) => {
            a.status = "released";
            if (a.assetId) used.delete(a.assetId);
          });
        }
        const remaining =
          r.quantity - (input.selections ? 0 : r.assignedQuantity);
        const ids =
          selected.assetIds ??
          r.candidates
            .filter(
              (c) =>
                c.itemGroupId === modelId &&
                c.available &&
                !used.has(c.assetId),
            )
            .slice(0, remaining)
            .map((c) => c.assetId);
        const quantity =
          r.inventoryMode === RentalInventoryMode.Serialized
            ? ids.length
            : (selected.quantity ?? remaining);
        if (
          !Number.isInteger(quantity) ||
          quantity <= 0 ||
          quantity > remaining
        )
          throw new ConflictException(
            `${r.itemGroupName} 无足够资源或数量不合法`,
          );
        if (
          r.inventoryMode === RentalInventoryMode.Serialized &&
          (new Set(ids).size !== ids.length ||
            ids.some(
              (id) =>
                used.has(id) ||
                !r.candidates.find(
                  (c) => c.assetId === id && c.itemGroupId === modelId,
                )?.available,
            ))
        )
          throw new ConflictException(
            `${r.itemGroupName} 所选资产不可用，请刷新候选`,
          );
        if (modelId !== r.itemGroupId) {
          // 整条预留随实际型号迁移；部分分配也必须保留尚未配齐数量的库存保障。
          order.reservations.find(
            (x) => x.id === r.reservationId,
          )!.itemGroupId = modelId;
          movedModels.add(modelId);
        }
        const add = (assetId?: string) => {
          const locked = preserveLock;
          order.allocations.push({
            id: randomUUID(),
            orderId,
            orderLineId: r.orderLineId,
            itemGroupId: modelId,
            assetId,
            assetNo: r.candidates.find((c) => c.assetId === assetId)?.assetNo,
            quantity: assetId ? 1 : quantity,
            status: locked ? "locked" : "pre_assigned",
            metadata: {
              reservationId: r.reservationId,
              source,
              protected:
                source === "manual" &&
                (this.core.getBusinessSettings(tenantId).allocation
                  ?.protectManual ??
                  true),
              assignedAt: at,
              lockedAt: locked ? at : undefined,
              itemGroupName: model.name,
              locationId: r.locationId,
            },
          });
          if (assetId) used.add(assetId);
        };
        if (r.inventoryMode === RentalInventoryMode.Serialized)
          ids.forEach(add);
        else add();
      }
    } else {
      const chosen = input.allocationIds
        ? active().filter((a) => input.allocationIds!.includes(a.id))
        : active();
      if (
        !chosen.length ||
        (input.allocationIds &&
          chosen.length !== new Set(input.allocationIds).size)
      )
        throw new BadRequestException("请选择本订单有效分配明细");
      for (const a of chosen) {
        if (input.action === "lock") {
          a.status = "locked";
          if (a.metadata) a.metadata.lockedAt = at;
        }
        if (input.action === "unlock") {
          a.status = "pre_assigned";
          if (a.metadata) a.metadata.lockedAt = undefined;
        }
        if (input.action === "release") a.status = "released";
      }
    }
    // 对整个最终组合再校验，而不是仅验证这次新增的一件。
    const finalOptions = await this.buildCandidates(tenantId, order, tx);
    if (!["release", "unlock"].includes(input.action)) {
      const [stock, reservations, assets] = await Promise.all([
        this.facts.listStockBalances(tenantId, tx),
        this.facts.activeReservations(tenantId, tx),
        this.facts.listAssets(tenantId, tx),
      ]);
      const period = bufferedRentalPeriod(
        order.startAt,
        order.effectiveEndAt ?? order.endAt,
        order.ruleSnapshot,
      );
      for (const r of finalOptions.reservations.filter(
        (r) =>
          [RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(r.inventoryMode) ||
          movedModels.has(r.itemGroupId),
      )) {
        const balance = stock.find(
          (s) =>
            s.itemGroupId === r.itemGroupId && s.locationId === r.locationId,
        );
        const others = reservations.filter(
          (s) =>
            s.orderId !== order.id &&
            s.itemGroupId === r.itemGroupId &&
            s.locationId === r.locationId,
        );
        const needed = finalOptions.reservations
          .filter(
            (s) =>
              s.itemGroupId === r.itemGroupId && s.locationId === r.locationId,
          )
          .reduce((sum, s) => sum + s.quantity, 0);
        const stockBased = [RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(r.inventoryMode);
        const capacity =
          stockBased
            ? (balance?.onHandQuantity ?? 0) -
              (balance?.maintenanceQuantity ?? 0)
            : assets.filter(
                (a) =>
                  a.itemGroupId === r.itemGroupId &&
                  a.locationId === r.locationId &&
                  [
                    RentalAssetStatus.Available,
                    RentalAssetStatus.Reserved,
                    RentalAssetStatus.Rented,
                  ].includes(a.status),
              ).length;
        const reserved = r.inventoryMode === RentalInventoryMode.Consumable
          ? others.reduce((sum, row) => sum + row.quantity, 0)
          : peakReservedQuantity(others, period.startAt, period.endAt);
        if (capacity - reserved < needed)
          throw new ConflictException(
            `${r.itemGroupName} 可交付数量不足，请先处理库存`,
          );
      }
    }
    for (const a of active()) {
      if (
        !["release", "unlock"].includes(input.action) &&
        this.core.listItemGroups(tenantId).find((g) => g.id === a.itemGroupId)
          ?.status !== "enabled"
      )
        throw new ConflictException("型号已停用，不能锁定");
      if (
        !["release", "unlock"].includes(input.action) &&
        a.assetId &&
        !finalOptions.reservations.some((r) =>
          r.candidates.some((c) => c.assetId === a.assetId && c.available),
        )
      )
        throw new ConflictException(
          "实际分配组合已不可用，不能锁定或保留冲突资源",
        );
    }
    if (
      !["release", "unlock"].includes(input.action) &&
      allocationComplete(order)
    )
      await this.core.validateAllocationEquipment(
        tenantId,
        order,
        active(),
        tx,
        actor,
      );
    const allLocked = allocationComplete(order, true);
    order.status = allLocked
      ? RentalCoreOrderStatus.ReadyForPickup
      : RentalCoreOrderStatus.Reserved;
    const invalid = active().some(
      (a) =>
        a.assetId &&
        !finalOptions.reservations.some((r) =>
          r.candidates.some((c) => c.assetId === a.assetId && c.available),
        ),
    );
    order.assignment = {
      ...state,
      revision: state.revision + 1,
      issue: invalid
        ? "分配资源不可交付，请释放或改配"
        : !allocationComplete(order) && source === "automatic"
          ? "资源未配齐，待人工处理"
          : undefined,
      history: [
        ...state.history,
        {
          id: randomUUID(),
          at,
          actor,
          action: input.action,
          reason: input.reason?.trim(),
          before,
          after: structuredClone(order.allocations),
        },
      ],
    };
    order.updatedAt = at;
    // 旧配货把资产写为 Reserved；首次转入时段分配后解除这份即时标记，
    // 但不得改动真实在租资产或其他旧订单仍持有的即时占用。
    const assets = await this.facts.listAssets(tenantId, tx);
    const changes: Array<{ assetId: string; status: RentalAssetStatus }> = [];
    for (const a of before.filter(
      (a) => a.status === "allocated" && a.assetId,
    )) {
      if (
        order.allocations.some(
          (x) => x.assetId === a.assetId && x.status === "allocated",
        ) ||
        assets.find((x) => x.id === a.assetId)?.status !==
          RentalAssetStatus.Reserved
      )
        continue;
      const occupied = await tx.rentalAllocation.count({
        where: {
          assetId: a.assetId,
          orderId: { not: orderId },
          status: { in: ["allocated", "picked_up"] },
          order: {
            tenantId,
            workspaceId: await resolveScopeWorkspaceId(tx, tenantId),
          },
        },
      });
      if (!occupied)
        changes.push({
          assetId: a.assetId!,
          status: RentalAssetStatus.Available,
        });
    }
    await this.facts.saveOrderAggregate(order, changes, tx);
    return order;
  }

  async operationLock(
    tenantId: string,
    orderId: string,
    action: "acquire" | "release" | "force-release",
    userId: string,
    name: string,
    token: string | undefined,
    allowedStatuses: RentalCoreOrderStatus[] = [
      RentalCoreOrderStatus.ReadyForPickup,
      RentalCoreOrderStatus.Renting,
    ],
    reason?: string,
    existingTx?: RentalFactTx,
  ) {
    const run = async (tx: RentalFactTx) => {
        await this.facts.lockOrder(tenantId, orderId, tx);
        const order = await this.facts.findOrder(tenantId, orderId, tx);
        if (!order) throw new NotFoundException("订单不存在");
        if (!allowedStatuses.includes(order.status))
          throw new ConflictException("订单阶段已变化或没有该阶段的办理权限");
        if (
          ![
            RentalCoreOrderStatus.ReadyForPickup,
            RentalCoreOrderStatus.Renting,
          ].includes(order.status)
        )
          throw new ConflictException("只有待交付或在租订单可以办理交接");
        const state = order.assignment ?? { revision: 0, history: [] };
        const previous = state.operationLock;
        const normalizedReason = reason?.trim();
        if (action === "force-release") {
          if (!normalizedReason) throw new BadRequestException("人工解除交接锁必须填写原因");
          if (!previous) throw new ConflictException("当前订单没有可解除的交接锁");
          if (Date.parse(previous.expiresAt) <= Date.now()) throw new ConflictException("交接锁已过期，请刷新订单后继续办理");
          if (previous.ownerId === userId) throw new ConflictException("本人持有的交接锁请正常结束办理");
        }
        if (
          action !== "force-release" &&
          previous &&
          Date.parse(previous.expiresAt) > Date.now() &&
          (previous.ownerId !== userId || previous.token !== token)
        )
          throw new ConflictException(
            `${previous.ownerName} 正在办理，请其结束办理或等待锁过期`,
          );
        if (
          action === "release" &&
          (!previous || previous.ownerId !== userId || previous.token !== token)
        )
          throw new ConflictException("办理凭证无效，不能释放他人的操作锁");
        const at = new Date().toISOString();
        order.assignment = {
          ...state,
          revision: state.revision + 1,
          operationLock:
            action === "acquire"
              ? {
                  ownerId: userId,
                  ownerName: name,
                  token: randomUUID(),
                  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
                }
              : undefined,
          history: [
            ...state.history,
            {
              id: randomUUID(),
              at,
              actor: name,
              action: action === "force-release" ? "operation_force_release" : `operation_${action}`,
              reason:
                action === "force-release"
                  ? `${normalizedReason}（解除${previous?.ownerName ?? "其他员工"}的交接锁）`
                  : previous && Date.parse(previous.expiresAt) <= Date.now()
                  ? "超时后重新接手"
                  : undefined,
              before: [],
              after: [],
            },
          ],
        };
        await this.facts.saveOrderAggregate(order, [], tx);
        if (action === "force-release" && previous) {
          const workspaceId = getRequestWorkspaceId();
          if (!workspaceId) throw new ConflictException("缺少经营空间上下文，无法记录人工解除审计");
          await tx.operationLog.create({
            data: {
              tenantId,
              workspaceId,
              userId,
              rentalOrderId: order.id,
              action: "rental.order.operation_lock.force_release",
              detail: {
                operator: name,
                reason: normalizedReason,
                releasedOwnerId: previous.ownerId,
                releasedOwnerName: previous.ownerName,
                expiresAt: previous.expiresAt,
                revision: order.assignment.revision,
              },
            },
          });
          return { released: true, releasedOwnerName: previous.ownerName, expiresAt: previous.expiresAt };
        }
        return {
          token: order.assignment.operationLock?.token,
          expiresAt: order.assignment.operationLock?.expiresAt,
        };
    };
    if (existingTx) return run(existingTx);
    return this.prisma.$transaction(run, { isolationLevel: "ReadCommitted" });
  }

  /** 无论是否开启自动分配，都检查已有预分配/锁定；异常不自动解除资源锁。 */
  async scanOrder(tenantId: string, orderId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.facts.lockOrder(tenantId, orderId, tx);
        const order = await this.facts.findOrder(tenantId, orderId, tx);
        if (
          !order ||
          ![
            RentalCoreOrderStatus.Reserved,
            RentalCoreOrderStatus.ReadyForPickup,
          ].includes(order.status)
        )
          return order;
        const active = order.allocations.filter((a) =>
          ACTIVE_ASSIGNMENTS.includes(a.status),
        );
        if (!active.length) return order;
        const options = await this.buildCandidates(tenantId, order, tx);
        const issues: string[] = [];
        if (
          this.core
            .listLocations(tenantId)
            .find((l) => l.id === order.fulfillmentLocationId)?.status !==
          "enabled"
        )
          issues.push("领取地点已停用");
        for (const a of active) {
          const row = options.reservations.find((r) =>
            a.metadata?.reservationId
              ? r.reservationId === a.metadata.reservationId
              : r.orderLineId === a.orderLineId &&
                r.itemGroupId === a.itemGroupId,
          );
          const model = row?.models.find(
            (m) => m.itemGroupId === a.itemGroupId,
          );
          if (!model?.enabled) issues.push("预留或型号已失效");
          if (a.assetId) {
            const c = row?.candidates.find(
              (x) => x.assetId === a.assetId && x.itemGroupId === a.itemGroupId,
            );
            if (!c?.available)
              issues.push(
                `${a.assetNo ?? a.assetId}：${c?.reason ?? "资产不在约定地点或型号已变更"}`,
              );
          }
        }
        const [stock, reservations] = await Promise.all([
          this.facts.listStockBalances(tenantId, tx),
          this.facts.activeReservations(tenantId, tx),
        ]);
        const period = bufferedRentalPeriod(
          order.startAt,
          order.effectiveEndAt ?? order.endAt,
          order.ruleSnapshot,
        );
        for (const r of options.reservations.filter(
          (r) =>
            [RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(r.inventoryMode) &&
            r.assignedQuantity > 0,
        )) {
          const balance = stock.find(
            (s) =>
              s.itemGroupId === r.itemGroupId && s.locationId === r.locationId,
          );
          const others = reservations.filter(
            (s) =>
              s.orderId !== order.id &&
              s.itemGroupId === r.itemGroupId &&
              s.locationId === r.locationId,
          );
          const required = options.reservations
            .filter(
              (s) =>
                s.itemGroupId === r.itemGroupId &&
                s.locationId === r.locationId,
            )
            .reduce((n, s) => n + s.quantity, 0);
          const reserved = r.inventoryMode === RentalInventoryMode.Consumable
            ? others.reduce((sum, row) => sum + row.quantity, 0)
            : peakReservedQuantity(others, period.startAt, period.endAt);
          if (
            (balance?.onHandQuantity ?? 0) -
              (balance?.maintenanceQuantity ?? 0) -
              reserved <
            required
          )
            issues.push(`${r.itemGroupName}：可交付数量不足`);
        }
        const issue = issues.length
          ? [...new Set(issues)].join("；")
          : !allocationComplete(order)
            ? "资源未配齐，待人工处理"
            : undefined;
        await this.recordIssue(order, issue, tx);
        return order;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  private async recordIssue(
    order: RentalOrder,
    issue: string | undefined,
    tx: RentalFactTx,
  ) {
    if (order.assignment?.issue === issue) return;
    const state = order.assignment ?? { revision: 0, history: [] };
    const at = new Date().toISOString();
    order.assignment = {
      ...state,
      revision: state.revision + 1,
      issue,
      history: [
        ...state.history,
        {
          id: randomUUID(),
          at,
          actor: "分配检查",
          action: issue ? "exception" : "exception_resolved",
          reason: issue ?? "资源恢复可交付",
          before: structuredClone(order.allocations),
          after: structuredClone(order.allocations),
        },
      ],
    };
    order.updatedAt = at;
    await this.facts.saveOrderAggregate(order, [], tx);
  }

  /** 自动操作仅在管理员显式开启时执行；逐订单事务，失败记录待人工处理。 */
  async runDue() {
    if (this.running) return;
    this.running = true;
    try {
      const settings =
        await this.prisma.rentalTenantBusinessSettings.findMany();
      for (const row of settings) {
        const config = (row.settings as unknown as TenantRentalBusinessSettings)
          .allocation;
        await runWithRequestIdentity(
          {
            tenantId: row.tenantId,
            workspaceId: row.workspaceId,
            userId: "allocation-scheduler",
          },
          async () => {
            const orders = await this.facts.listOrders(row.tenantId);
            for (const candidate of orders.filter((o) =>
              [
                RentalCoreOrderStatus.Reserved,
                RentalCoreOrderStatus.ReadyForPickup,
              ].includes(o.status),
            )) {
              const order = await this.scanOrder(row.tenantId, candidate.id);
              if (
                !order ||
                order.status !== RentalCoreOrderStatus.Reserved ||
                order.assignment?.operationLock ||
                Date.parse(order.effectiveEndAt ?? order.endAt) <= Date.now() ||
                (!config?.autoPreassign && !config?.autoLock)
              )
                continue;
              const minutes = (Date.parse(order.startAt) - Date.now()) / 60_000;
              if (
                !(
                  (config.autoPreassign &&
                    minutes <= config.preassignDays * 1440) ||
                  (config.autoLock && minutes <= config.lockMinutes)
                )
              )
                continue;
              try {
                await this.prisma.$transaction(
                  async (tx) => {
                    let current = order;
                    if (!allocationComplete(current))
                      current = await this.manage(
                        row.tenantId,
                        order.id,
                        {
                          action: "preassign",
                          expectedRevision: current.assignment?.revision ?? 0,
                        },
                        tx,
                        "自动分配",
                        "automatic",
                      );
                    if (
                      config.autoLock &&
                      minutes <= config.lockMinutes &&
                      allocationComplete(current)
                    )
                      await this.manage(
                        row.tenantId,
                        order.id,
                        {
                          action: "lock",
                          expectedRevision: current.assignment?.revision ?? 0,
                        },
                        tx,
                        "自动锁定",
                        "automatic",
                      );
                  },
                  { isolationLevel: "ReadCommitted" },
                );
              } catch (error) {
                await this.prisma.$transaction(async (tx) => {
                  await this.facts.lockOrder(row.tenantId, order.id, tx);
                  const latest = await this.facts.findOrder(
                    row.tenantId,
                    order.id,
                    tx,
                  );
                  if (
                    !latest ||
                    latest.status !== RentalCoreOrderStatus.Reserved
                  )
                    return;
                  const issue =
                    error instanceof ConflictException ||
                    error instanceof BadRequestException
                      ? error.message
                      : "自动分配失败，请人工复核";
                  // 扫描后若人工已处理，不能将旧失败覆盖到新结果上。
                  if (
                    (latest.assignment?.revision ?? 0) !==
                    (order.assignment?.revision ?? 0)
                  )
                    return;
                  await this.recordIssue(latest, issue, tx);
                });
              }
            }
          },
        );
      }
    } finally {
      this.running = false;
    }
  }
}
