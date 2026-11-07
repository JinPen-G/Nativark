import type { FormInstance } from "antd";
import { Form } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { Phone, Clock, ArrowUpRight } from "lucide-react";
import styles from "./ClientBrandPreview.module.css";

/** A read-only layout preview of the current draft; no upload, navigation or publishing side effects. */
export function ClientBrandPreview({ form, website = false }: { form: FormInstance; website?: boolean }) {
  const { t } = useLocale();
  const values = Form.useWatch(value => value, { form, preserve: true }) ?? {};
  const name = website ? values.heroTitle || values.slogan : values.brandName;
  const subtitle = website ? values.heroDescription : values.bannerSubtitle;
  const color = website ? values.secondaryColor : values.themeColor;
  const safeColor = /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color ?? "") ? color : "var(--foreground)";
  return <section className={styles.preview} aria-label={t("客户端样式预览")}>
    <div className={styles.browser}><span/><span/><span/><small>{t("草稿预览")}</small></div>
    <div className={styles.page}>
      <div className={styles.brand}><span style={{background:safeColor}}/>{website ? values.slogan || t("网站标语") : values.brandName || t("商户展示名")}</div>
      <div className={styles.hero}><h3>{name || t("在这里预览品牌标题")}</h3><p>{subtitle || t("填写配置后，预览会同步更新。")}</p><span className={styles.cta} style={{borderColor:safeColor}}>{website ? values.ctaTitle || t("查看服务") : values.bannerTitle || t("查看服务")} <ArrowUpRight size={14}/></span></div>
      <div className={styles.contact}><span><Phone size={14}/>{website ? values.contactAddress || t("联系地址") : values.customerServicePhone || t("客服电话")}</span><span><Clock size={14}/>{website ? values.footerText || t("页脚文字") : values.customerServiceHours || t("客服时段")}</span></div>
    </div>
    <p className={styles.note}>{t("仅预览当前草稿的文字与配色，保存后才会应用。")}</p>
  </section>;
}
