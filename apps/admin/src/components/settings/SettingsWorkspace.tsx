/** Section navigation keeps draft forms mounted. It changes presentation only; each section owns its save contract. */
import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { useLocale } from "@/app/locale";
import styles from "./SettingsWorkspace.module.css";

export interface SettingsSection {
  key: string;
  label: string;
  description?: string;
  content: ReactNode;
}
export function SettingsWorkspace({ sections, value, onChange, footer }: { sections: SettingsSection[]; value?: string; onChange?: (key: string) => void; footer?: ReactNode }) {
  const uid = useId();
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [internal, setInternal] = useState(sections[0]?.key);
  const active = sections.some(s => s.key === (value ?? internal)) ? value ?? internal : sections[0]?.key;
  const select = (key: string) => { setInternal(key); onChange?.(key); };
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    // SaveButton calls validateFields directly, so Form.onFinishFailed alone is insufficient.
    // React validation mounts the error inside a hidden panel; reveal only a newly failing panel.
    const observer = new MutationObserver(records => {
      const error = records.flatMap(record => [record.target, ...record.addedNodes]).find(node =>
        node instanceof Element && (node.matches(".ant-form-item-has-error") || node.closest(".ant-form-item-has-error") || node.querySelector(".ant-form-item-has-error")));
      const panel = error instanceof Element ? error.closest<HTMLElement>('[data-settings-panel][hidden]') : undefined;
      if (panel?.dataset.settingsPanel) select(panel.dataset.settingsPanel);
    });
    observer.observe(host, {subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
    return () => observer.disconnect();
  }, [onChange]);
  return <div ref={root} className={styles.workspace}>
    <nav className={styles.nav} role="tablist" aria-label={t("设置分区")} aria-orientation="vertical">
      {sections.map((section, index) => <button key={section.key} type="button" role="tab" id={`${uid}-tab-${section.key}`} aria-controls={`${uid}-panel-${section.key}`} aria-selected={active === section.key} tabIndex={active === section.key ? 0 : -1}
        onClick={() => select(section.key)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : ["ArrowDown", "ArrowRight"].includes(event.key) ? (index + 1) % sections.length : ["ArrowUp", "ArrowLeft"].includes(event.key) ? (index - 1 + sections.length) % sections.length : undefined;
          if (next === undefined) return;
          event.preventDefault(); select(sections[next].key); document.getElementById(`${uid}-tab-${sections[next].key}`)?.focus();
        }}>
        {active === section.key && <motion.span className={styles.active} layoutId={`${uid}-active`} transition={reduced ? {duration:0} : {type:"spring",stiffness:420,damping:38}} />}
        <span className={styles.label}>{section.label}{section.description && <small>{section.description}</small>}</span>
      </button>)}
    </nav>
    <div className={styles.content}>
      {sections.map(section => <section key={section.key} data-settings-panel={section.key} id={`${uid}-panel-${section.key}`} role="tabpanel" aria-labelledby={`${uid}-tab-${section.key}`} hidden={active !== section.key} className={styles.panel}>{section.content}</section>)}
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  </div>;
}

/** Existing titled form groups can enter the same navigation without copying field definitions. */
export function SettingsGroups({ children, footer, value, onChange }: { children: ReactNode; footer?: ReactNode; value?: string; onChange?: (key: string) => void }) {
  const sections = Children.toArray(children).filter(isValidElement<{ title?: ReactNode }>).map((child, index) => ({
    key: String(index), label: typeof child.props.title === "string" ? child.props.title : String(index + 1), content: child,
  }));
  return <SettingsWorkspace sections={sections} footer={footer} value={value} onChange={onChange}/>;
}

/** Ant validation commits after onFinishFailed; reveal its first hidden section without changing any field. */
export function revealSettingsValidation(formId?: string) {
  requestAnimationFrame(() => {
    const root = formId ? document.getElementById(formId) : document;
    const invalid = [...(root?.querySelectorAll<HTMLElement>(".ant-form-item-has-error") ?? [])].find(node => node.closest('[role="tabpanel"]'));
    const panel = invalid?.closest<HTMLElement>('[role="tabpanel"][hidden]');
    const tabId = panel?.getAttribute("aria-labelledby");
    if (tabId) document.getElementById(tabId)?.click();
    requestAnimationFrame(() => invalid?.scrollIntoView({ block: "nearest", behavior: "auto" }));
  });
}
