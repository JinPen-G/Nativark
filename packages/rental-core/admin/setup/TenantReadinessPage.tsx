/** 开业页呈现服务端就绪事实和原报价阻塞项，下一入口使用当前受权的登记页面。 */
import { useQuery } from "@tanstack/react-query";
import { Space, Tag } from "antd";
import { corePageKey, resolveCorePageLocation } from "@rental-os/core-contracts";
import { CorePage, useCorePageHost } from "@rental-os/platform-admin/core";
import { Alert, Button, useFeedback } from "@rental-os/platform-admin/ui";
import { CheckCircleFilled, RightOutlined, WarningFilled } from "@rental-os/platform-admin/ui";
import { LoadingState } from "@rental-os/platform-admin/shell";
import { useLocale } from "@rental-os/platform-admin/locale";
import type { TenantReadinessItem, TenantReadinessStatus } from "@rental-os/rental-core";
import { useRentalSetupContext } from "./page-context";
import { rentalSetupItemTarget } from "./navigation";
import styles from "./TenantReadiness.module.css";

const STATUS_META: Record<TenantReadinessStatus["status"], { label: string; color: string }> = {
  not_started: { label: "未开始", color: "default" },
  configuring: { label: "配置中", color: "processing" },
  completed: { label: "已完成", color: "success" },
};

export function TenantReadinessPage() {
  const { t } = useLocale();
  const { api, queryScope } = useRentalSetupContext();
  const readiness = useQuery({
    queryKey: ["rental-core", "tenant-readiness", queryScope],
    queryFn: ({ signal }) => api.tenantReadiness(signal),
  });

  if (readiness.isLoading) {
    return <div style={{ textAlign: "center", padding: 80 }}><LoadingState /></div>;
  }
  if (readiness.error || !readiness.data) {
    return <CorePage view={<Alert type="error" showIcon title={t("数据暂不可用，请稍后重试")}
      action={<Button onClick={() => readiness.refetch()}>{t("重试")}</Button>} />}>{null}</CorePage>;
  }
  return <CorePage view={<TenantReadinessBody data={readiness.data}
    onRefresh={() => readiness.refetch()} />}>{null}</CorePage>;
}

export function TenantReadinessBody({ data, onRefresh }: {
  data: TenantReadinessStatus;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const { toast } = useFeedback();
  const host = useCorePageHost();
  const context = useRentalSetupContext();
  const statusMeta = STATUS_META[data.status];
  const blockingItems = data.items.filter(item => !item.done && !item.optional);
  const optionalMissing = data.items.filter(item => !item.done && item.optional && !item.unavailable);

  const canOpenItem = (item: TenantReadinessItem) => {
    const target = rentalSetupItemTarget(item);
    if (!target || !context.isCurrent()) return false;
    if (target.kind === "accounts") return Boolean(context.accounts?.canOpen());
    const page = host.pages.get(corePageKey(target.to.coreId, target.to.pageId));
    return Boolean(page && host.canAccess(page.coreId, page.definition.permissions));
  };
  const openItem = (item: TenantReadinessItem) => {
    try {
      const target = rentalSetupItemTarget(item);
      if (!target || !canOpenItem(item)) throw new Error("当前页面不可用");
      if (target.kind === "accounts") context.accounts!.open();
      else host.navigate(resolveCorePageLocation(host.pages, target.to));
    } catch {
      if (context.isCurrent()) toast({ type: "error", title: t("当前页面不可用") });
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type={data.ready ? "success" : "warning"}
        showIcon
        icon={data.ready ? <CheckCircleFilled /> : <WarningFilled />}
        title={
          data.ready
            ? `${t("开业配置已完成，可以进行报价与订单")}${optionalMissing.length ? `（${optionalMissing.map(item => t(item.title)).join("、")}${t("可暂缓")}）` : ""}`
            : `${t("开业配置")}${t(statusMeta.label)}：${t("还有")} ${blockingItems.length} ${t("项必做配置未完成")}`
        }
        description={
          data.ready
            ? undefined
            : data.quoteBlockers.length
              ? `${t("在缺项补齐前，服务端会拦截报价与订单确认：")}${data.quoteBlockers.map(item => t(item)).join("、")}。`
              : `${t("当前缺失：")}${blockingItems.map(item => t(item.title)).join("、")}。`
        }
      />
      <ul className={styles.checklist}>
        {data.items.map(item => (
          <li key={item.key} className={styles.item}>
            <div className={styles.indicator} data-done={item.done || undefined}>
              {item.done ? <CheckCircleFilled role="img" aria-label={t("已完成")} />
                : <WarningFilled role="img" aria-label={t("未完成")} />}
            </div>
            <div className={styles.copy}>
              <div className={styles.title}><strong>{t(item.title)}</strong>
                {!item.done && <Tag color={item.unavailable ? "default" : "warning"}>
                  {item.unavailable ? t("待重试") : item.optional ? t("可暂缓") : t("未完成")}
                </Tag>}
              </div>
              {(item.done ? item.summary : item.missing) && <p>{t((item.done ? item.summary : item.missing)!)}</p>}
            </div>
            <Button type="link" disabled={!item.unavailable && !canOpenItem(item)}
              onClick={() => item.unavailable ? onRefresh() : openItem(item)}>
              {item.unavailable ? t("重试") : item.done ? t("查看") : t("去配置")}
              <RightOutlined />
            </Button>
          </li>
        ))}
      </ul>
      <Button onClick={onRefresh}>{t("刷新状态")}</Button>
    </Space>
  );
}
