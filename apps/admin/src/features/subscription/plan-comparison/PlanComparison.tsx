"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { animate, AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import { Switch } from "@/registry/components/switch/switch";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "@/registry/blocks/plan-comparison/plan-comparison.module.css";
import { FeatureOwnership, FeatureReleaseStatus, SubscriptionPlan, type StandardPlanPricing, type SubscriptionFeatureCatalogEntry } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { usePrefersReducedMotion as useReducedMotion } from "@/lib/usePrefersReducedMotion";
import { PLAN_LABEL, RELEASE_STATUS_LABEL } from "../subscriptionLabels";
import './integration.css';

type Plan = SubscriptionPlan;
export type ComparisonFeature = Pick<SubscriptionFeatureCatalogEntry, 'code' | 'name' | 'module' | 'categories' | 'currentOwnership' | 'releaseStatus' | 'valueText' | 'prerequisiteText' | 'externalFeeNote'> & { hasTenantGrant?: boolean };
interface Props {
  features: ComparisonFeature[];
  prices: StandardPlanPricing[];
  currentPlan?: Plan;
  onAction?: (plan: Plan) => void;
  actionLabel?: (plan: Plan) => string;
  actionDisabled?: boolean;
}

function Value({ feature, plan }: { feature: ComparisonFeature; plan: Plan }) {
  const { t } = useLocale();
  if (!Object.values(FeatureOwnership).includes(feature.currentOwnership)) return <span className={styles.unavailable}>{t("待平台确认")}</span>;
  const belongs = feature.currentOwnership === FeatureOwnership.Standard || plan === SubscriptionPlan.Pro;
  if (!belongs) return <span className={styles.unavailable}>{t("不包含")}</span>;
  if (feature.releaseStatus !== FeatureReleaseStatus.Released)
    return <span className={styles.unavailable}>{t(RELEASE_STATUS_LABEL[feature.releaseStatus] ?? "待平台确认")}</span>;
  return <span className={styles.included}><Check size={16} strokeWidth={1.75} aria-hidden="true" />{t("已包含")}</span>;
}

function AnimatedNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    if (reduce) {
      previousValue.current = value;
      return;
    }

    const controls = animate(previousValue.current, value, {
      duration: motionTokens.duration.standard,
      ease: [...motionTokens.ease.enter],
      onUpdate: (latest) => setDisplayValue(Math.round(latest)),
    });

    previousValue.current = value;
    return () => controls.stop();
  }, [reduce, value]);

  return <>{reduce ? value : displayValue}</>;
}

