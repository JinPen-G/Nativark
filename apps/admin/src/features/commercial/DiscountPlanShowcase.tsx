/**
 * 负责：优惠方案的 Spotlight 规则卡、原地详情和本地演示操作。
 * 不负责：任何服务端写入；发布/停用只改当前页面内存，刷新后恢复。
 * 接入后端时保留本组件的 rows 结构，替换数据来源和按钮回调即可。
 */
import { useEffect, useMemo, useState } from "react";
import { App, Typography } from "antd";
import { motion } from "motion/react";
import { ArrowRight, CalendarRange, History, PencilLine, Power, Send, ShieldCheck } from "lucide-react";
import { useLocale } from "@/app/locale";
import { Accordion, ListFilterBar, ListFilters, ListSection, useListFilter } from "@/components/ui";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { Button } from "@/registry/components/button/button";
import { SpotlightGrid } from "./archive/spotlight-grid/original";
import "./archive/spotlight-grid/original.css";
import { DISCOUNT_PLAN_DEMO_ROWS, type DiscountPlanRow, type DiscountPlanRule, type DiscountPlanStatus, type DiscountRulePricing } from "./discountPlanDemo";
import styles from "./discountPlanShowcase.module.css";

type Translate = ReturnType<typeof useLocale>["t"];
type Money = (value: number | undefined) => string;
type PlanCard = DiscountPlanRow & { title: string; blurb: string; wide?: boolean };

const RULE_STEP_MS = 2400;
const STATUS_LABELS: Record<DiscountPlanStatus, string> = { draft: "草稿", enabled: "已启用", disabled: "已停用" };
const VISIBLE_CONDITIONS = 3;

function rateLabel(rate: number, english: boolean, t: Translate) {
  if (english) return `${100 - rate}% off`;
  return t("{value} 折", { value: Number((rate / 10).toFixed(2)) });
}

function pricingHeadline(pricing: DiscountRulePricing, money: Money, english: boolean, t: Translate) {
  if (pricing.mode === "discount") return rateLabel(pricing.rate, english, t);
  if (pricing.mode === "minus") return `${t("减")} ${money(pricing.amount)}`;
  if (pricing.mode === "fixed") return t("{price}/天", { price: money(pricing.dailyPrice) });
  return `${t("平日")} ${rateLabel(pricing.weekdayRate, english, t)} · ${t("假日")} ${rateLabel(pricing.holidayRate, english, t)}`;
}

function rentalDaysLabel(days: DiscountPlanRule["rentalDays"], t: Translate) {
  if (!days) return undefined;
  if (days.minimum !== undefined && days.maximum !== undefined) return t("{minimum}–{maximum} 天", { minimum: days.minimum, maximum: days.maximum });
  if (days.minimum !== undefined) return t("{minimum} 天起", { minimum: days.minimum });
  return days.maximum !== undefined ? t("最多 {maximum} 天", { maximum: days.maximum }) : undefined;
}

function ruleConditions(rule: DiscountPlanRule, t: Translate) {
  const unlimited = t("不限");
  return [
    { key: "order", label: t("下单时间"), value: rule.orderWindow, chip: rule.orderWindow && t("下单 {value}", { value: rule.orderWindow }) },
    { key: "use", label: t("用车时间"), value: rule.useWindow, chip: rule.useWindow && t("用车 {value}", { value: rule.useWindow }) },
    { key: "advance", label: t("提前预订"), value: rule.advanceDays === undefined ? undefined : t("提前 {days} 天", { days: rule.advanceDays }), chip: rule.advanceDays === undefined ? undefined : t("提前 {days} 天", { days: rule.advanceDays }) },
    { key: "rental", label: t("租期"), value: rentalDaysLabel(rule.rentalDays, t), chip: rentalDaysLabel(rule.rentalDays, t) && t("租期 {value}", { value: rentalDaysLabel(rule.rentalDays, t) ?? "" }) },
    { key: "group", label: t("型号组"), value: rule.modelGroups.join("、"), chip: rule.modelGroups.join("、") },
    { key: "pickup", label: t("取车地点"), value: rule.pickupLocations.join("、"), chip: rule.pickupLocations.length ? t("{value} 取车", { value: rule.pickupLocations.join("、") }) : undefined },
    { key: "return", label: t("还车地点"), value: rule.returnLocations.join("、"), chip: undefined },
    { key: "member", label: t("会员资格"), value: rule.membership.join("、"), chip: rule.membership.join("、") || undefined },
  ].map(item => ({ ...item, value: item.value || unlimited }));
}

