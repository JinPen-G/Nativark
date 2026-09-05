import { useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
} from "antd";
import {
  RentalInventoryMode,
  rentalAllocationProgress,
  type ManageRentalAllocationRequest,
  type RentalAllocation,
  type RentalOrder,
} from "@store-rental/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import { useAuthStore } from "@/features/auth/authStore";
import { QueryState } from "@/components/QueryState";
import { ItemGroupPhoto } from "@/features/catalog/ItemGroupPhoto";

const labels: Record<string, string> = {
  pre_assigned: "预分配",
  locked: "已锁定",
  allocated: "已锁定",
  picked_up: "已交付",
  returned: "已归还",
  released: "已释放",
  preassign: "预分配",
  lock: "锁定",
  unlock: "解锁",
  release: "释放",
  reassign: "改配",
  operation_acquire: "开始办理",
  operation_release: "结束办理",
  exception: "发现分配异常",
  exception_resolved: "分配异常已解除",
};
export function OrderAllocationPanel({ order }: { order: RentalOrder }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const has = useAuthStore((s) => s.hasPermission);
  const canOperate = has("store-rental:order:operate");
  const canReassign = has("store-rental:order:reassign");
  const editable = ["reserved", "ready_for_pickup"].includes(order.status);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selection, setSelection] = useState<
    Record<
      string,
      { itemGroupId?: string; assetIds?: string[]; quantity?: number }
    >
  >({});
  const [confirmation, setConfirmation] = useState<{
    action: ManageRentalAllocationRequest["action"];
    ids?: string[];
  }>();
  const groups = useQuery({
    queryKey: ["rental-core", "groups"],
    queryFn: rentalCoreApi.itemGroups,
  });
  const candidates = useQuery({
    queryKey: [
      "rental-core",
      "order",
      order.id,
      "allocation-candidates",
      order.assignment?.revision,
    ],
    queryFn: () => rentalCoreApi.allocationCandidates(order.id),
    enabled: editable && canOperate && open,
  });
  const progress = rentalAllocationProgress(order);
  const active = order.allocations.filter((a) => a.status !== "released");
  const mutation = useMutation({
    mutationFn: (
      input: Omit<ManageRentalAllocationRequest, "expectedRevision">,
    ) =>
      rentalCoreApi.manageAllocations(order.id, {
        ...input,
        expectedRevision:
          (open && !confirmation ? candidates.data?.revision : undefined) ??
          order.assignment?.revision ??
          0,
      }),
    onSuccess: async () => {
      setOpen(false);
      setConfirmation(undefined);
      setSelection({});
      setReason("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["rental-core", "order", order.id] }),
        qc.invalidateQueries({ queryKey: ["rental-core", "orders"] }),
      ]);
      message.success("分配结果已更新");
    },
    onError: (error: Error) => {
      const detail = isAxiosError(error)
        ? error.response?.data?.message
        : undefined;
      message.error(
        (Array.isArray(detail) ? detail.join("；") : detail) ||
          error.message ||
          "资源已变化，请刷新后重试",
      );
      void qc.invalidateQueries({
        queryKey: ["rental-core", "order", order.id],
      });
    },
  });
  const begin = () => {
    setSelection({});
    setReason("");
    setConfirmation(undefined);
    setOpen(true);
  };
  const confirmAction = (
    action: ManageRentalAllocationRequest["action"],
    ids?: string[],
  ) => {
    setConfirmation({ action, ids });
    setReason("");
    setOpen(true);
  };
  const submit = () => {
    if (confirmation) {
      mutation.mutate({
        action: confirmation.action,
        allocationIds: confirmation.ids,
        reason,
      });
      return;
    }
    const entries = Object.entries(selection).filter(
      ([, s]) => s.assetIds?.length || s.quantity,
    );
    if (!entries.length) {
      message.warning("请选择至少一项资源或数量");
      return;
    }
    const replacing = entries.some(([id, s]) => {
      const row = candidates.data?.reservations.find(
        (r) => r.reservationId === id,
      );
      return (
        (s.itemGroupId && s.itemGroupId !== row?.itemGroupId) ||
        order.allocations.some(
          (a) =>
            (a.metadata?.reservationId
              ? a.metadata.reservationId === id
              : a.orderLineId === row?.orderLineId &&
                a.itemGroupId === row?.itemGroupId) &&
            ["locked", "allocated"].includes(a.status),
        )
      );
    });
    if (replacing && (!canReassign || !reason.trim())) {
      message.warning("跨型号或更换锁定资源需要改配权限，并填写原因");
      return;
    }
    mutation.mutate({
      action: replacing ? "reassign" : "preassign",
      selections: entries.map(([reservationId, s]) => ({
        reservationId,
        ...s,
      })),
      reason,
    });
  };
  const locked = Boolean(order.assignment?.operationLock);
  return (
    <>
      <Card
        title="预约商品与实际分配"
        extra={
          editable &&
          canOperate && (
            <Space wrap>
              <Button disabled={locked || mutation.isPending} onClick={begin}>
                选择资源 / 改配
              </Button>
              <Button
                disabled={
                  locked ||
                  progress.assigned >= progress.required ||
                  mutation.isPending
                }
                onClick={() => mutation.mutate({ action: "preassign" })}
              >
                自动补齐预分配
              </Button>
              <Button
                type="primary"
                disabled={
                  locked ||
                  !progress.assigned ||
                  progress.locked >= progress.assigned ||
                  mutation.isPending
                }
                onClick={() => mutation.mutate({ action: "lock" })}
              >
                锁定已分配资源
              </Button>
            </Space>
          )
        }
      >
        <Alert
          showIcon
          type={
            order.assignment?.issue
              ? "error"
              : progress.locked < progress.required
                ? "warning"
                : "success"
          }
          title={
            order.assignment?.issue ??
            (editable
              ? `${progress.label} · 已分配 ${progress.assigned}/${progress.required} · 已锁定 ${progress.locked}/${progress.required}`
              : "交付资源记录")
          }
          description={
            editable
              ? "按完整租期和前后缓冲检查资源；全部必要资源锁定后才能办理领取。预分配不会重复扣减预留库存。"
              : undefined
          }
          style={{ marginBottom: 16 }}
        />
        {locked && (
          <Alert
            type="info"
            title={`${order.assignment!.operationLock!.ownerName} 正在办理，结束办理后才能改配`}
            style={{ marginBottom: 12 }}
          />
        )}
        <Table<RentalAllocation>
          rowKey="id"
          pagination={false}
          dataSource={active}
          scroll={{ x: 760 }}
          locale={{ emptyText: "尚未分配实际资源，预约库存仍保留" }}
          columns={[
            {
              title: "商品照片",
              width: 88,
              render: (_, a) => {
                const g = groups.data?.find((g) => g.id === a.itemGroupId);
                const cover =
                  g?.images?.find((i) => i.isCover) ?? g?.images?.[0];
                return g && cover ? (
                  <ItemGroupPhoto groupId={g.id} image={cover} />
                ) : (
                  "未上传"
                );
              },
            },
            {
              title: "预订分组 / 实际型号",
              render: (_, a) => (
                <>
                  <b>
                    {order.lines.find((l) => l.id === a.orderLineId)
                      ?.pricingGroupName ??
                      order.lines.find((l) => l.id === a.orderLineId)
                        ?.itemGroupName}
                  </b>
                  <br />
                  {a.metadata?.itemGroupName ??
                    groups.data?.find((g) => g.id === a.itemGroupId)?.name ??
                    a.itemGroupId}
                </>
              ),
            },
            {
              title: "资源编号 / 数量",
              render: (_, a) => (
                <>
                  {a.assetNo ?? "数量库存"} × {a.quantity}
                </>
              ),
            },
            {
              title: "分配状态",
              render: (_, a) => (
                <Space orientation="vertical" size={0}>
                  <Tag color={a.status === "pre_assigned" ? "orange" : "blue"}>
                    {labels[a.status]}
                  </Tag>
                  {a.metadata?.protected && (
                    <span className="muted">人工保护</span>
                  )}
                </Space>
              ),
            },
            {
              title: "操作",
              render: (_, a) =>
                editable && canOperate ? (
                  <Space>
                    {a.status === "pre_assigned" && (
                      <Button
                        type="link"
                        disabled={locked || mutation.isPending}
                        onClick={() =>
                          mutation.mutate({
                            action: "lock",
                            allocationIds: [a.id],
                          })
                        }
                      >
                        锁定
                      </Button>
                    )}
                    {canReassign &&
                      ["locked", "allocated"].includes(a.status) && (
                        <Button
                          type="link"
                          disabled={locked}
                          onClick={() => confirmAction("unlock", [a.id])}
                        >
                          解锁
                        </Button>
                      )}
                    {canReassign && (
                      <Button
                        type="link"
                        danger
                        disabled={locked}
                        onClick={() => confirmAction("release", [a.id])}
                      >
                        释放
                      </Button>
                    )}
                  </Space>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Card>
      {!!order.assignment?.history.length && (
        <Card
          title={`分配与办理记录（${order.assignment.history.length}）`}
          extra={
            <Button type="text" onClick={() => setHistoryOpen((v) => !v)}>
              {historyOpen ? "收起记录" : "展开记录"}
            </Button>
          }
        >
          {!historyOpen && (
            <span className="muted">
              最近：
              {new Date(order.assignment.history.at(-1)!.at).toLocaleString()} ·{" "}
              {order.assignment.history.at(-1)!.actor} ·{" "}
              {labels[order.assignment.history.at(-1)!.action] ??
                order.assignment.history.at(-1)!.action}
            </span>
          )}
          {historyOpen && (
            <Timeline
              style={{ maxHeight: 400, overflowY: "auto" }}
              items={[...order.assignment.history].reverse().map((h) => ({
                title: new Date(h.at).toLocaleString(),
                content: (
                  <>
                    <b>
                      {h.actor} · {labels[h.action] ?? h.action}
                    </b>
                    {h.reason && <p>{h.reason}</p>}
                    {!!h.before.length && (
                      <div className="muted">
                        变更前：
                        {h.before
                          .filter((a) => a.status !== "released")
                          .map(
                            (a) =>
                              `${a.assetNo ?? a.metadata?.itemGroupName ?? "数量库存"} × ${a.quantity}（${labels[a.status]}）`,
                          )
                          .join("、") || "无分配"}
                      </div>
                    )}
                    {!!h.after.length && (
                      <div className="muted">
                        变更后：
                        {h.after
                          .filter((a) => a.status !== "released")
                          .map(
                            (a) =>
                              `${a.assetNo ?? a.metadata?.itemGroupName ?? "数量库存"} × ${a.quantity}（${labels[a.status]}）`,
                          )
                          .join("、")}
                      </div>
                    )}
                  </>
                ),
              }))}
            />
          )}
        </Card>
      )}
      <Drawer
        title={
          confirmation
            ? `${labels[confirmation.action]}资源`
            : "选择本次履约资源"
        }
        open={open}
        onClose={() => setOpen(false)}
        size={860}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={mutation.isPending}
              disabled={confirmation ? !reason.trim() : !candidates.data}
              onClick={submit}
            >
              {confirmation ? "确认操作" : "保存分配"}
            </Button>
          </Space>
        }
      >
        {!confirmation && (
          <QueryState loading={candidates.isLoading} error={candidates.error}>
            <Space orientation="vertical" style={{ width: "100%" }} size={16}>
              {candidates.data?.reservations.map((r) => (
                <Card
                  key={r.reservationId}
                  size="small"
                  title={`${r.itemGroupName} · 需要 ${r.quantity} · 已分配 ${r.assignedQuantity}`}
                >
                  <Select
                    aria-label="履约型号"
                    style={{ width: "100%", marginBottom: 12 }}
                    value={
                      selection[r.reservationId]?.itemGroupId ?? r.itemGroupId
                    }
                    options={r.models.map((m) => ({
                      value: m.itemGroupId,
                      label: m.name,
                      disabled:
                        !m.enabled ||
                        (!canReassign && m.itemGroupId !== r.itemGroupId),
                    }))}
                    onChange={(itemGroupId) =>
                      setSelection((s) => ({
                        ...s,
                        [r.reservationId]: { itemGroupId },
                      }))
                    }
                  />
                  {r.inventoryMode === RentalInventoryMode.Serialized ? (
                    <Select
                      mode="multiple"
                      style={{ width: "100%" }}
                      placeholder="选择实际资产；不可用项会说明原因"
                      value={selection[r.reservationId]?.assetIds ?? []}
                      onChange={(assetIds) =>
                        setSelection((s) => ({
                          ...s,
                          [r.reservationId]: {
                            ...s[r.reservationId],
                            assetIds,
                          },
                        }))
                      }
                      options={r.candidates
                        .filter(
                          (c) =>
                            c.itemGroupId ===
                            (selection[r.reservationId]?.itemGroupId ??
                              r.itemGroupId),
                        )
                        .map((c) => ({
                          value: c.assetId,
                          label: `${c.assetNo}${c.reason ? ` · ${c.reason}` : ""}`,
                          disabled: !c.available,
                        }))}
                    />
                  ) : (
                    <InputNumber
                      min={1}
                      max={r.quantity}
                      precision={0}
                      placeholder="分配数量"
                      value={selection[r.reservationId]?.quantity}
                      onChange={(quantity) =>
                        setSelection((s) => ({
                          ...s,
                          [r.reservationId]: {
                            ...s[r.reservationId],
                            quantity: quantity ?? undefined,
                          },
                        }))
                      }
                    />
                  )}
                  <p className="muted">
                    未选择的明细保持不变。可在下单时定价组范围内切换型号，每条预留选择一种型号；库存预留同步转移，订单价格不变。跨型号或更换已锁定资源需改配权限与原因。
                  </p>
                </Card>
              ))}
            </Space>
          </QueryState>
        )}
        <p>操作原因{confirmation && "（必填）"}</p>
        <Input.TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="解锁、释放、改配请说明原因"
          rows={3}
        />
      </Drawer>
    </>
  );
}