export function PlanComparison({ features, prices, currentPlan, onAction, actionLabel, actionDisabled }: Props) {
  const { t, locale } = useLocale();
  const id = useId();
  const reduce = useReducedMotion();
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [selected, setSelected] = useState<Plan | null>(currentPlan ?? null);
  const rootRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<"lg" | "md" | "sm" | "xs">("lg");
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const measure = (width: number) => setSize(width <= 340 ? "xs" : width <= 540 ? "sm" : width <= 720 ? "md" : "lg");
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const visibleFeatures = differencesOnly ? features.filter((feature) => feature.currentOwnership !== FeatureOwnership.Standard) : features;

  return (
    <section ref={rootRef} className={`${styles.comparison} subscription-comparison`} data-size={size} aria-labelledby={`${id}-title`}>
      <div className={styles.intro}>
        <div><h2 id={`${id}-title`}>{t("基础版与 PRO")}</h2><p>{t("比较功能权益，选择适合的版本。")}</p></div>
        <div className={styles.billing}><span>{t("按年订阅")}</span><small>{t("标准套餐年费")}</small></div>
      </div>

      <div className={styles.filter}><div><h3>{t("功能对比")}</h3><span className={styles.featureCount}><AnimatedNumber value={visibleFeatures.length} /> / {features.length} {t("项权益")}</span></div><Switch checked={differencesOnly} onCheckedChange={setDifferencesOnly} label={t("只看差异")} /></div>

      <div className={styles.matrix} role="table" aria-label={t("基础版与 PRO 功能对比")}>
        <div className={styles.planHeader} role="row">
          <div className={styles.featureHeader} role="columnheader">{t("功能权益")}</div>
          {([SubscriptionPlan.Standard, SubscriptionPlan.Pro] as const).map((plan) => {
            const price = prices.find(price => price.plan === plan);
            const money = price?.published && price.annualFee && Number.isFinite(price.annualFee.amount) ? price.annualFee : null;
            return (
            <div key={plan} className={`${styles.planCell} ${selected === plan ? styles.planSelected : ""}`} role="columnheader" aria-label={t(PLAN_LABEL[plan])}>
              <div className={styles.planTop}><h3>{t(PLAN_LABEL[plan])}</h3><span>{t(plan === SubscriptionPlan.Standard ? "基础租赁经营" : "专业业务扩展")}</span></div>
              <div className={styles.price}><span className={styles.priceValue} aria-live="polite" aria-atomic="true">{money ? <><span className="subscription-price-currency">{money.currency}</span>{new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(money.amount)}</> : t("价格待公布")}</span>{money && <span className={styles.pricePeriod}>{t("/ 年")}</span>}</div>
              {(money?.taxInclusive !== undefined || price?.note) && <span className="subscription-price-note">{[money?.taxInclusive !== undefined ? t(money.taxInclusive ? "含税" : "未税") : null, price?.note].filter(Boolean).join(" · ")}</span>}
              <Button type="button" data-rental-arc-button="" data-button-kind={selected === plan ? "primary" : "default"} variant={selected === plan ? "primary" : "secondary"} className={styles.selectButton} aria-pressed={selected === plan} onClick={() => setSelected(current => current === plan ? null : plan)}>{selected === plan ? t(currentPlan === plan ? "当前版本" : "已选择") : t("选择{plan}", { plan: t(PLAN_LABEL[plan]) })}</Button>
              {selected === plan && <motion.span className={styles.selectedRail} layoutId={`${id}-selected-rail`} transition={reduce ? { duration: 0 } : motionTokens.spring.responsive} aria-hidden="true" />}
            </div>
          ); })}
        </div>

        <div className={styles.rows} role="rowgroup">
          {!visibleFeatures.length && <div role="row"><div role="cell" aria-colspan={size === 'sm' || size === 'xs' ? 2 : 3} className="subscription-comparison-empty">{t(differencesOnly && features.length ? "当前权益没有版本差异" : "功能目录尚未发布")}</div></div>}
          <AnimatePresence initial={false}>
            {visibleFeatures.map((feature) => (
              <motion.div key={feature.code} className={styles.featureRow} role="row" initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? undefined : { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } } }} transition={reduce ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter], delay: .04 } }}>
                <div className={styles.featureName} role="rowheader">{<div className="subscription-comparison-feature"><span>{feature.name}</span>{(feature.valueText || feature.prerequisiteText || feature.externalFeeNote || feature.hasTenantGrant) && <small>{[feature.valueText, feature.prerequisiteText, feature.externalFeeNote, feature.hasTenantGrant ? t("本租户额外授权") : null].filter(Boolean).join(" · ")}</small>}</div>}</div>
                <div className={`${styles.featureValue} ${selected === SubscriptionPlan.Standard ? styles.valueSelected : ""}`} role="cell"><span className={styles.mobilePlan}>{t("基础版")}</span><Value feature={feature} plan={SubscriptionPlan.Standard} /></div>
                <div className={`${styles.featureValue} ${selected === SubscriptionPlan.Pro ? styles.valueSelected : ""}`} role="cell"><span className={styles.mobilePlan}>PRO</span><Value feature={feature} plan={SubscriptionPlan.Pro} /></div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className={styles.footer}><span>{t("试点、规划中功能不计入当前交付；外部服务费用另计。")}</span>{selected && actionLabel && onAction && <Button type="button" data-rental-arc-button="" data-button-kind="primary" variant="primary" disabled={actionDisabled} onClick={() => onAction(selected)}>{actionLabel(selected)}</Button>}<p className={styles.srOnly} role="status" aria-live="polite">{selected ? `${t(PLAN_LABEL[selected])} ${t("已选择")}` : ""}</p></div>
    </section>
  );
}

export default PlanComparison;

