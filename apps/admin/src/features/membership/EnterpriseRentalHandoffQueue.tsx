/** Read one original authorized order page; not a global request count or bulk command.
 * Queue material only locates a request. The original detail must be read before review. */
import { useEffect, useRef, useState } from "react";
import { enterpriseRentalHandoffMerchantQueueSnapshot, type EnterpriseRentalHandoffMerchantQueue } from "@rental-os/shared";
import { ActionButton, Alert, Table } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";
export function EnterpriseRentalHandoffQueue({ onLocate }: { onLocate: (id: string) => void }) {
  const operation = useOriginalEnterpriseOperation("enterprise-rental-handoff"), auth = useAuthStore(), { t } = useLocale();
  const [queue, setQueue] = useState<{ identity: string; value: EnterpriseRentalHandoffMerchantQueue }>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef({ epoch: 0, busy: false }), latest = useRef(queue); latest.current = queue;
  const permitted = Boolean(auth.sessionVerified && auth.currentWorkspaceId && auth.hasPermission("rental-os:corporate:manage") && auth.hasPermission("rental-os:order:view") && (auth.user?.isPlatformAdmin || auth.user?.dataScope === "all"));
  const visible = permitted && !busy && !error && queue?.identity === operation.identity ? queue : undefined;
  const assertPermission = () => { operation.assertCurrent(); const current = useAuthStore.getState(); if (!current.sessionVerified || !current.currentWorkspaceId || !current.hasPermission("rental-os:corporate:manage") || !current.hasPermission("rental-os:order:view") || !current.user?.isPlatformAdmin && current.user?.dataScope !== "all") throw new Error(t("当前商户或订单权限不可用")); };
  useEffect(() => { request.current.epoch++; request.current.busy = false; latest.current = undefined; setQueue(undefined); setBusy(false); setError(""); }, [operation.identity]);
  useEffect(() => () => { request.current.epoch++; request.current.busy = false; latest.current = undefined; }, []);
  const readPage = async (page: number) => {
    assertPermission(); if (request.current.busy || !Number.isSafeInteger(page) || page < 1 || page > 999999) throw new Error(t("原订单页码无效"));
    const epoch = ++request.current.epoch; request.current.busy = true; latest.current = undefined; setQueue(undefined); setBusy(true); setError("");
    try {
      const value = enterpriseRentalHandoffMerchantQueueSnapshot(await operation.read(`/rental/v1/enterprise-handoff-requests?page=${page}`));
      assertPermission(); if (epoch !== request.current.epoch || !value || value.orderPage.page !== page) throw new Error(t("原交接队列不可核对"));
      setQueue({ identity: operation.identity, value });
    } catch (e) { if (epoch === request.current.epoch) setError(t("原交接队列不可核对")); throw e; }
    finally { if (epoch === request.current.epoch) { request.current.busy = false; setBusy(false); } }
  };
  const move = async (delta: number) => { assertPermission(); if (!visible || latest.current !== visible || request.current.busy) throw new Error(t("原交接队列不可核对")); await readPage(visible.value.orderPage.page + delta); };
  return <section aria-label={t("受权原订单页交接待核对")}>
    <Alert type="info" title={t("受权原订单页交接待核对")} description={t("按当前受权原订单逐页读取；订单总数不是交接待办总数，本页为空不代表其他订单页没有申请。")}/>
    <ActionButton intent="review" label={t("读取首个受权订单页")} disabled={!permitted || busy || operation.busy} onAction={() => readPage(1)}/>
    {error && <Alert type="warning" title={error} description={t("队列失败不影响已知原申请或原处理收据的独立核对。")}/>}
    {visible && <><p>{t("受权原订单页码")} {visible.value.orderPage.page} / {t("受权原订单总数")} {visible.value.orderPage.total}</p>
      {visible.value.items.length === 0 && <p>{t("本订单页没有待核对申请，请核对后续受权订单页。")}</p>}
      <Table rowKey="id" dataSource={visible.value.items} sorting={false} pagination={false} columns={[
        { title: t("原订单"), render: (_, row) => row.material.orderNo }, { title: t("原交接申请引用"), dataIndex: "id" },
        { title: t("原申请原因"), dataIndex: "reason" }, { title: t("操作"), render: (_, row) => <ActionButton intent="review" label={t("定位原申请")} disabled={operation.busy} onAction={async () => { assertPermission(); if (latest.current !== visible || request.current.busy) throw new Error(t("原交接队列不可核对")); onLocate(row.id); }}/> }
      ]}/>
      <ActionButton intent="review" label={t("上一受权订单页")} disabled={visible.value.orderPage.page <= 1 || operation.busy} onAction={() => move(-1)}/>
      <ActionButton intent="review" label={t("下一受权订单页")} disabled={visible.value.orderPage.page * 50 >= visible.value.orderPage.total || operation.busy} onAction={() => move(1)}/>
    </>}
  </section>;
}