function pricingDetail(pricing: DiscountRulePricing, money: Money, english: boolean, t: Translate) {
  const cap = pricing.mode === "discount" || pricing.mode === "split" ? pricing.maximumDiscount : undefined;
  const capRow = cap === undefined ? [] : [{ label: t("抵扣上限"), value: money(cap) }];
  if (pricing.mode === "discount") return [{ label: t("优惠类型"), value: t("折扣") }, { label: t("定价模式"), value: t("统一价") }, { label: t("折扣力度"), value: rateLabel(pricing.rate, english, t) }, ...capRow];
  if (pricing.mode === "minus") return [{ label: t("优惠类型"), value: t("直减") }, { label: t("定价模式"), value: t("统一价") }, { label: t("立减金额"), value: money(pricing.amount) }];
  if (pricing.mode === "fixed") return [{ label: t("优惠类型"), value: t("一口价") }, { label: t("定价模式"), value: t("统一价") }, { label: t("日租价"), value: t("{price}/天", { price: money(pricing.dailyPrice) }) }];
  return [
    { label: t("优惠类型"), value: t("折扣") }, { label: t("定价模式"), value: t("平假分开") },
    { label: t("平日（周一至周四）"), value: rateLabel(pricing.weekdayRate, english, t) }, { label: t("假日（周五至周日）"), value: rateLabel(pricing.holidayRate, english, t) },
    ...(pricing.statutoryRate === undefined ? [] : [{ label: t("法定节假日"), value: rateLabel(pricing.statutoryRate, english, t) }]), ...capRow,
  ];
}

function StatusMark({ status, t }: { status: DiscountPlanStatus; t: Translate }) {
  return <span className={styles.status} data-status={status}><i aria-hidden="true" />{t(STATUS_LABELS[status])}</span>;
}

function RuleTicker({ plan, active, money, english, t }: { plan: PlanCard; active: boolean; money: Money; english: boolean; t: Translate }) {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const cycling = active && !reduced && plan.rules.length > 1;
  const current = cycling ? step % plan.rules.length : 0;

  useEffect(() => {
    if (!cycling) return;
    const timer = window.setInterval(() => setStep(value => value + 1), RULE_STEP_MS);
    return () => { window.clearInterval(timer); setStep(0); };
  }, [cycling]);

  return <div className={styles.mini} data-wide={plan.wide || undefined} data-status={plan.status}>
    <div className={styles.miniHead}>
      <StatusMark status={plan.status} t={t} />
      <span className={styles.miniMeta}>{t("优先级 {value}", { value: plan.priority })}</span>
    </div>
    <div className={styles.ticker}>
      {plan.rules.map((rule, index) => {
        const conditions = ruleConditions(rule, t).flatMap(item => item.chip ? [item.chip] : []);
        const shown = index === current;
        return <motion.div key={rule.id} className={styles.rule} initial={false} animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : index > current ? 10 : -10 }} transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: .42, bounce: 0 }}>
          <div className={styles.ruleConditions}>
            <span className={styles.ruleName}>{rule.name}</span>
            <span className={styles.chips}>
              {conditions.slice(0, VISIBLE_CONDITIONS).map(item => <span key={item}>{item}</span>)}
              {conditions.length > VISIBLE_CONDITIONS ? <span>+{conditions.length - VISIBLE_CONDITIONS}</span> : null}
            </span>
          </div>
          <ArrowRight className={styles.ruleArrow} size={18} strokeWidth={1.5} aria-hidden="true" />
          <strong className={styles.ruleValue} data-split={rule.pricing.mode === "split" || undefined}>{pricingHeadline(rule.pricing, money, english, t)}</strong>
        </motion.div>;
      })}
    </div>
    <div className={styles.progress} aria-hidden="true">
      {plan.rules.map((rule, index) => <span key={rule.id}>
        <motion.i initial={false} animate={{ scaleX: index <= current ? 1 : 0 }} transition={reduced ? { duration: 0 } : cycling && index === current ? { duration: .32, ease: "easeOut" } : { duration: .16 }} />
      </span>)}
      <em>{t("共 {count} 条规则", { count: plan.rules.length })}</em>
    </div>
  </div>;
}

