import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Space, Tag } from "antd";
import styles from "./TenantReadiness.module.css";
import { Alert } from "@/components/ui";
import { Button } from "@/components/ui";
import { CheckCircleFilled, RightOutlined, WarningFilled } from "@/components/ui/icons";
import type { TenantReadinessStatus } from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";

/**
 * TENANT-READY-01：空白/半配置租户的开业配置状态页。
 *
 * 状态由服务端按当前租户 + 当前经营空间权威判定；本页只渲染结果并提供跳转，
 * 不回落 demo 或共享默认数据，也不在前端伪造完成状态。报价/下单侧的硬拦截
 * 由服务端独立执行（本页只转述 quoteBlockers）。
 */

const STATUS_META: Record<TenantReadinessStatus["status"], { label: string; color: string }> = {
  not_started: { label: "未开始", color: "default" },
  configuring: { label: "配置中", color: "processing" },
  completed: { label: "已完成", color: "success" }
};

export function TenantReadinessPage() {
  const { t } = useLocale();
  const readiness = useQuery({
    queryKey: ["rental-core", "tenant-readiness"],
    queryFn: rentalCoreApi.tenantReadiness
  });

  if (readiness.isLoading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}><LoadingState /></div>
    );
  }

  if (readiness.error || !readiness.data) {
    return (
      <PageHeader
        title={t("开业配置")}
        view={<Alert type="error" showIcon title={t("数据暂不可用，请稍后重试")} />}
        extra={<Button onClick={() => readiness.refetch()}>{t("重试")}</Button>}
      />
    );
  }

  return (
    <PageHeader
      title="开业配置"
      view={<TenantReadinessBody data={readiness.data} onRefresh={() => readiness.refetch()} />}
    />
  );
}

export function TenantReadinessBody({ data, onRefresh }: { data: TenantReadinessStatus; onRefresh: () => void }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const statusMeta = STATUS_META[data.status];
  // 「未完成」与「会被服务端拦截」必须分开数：可暂缓项（optional）缺失不阻止开业，
  // 真正拦报价的是 quoteBlockers。把可选项混进拦截文案会制造服务端不存在的闸门。
  const blockingItems = data.items.filter((item) => !item.done && !item.optional);
  const optionalMissing = data.items.filter((item) => !item.done && item.optional && !item.unavailable);
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type={data.ready ? "success" : "warning"}
        showIcon
        icon={data.ready ? <CheckCircleFilled /> : <WarningFilled />}
        title={
          data.ready
            ? `${t("开业配置已完成，可以进行报价与订单")}${optionalMissing.length ? `（${optionalMissing.map((item) => t(item.title)).join("、")}${t("可暂缓")}）` : ""}`
            : `${t("开业配置")}${t(statusMeta.label)}：${t("还有")} ${blockingItems.length} ${t("项必做配置未完成")}`
        }
        description={
          data.ready
            ? undefined
            : data.quoteBlockers.length
              ? `${t("在缺项补齐前，服务端会拦截报价与订单确认：")}${data.quoteBlockers.map((item) => t(item)).join("、")}。`
              : `${t("当前缺失：")}${blockingItems.map((item) => t(item.title)).join("、")}。`
        }
      />
      <ul className={styles.checklist}>
      {data.items.map((item) => (
        <li key={item.key} className={styles.item}>
          <div className={styles.indicator} data-done={item.done || undefined}>
            {item.done ? <CheckCircleFilled role="img" aria-label={t("已完成")} /> : <WarningFilled role="img" aria-label={t("未完成")} />}
          </div>
          <div className={styles.copy}>
            <div className={styles.title}><strong>{t(item.title)}</strong>
              {!item.done && <Tag color={item.unavailable ? "default" : "warning"}>{item.unavailable ? t("待重试") : item.optional ? t("可暂缓") : t("未完成")}</Tag>}
            </div>
            {(item.done ? item.summary : item.missing) && <p>{t((item.done ? item.summary : item.missing)!)}</p>}
          </div>
            <Button type="link" onClick={() => item.unavailable ? onRefresh() : navigate(item.nextHref)}>
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
