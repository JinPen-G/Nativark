import { useMemo } from "react";
import { useLocale } from "@/app/locale";
import { BusinessTrend, InsightSection } from "@/components/BusinessInsights";

export function MemberListInsights({ rows }: { rows: { customerId: string; name: string; createdAt: string }[] }) {
  const { t } = useLocale();
  const months = useMemo(() => {
    const at = new Date();
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 5 + index, 1)).toISOString().slice(0, 7);
      return { month, value: rows.filter(row => row.createdAt.slice(0, 7) === month).length };
    });
  }, [rows]);
  return <details className="list-analysis-disclosure"><summary>{t("会员增长")}</summary><InsightSection title={t("会员增长")} description={t("当前筛选范围内的新建会员，按 UTC 月份分组；当月尚未结束。") }>
    <BusinessTrend data={months} label={t("新增会员")} unit={t("位")} />
  </InsightSection></details>;
}