function Facts({ items }: { items: Array<{ label: string; value: string }> }) {
  return <dl className={styles.facts}>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

function PlanDetail({ plan, money, english, t, onStatus, onEdit }: { plan: PlanCard; money: Money; english: boolean; t: Translate; onStatus: (plan: PlanCard, status: DiscountPlanStatus) => void; onEdit: () => void }) {
  const statusAction = plan.status === "enabled"
    ? { label: t("停用"), icon: <Power size={15} aria-hidden="true" />, next: "disabled" as const, variant: "secondary" as const }
    : { label: t(plan.status === "draft" ? "发布" : "重新启用"), icon: <Send size={15} aria-hidden="true" />, next: "enabled" as const, variant: "primary" as const };
  return <div className={styles.detail}>
    <div className={styles.detailBar}>
      <StatusMark status={plan.status} t={t} />
      <span className={styles.detailVersion}>{plan.code} · {plan.versions[0]?.version}</span>
      <span className={styles.detailActions}>
        <Button variant="secondary" size="sm" onClick={onEdit}><PencilLine size={15} aria-hidden="true" />{t("编辑")}</Button>
        <Button variant={statusAction.variant} size="sm" onClick={() => onStatus(plan, statusAction.next)}>{statusAction.icon}{statusAction.label}</Button>
      </span>
    </div>
    <Facts items={[
      { label: t("展示名称"), value: plan.displayName },
      { label: t("有效期"), value: `${plan.validFrom} ~ ${plan.validTo}` },
      { label: t("优先级"), value: String(plan.priority) },
      { label: t("业务线"), value: plan.businessLines.join("、") },
      { label: t("客户群体"), value: plan.customerGroups.join("、") },
      { label: t("支付卡种"), value: plan.cardSchemes.join("、") },
    ]} />
    {plan.onsiteVerification ? <p className={styles.verification}><ShieldCheck size={16} aria-hidden="true" />{t("取车时需现场核验：{qualification}（{proof}）", plan.onsiteVerification)}</p> : null}
    <section className={styles.detailSection}>
      <h4>{t("规则明细")}<span>{plan.rules.length}</span></h4>
      <Accordion defaultOpen={0} items={plan.rules.map((rule, index) => ({
        key: rule.id,
        title: <span className={styles.accordionTitle}><em>{t("规则 {index}", { index: index + 1 })}</em><span>{rule.name}</span><strong>{pricingHeadline(rule.pricing, money, english, t)}</strong></span>,
        content: <div className={styles.ruleBody}>
          <div><h5>{t("触发条件")}</h5><Facts items={ruleConditions(rule, t).map(item => ({ label: item.label, value: item.value }))} /></div>
          <div className={styles.ruleOutcome}><h5>{t("优惠动作")}</h5><Facts items={pricingDetail(rule.pricing, money, english, t)} /></div>
        </div>,
      }))} />
    </section>
    <section className={styles.detailSection}>
      <h4><History size={15} aria-hidden="true" />{t("历史版本")}<span>{plan.versions.length}</span></h4>
      <ol className={styles.versions}>
        {plan.versions.map(version => <li key={version.version}>
          <strong>{version.version}</strong>
          <span>{version.note}</span>
          {version.current ? <em>{t("当前")}</em> : null}
          <time><CalendarRange size={13} aria-hidden="true" />{version.savedAt} · {version.savedBy}</time>
        </li>)}
      </ol>
    </section>
    <p className={styles.matchNote}>{t("默认不叠加：按优先级匹配，相同优先级取优惠力度最大的方案，客户可手动改选。")}</p>
  </div>;
}

export function DiscountPlanShowcase({ money }: { money: Money }) {
  const { locale, t } = useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState(DISCOUNT_PLAN_DEMO_ROWS);
  const filter = useListFilter(rows, { fields: row => [row.name, row.displayName, row.code], status: row => row.status });
  const english = locale === "en-US";
  const filtered = filter.rows;
  const cards = useMemo<PlanCard[]>(() => filtered.map((row, index) => ({
    ...row,
    title: row.name,
    blurb: `${row.displayName} · ${row.validFrom} ~ ${row.validTo} · ${row.businessLines.join("、")}`,
    wide: index % 4 === 0 || index % 4 === 3,
  })), [filtered]);

  const showEditNotice = () => message.info(t("演示版：多规则编辑待后端接入，未保存任何内容"));
  const changeStatus = (plan: PlanCard, status: DiscountPlanStatus) => {
    setRows(current => current.map(row => row.id === plan.id ? { ...row, status } : row));
    message.info(t("演示状态已切换，未写入服务端，刷新后恢复"));
  };

  return <ListSection>
    <div className={styles.toolbar}>
      <div className={styles.filters}><ListFilterBar><ListFilters filter={filter} placeholder="优惠名称或编码" options={[{ value: "draft", label: "草稿" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "已停用" }]} /></ListFilterBar></div>
      <Typography.Text type="secondary" className={styles.demoNote}>{t("演示数据，未接入后端")}</Typography.Text>
    </div>
    <div className={styles.host}>
      {cards.length ? <SpotlightGrid
        cards={cards}
        label={t("优惠方案")}
        closeLabel={t("关闭")}
        renderMini={(plan, active) => <RuleTicker plan={plan} active={active} money={money} english={english} t={t} />}
        renderDetail={plan => <PlanDetail plan={plan} money={money} english={english} t={t} onStatus={changeStatus} onEdit={showEditNotice} />}
      /> : <Typography.Text type="secondary">{t("没有符合条件的优惠方案")}</Typography.Text>}
    </div>
  </ListSection>;
}
