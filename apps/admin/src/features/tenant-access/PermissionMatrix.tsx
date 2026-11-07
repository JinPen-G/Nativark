/** Real role/permission projection using the supplied UIArc matrix CSS. Saves remain in the existing role form/API. */
import { useId, useMemo, useState } from "react";
import type { PermissionModule, SystemRoleRow } from "@rental-os/shared";
import { Check, ChevronDown, ChevronRight, LockKeyhole, Minus } from "lucide-react";
import { SearchField, AnimatedNumber } from "@/components/ui";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { useLocale } from "@/app/locale";
import classes from "./roles-source/classes.json";
import "./roles-source/original.css";
import styles from "./TenantAccess.module.css";

const grants = (role: SystemRoleRow) => new Set([...role.permissions, ...role.buttonPermissions]);

export function PermissionMatrix({ roles, modules, onEdit }: { roles: SystemRoleRow[]; modules: PermissionModule[]; onEdit: (role: SystemRoleRow) => void }) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const visible = modules.map(module => ({ ...module, children: module.children.filter(permission =>
    `${t(module.name)} ${t(permission.name)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) })).filter(module => module.children.length);
  const byRole = useMemo(() => new Map(roles.map(role => [role.id, grants(role)])), [roles]);
  return <div className={`${classes.card} ${classes.frame} ${styles.matrix}`}>
    <header className={classes.header}><div className={classes.heading}><h2>{t("权限对照")}</h2><p className={classes.summary}>{t("按角色比较操作权限，点击角色名称编辑")}</p></div><SearchField label={t("查找权限")} placeholder={t("查找权限")} value={query} onValueChange={setQuery} /></header>
    <div className={classes.scroller} tabIndex={0} aria-label={t("权限对照表")}>
      <div className={`${classes.frame} ${classes.grid}`} role="table" aria-label={t("角色权限")}>
        <div className={`${classes.row} ${classes.headRow}`} role="row"><div className={`${classes.label} ${classes.corner}`} role="columnheader">{t("操作权限")}</div>
          {roles.map(role => <div key={role.id} className={classes.cell} role="columnheader"><button className={classes.roleTrigger} disabled={role.fixedAllPermissions} onClick={() => onEdit(role)}>
            <span className={classes.roleName}>{role.fixedAllPermissions && <LockKeyhole size={12} />}<span className={classes.roleText}>{role.name}</span></span><span className={classes.rolePeople}>{role.fixedAllPermissions ? t("系统预设") : t("编辑权限")}</span>
          </button></div>)}
        </div>
        {visible.map(module => {
          const open = Boolean(query) || expanded.has(module.code);
          return <div key={module.code} role="rowgroup">
            <div className={`${classes.row} ${classes.groupRow}`} role="row"><div className={classes.label} role="rowheader">
              <button className={classes.disclosure} aria-expanded={open} onClick={() => setExpanded(previous => { const next = new Set(previous); next.has(module.code) ? next.delete(module.code) : next.add(module.code); return next; })}>
                {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<span>{t(module.name)}</span><span className={classes.groupCount}>{module.children.length}</span>
              </button></div>
              {roles.map(role => <div key={role.id} role="cell" className={classes.cell}>{role.fixedAllPermissions ? module.children.length : module.children.filter(p => byRole.get(role.id)?.has(p.code)).length}/{module.children.length}</div>)}
            </div>
            {open && module.children.map(permission => <div className={`${classes.row} ${classes.permRow}`} key={permission.code} role="row">
              <div className={`${classes.label} ${classes.permLabel}`} role="rowheader">{t(permission.name)}</div>
              {roles.map(role => { const granted = role.fixedAllPermissions || byRole.get(role.id)?.has(permission.code); return <div className={classes.cell} key={role.id} role="cell" aria-label={t(granted ? "已授权" : "未授权")}><span className={styles.permissionFact} data-granted={granted || undefined}>{granted ? <Check size={16}/> : <Minus size={14}/>}</span></div>; })}
            </div>)}
          </div>;
        })}
      </div>
    </div>
  </div>;
}

/** Form-controlled selection retains permissions hidden by search or absent from the loaded catalog. */
export function PermissionEditor({ modules, value = [], onChange, disabled = false }: { modules: PermissionModule[]; value?: string[]; onChange?: (value: string[]) => void; disabled?: boolean }) {
  const { t } = useLocale();
  const uid = useId();
  const [query, setQuery] = useState("");
  const [selectedModule, setSelectedModule] = useState<string>();
  const selected = new Set(value);
  const visible = modules.map(module => ({ ...module, children: module.children.filter(permission =>
    `${t(module.name)} ${t(permission.name)} ${permission.description ? t(permission.description) : ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) })).filter(module => module.children.length);
  const current = visible.find(module => module.code === selectedModule) ?? visible[0];
  const toggle = (codes: string[], enabled: boolean) => {
    if (disabled) return;
    const next = new Set(value);
    codes.forEach(code => enabled ? next.add(code) : next.delete(code));
    onChange?.([...next]);
  };
  const total = modules.reduce((sum,module)=>sum+module.children.length,0);
  return <div className={styles.permissionEditor}>
    <div className={styles.permissionSearch}><SearchField label={t("查找权限")} placeholder={t("查找权限")} value={query} onValueChange={setQuery}/><span><AnimatedNumber value={value.length}/> / {total} {t("已选")}</span></div>
    <div className={styles.permissionLayout}>
      <nav className={styles.moduleNav} aria-label={t("权限模块")}>{visible.map(module => <button type="button" key={module.code} aria-current={current?.code === module.code ? "true" : undefined} onClick={()=>setSelectedModule(module.code)}>
        <span>{t(module.name)}</span><span>{module.children.filter(p=>selected.has(p.code)).length}/{module.children.length}</span>
      </button>)}</nav>
      <section className={styles.permissionList} aria-labelledby={`${uid}-heading`}>
        {current ? <><header><h3 id={`${uid}-heading`}>{t(current.name)}</h3><Checkbox disabled={disabled}
          checked={current.children.every(p=>selected.has(p.code)) ? true : current.children.some(p=>selected.has(p.code)) ? "indeterminate" : false}
          onCheckedChange={checked=>toggle(current.children.map(p=>p.code),checked===true)} label={t(query ? "选择搜索结果" : "全选此模块")}/></header>
          {current.children.map(permission=><div key={permission.code} className={styles.permissionOption}>
            <Checkbox label={t(permission.name)} description={permission.description ? t(permission.description) : undefined} disabled={disabled} checked={selected.has(permission.code)} onCheckedChange={checked=>toggle([permission.code],checked===true)}/>
          </div>)}
        </> : <p>{t("没有匹配的权限")}</p>}
      </section>
    </div>
  </div>;
}
