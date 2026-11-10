/** Member plan cards describe the configured version and benefits; no subscription price or member count is fabricated. */
import { Check, Clock3, Crown } from "lucide-react";
import dayjs from "dayjs";
import type { CustomerMembershipBenefit, CustomerMembershipPlan, CustomerMembershipScopeOptions } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardFacts, CardList, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { HoloCard } from "./HoloCard";
import { MEMBER_CARD_FACES, useMemberCardAppearance, type MemberCardFace } from "./memberCardAppearance";
import styles from "./membershipPlanCards.module.css";

type Translate = (key: string) => string;
const benefitLabels: Record<string, string> = { rental_discount: "租金优惠", deposit_reduction: "押金减免", preauth_reduction: "预授权减免", service_benefit: "增值服务权益", priority_reservation: "优先预订", quote_validity_extension: "报价有效期延长" };
const reserved = (benefit: CustomerMembershipBenefit) => ["priority_reservation", "quote_validity_extension"].includes(benefit.type);
function benefitValue(benefit: CustomerMembershipBenefit, t: Translate) {
  return benefit.calculation === "percentage" ? `${benefit.value}%` : benefit.calculation === "priority" ? t("优先级") + ` ${benefit.value}` : String(benefit.value);
}
function scopeLabel(benefit: CustomerMembershipBenefit, options: CustomerMembershipScopeOptions | undefined, t: Translate) {
  if (!benefit.scope || benefit.scope.type === "tenant") return t("租户全部空间");
  if (benefit.scope.type === "workspaces") return benefit.scope.workspaceIds.map(id => options?.workspaces.find(workspace => workspace.id === id)?.name ?? t(options ? "已不可用空间" : "空间名称未加载")).join(" · ");
  return benefit.scope.categoryCodes.map(code => options?.categories.find(category => category.code === code)?.name ?? t(options ? "已不可用品类" : "品类名称未加载")).join(" · ");
}
function BenefitList({ benefits, t, options, full = false }: { benefits: CustomerMembershipBenefit[]; t: Translate; options?: CustomerMembershipScopeOptions; full?: boolean }) {
  return benefits.length ? <CardList>{benefits.map((benefit, index) => <li key={index}>{reserved(benefit) ? <Clock3 aria-hidden="true" /> : <Check aria-hidden="true" />}<div>
    <div>{t(benefitLabels[benefit.type] ?? benefit.type)} · {benefitValue(benefit, t)}</div>
    {full && <CardSecondary>{scopeLabel(benefit, options, t)}</CardSecondary>}
    {reserved(benefit) && <CardSecondary>{t("配置项，尚未生效")}</CardSecondary>}
  </div></li>)}</CardList> : <CardSecondary>{t("暂无配置权益")}</CardSecondary>;
}
const day = (value?: string) => value && dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD") : undefined;
export function MemberCard({ row, t, options, previewFace }: { row: CustomerMembershipPlan; t: Translate; options?: CustomerMembershipScopeOptions; previewFace?: MemberCardFace }) {
  const saved = useMemberCardAppearance(row);
  const face = previewFace ?? saved.face;
  const version = row.currentVersion, benefits = version?.benefits ?? [];
  const audience = t(row.targetType === "corporate" ? "企业会员" : "个人会员");
  const front = <div className={`holo-card_front__aJtnw ${styles.front}`} data-face={face}>
    <div className={`holo-card_photo__f5n6_ ${styles.art}`} aria-hidden="true" />
    <div className="holo-card_top__lEhuU"><Crown className="holo-card_mark__p7GWe" aria-hidden="true" />
      <span className={`holo-card_tier__zRbZw ${styles.tier}`}>{version ? `Lv.${version.levelRank}` : t("未建版本")}</span>
    </div>
    <div className="holo-card_info__FnStG">
      <div className={styles.flags}>{version?.isRecommended && <span>{t("推荐")}</span>}{version?.isDefault && <span>{t("默认方案")}</span>}</div>
      <p className={`holo-card_name__sIevo ${styles.name}`}>{row.name}</p>
      <p className="holo-card_role__sDzKj">{audience} · {row.code}</p>
      <dl className="holo-card_meta__RMYGU">
        <div><dt>{t("状态")}</dt><dd className={styles.cardStatus} data-status={row.status}>{t(row.status === "active" ? "已启用" : row.status === "disabled" ? "已停用" : "草稿")}</dd></div>
        <div><dt>{t("配置权益")}</dt><dd>{benefits.length}</dd></div>
      </dl>
      <span className={styles.frontHint}>{t("点击翻面查看权益")}</span>
    </div>
  </div>;
  const back = <div className={`holo-card_back__c834K ${styles.back}`} data-face={face}>
    <div className={styles.backHeading}><Crown aria-hidden="true" /><span>{t("会员权益")}</span></div>
    {benefits.length ? <ul className={styles.backList}>{benefits.slice(0, 4).map((benefit, index) => <li key={index} data-reserved={reserved(benefit) ? "" : undefined}>
      <div>{reserved(benefit) ? <Clock3 aria-hidden="true" /> : <Check aria-hidden="true" />}<span>{t(benefitLabels[benefit.type] ?? benefit.type)}</span><b>{benefitValue(benefit, t)}</b></div>
      <p>{reserved(benefit) ? t("配置项，尚未生效") : scopeLabel(benefit, options, t)}</p>
    </li>)}</ul> : <p className={styles.empty}>{t(version ? "暂无配置权益" : "未建版本")}</p>}
    {benefits.length > 4 && <p className={styles.more}>+{benefits.length - 4} {t("配置权益")} · {t("查看详情")}</p>}
    <dl className={styles.validity}><div><dt>{t("生效日期")}</dt><dd>{day(version?.effectiveFrom) ?? t("未设置")}</dd></div><div><dt>{t("失效日期")}</dt><dd>{day(version?.effectiveTo) ?? t("长期")}</dd></div></dl>
    <span className={styles.backHint}>{t("点击翻回正面")}</span>
  </div>;
  return <div className={styles.stage}><HoloCard front={front} back={back} label={`${row.name} · ${audience} · ${t("点击翻面查看权益")}`} /></div>;
}
export function MemberCardFacePicker({ value = "pearl", onChange, disabled, t }: { value?: MemberCardFace; onChange?: (face: MemberCardFace) => void; disabled?: boolean; t: Translate }) {
  return <div className={styles.facePicker} role="group" aria-label={t("卡面样式")}>{MEMBER_CARD_FACES.map(item => <button key={item.id} type="button" data-face={item.id} aria-pressed={value === item.id} disabled={disabled} onClick={() => onChange?.(item.id)}>
    <span className={styles.faceSample} aria-hidden="true" /><span>{t(item.label)}</span>{value === item.id && <Check aria-hidden="true" />}
  </button>)}</div>;
}
export function membershipPlanCards({ t, options, canManage, canPublish, publishing, edit, history, publish }: {
  t: Translate; options?: CustomerMembershipScopeOptions; canManage: boolean; canPublish: boolean; publishing: boolean;
  edit: (row: CustomerMembershipPlan) => void; history: (row: CustomerMembershipPlan) => void; publish: (row: CustomerMembershipPlan) => void;
}): ListCard<CustomerMembershipPlan> & { defaultView: "cards" } {
  return { kind: "membership", defaultView: "cards", title: row => row.name,
    media: row => <MemberCard row={row} t={t} options={options} />,
    body: () => null,
    details: row => <><CardSection title={t("全部权益与适用范围")}><BenefitList benefits={row.currentVersion?.benefits ?? []} options={options} t={t} full /></CardSection>
      <CardSection title={t("方案信息")}><CardFacts items={[
        { label: t("生效日期"), value: row.currentVersion?.effectiveFrom ? dayjs(row.currentVersion.effectiveFrom).format("YYYY-MM-DD") : t("未设置") }, { label: t("失效日期"), value: row.currentVersion?.effectiveTo ? dayjs(row.currentVersion.effectiveTo).format("YYYY-MM-DD") : t("长期") },
        { label: t("当前版本"), value: row.currentVersion ? `v${row.currentVersion.version}` : "—" }, { label: t("历史版本"), value: row.versions?.length ?? "—" }, { label: t("版本状态"), value: row.currentVersion ? t(row.currentVersion.status === "published" ? "已发布" : row.currentVersion.status === "disabled" ? "已停用" : "草稿") : "—" },
      ]} /></CardSection></>,
    actions: (row, afterClose) => <><Button variant="secondary" size="sm" disabled={!canManage} onClick={() => afterClose(() => edit(row))}>{t("编辑草稿")}</Button><Button variant="secondary" size="sm" onClick={() => afterClose(() => history(row))}>{t("版本历史")}</Button>
      {row.currentVersion?.status === "draft" && <Button variant="primary" size="sm" disabled={!canPublish || publishing} onClick={() => afterClose(() => publish(row))}>{t("发布")} v{row.currentVersion.version}</Button>}
    </>,
  };
}
