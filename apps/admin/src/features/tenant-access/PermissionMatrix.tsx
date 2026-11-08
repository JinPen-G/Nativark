/** Role comparison and single-role permission drafts. Reviewed changes use the existing role form and API. */
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { PermissionModule, SystemRoleRow } from "@rental-os/shared";
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Columns3, LockKeyhole, Minus } from "lucide-react";
import { ActionButton, Alert, Button, SearchField, AnimatedNumber, EmptyScene, ListFilterBar, ListFilterItem, Select, Tooltip } from "@/components/ui";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { useLocale } from "@/app/locale";
import { ADMIN_PERMISSION_MATRIX_METRICS } from "@/app/designTokens";
import { PermissionGroupRows, PermissionToggle } from "./PermissionMatrixControls";
import { changePermissionDraft, isFixedRole, nextPermissionCell, permissionDraftChanges, projectPermissionModules, roleHasPermission, rolePermissionBaseline,
  type PermissionCell, type PermissionDraft, type RoleEditorTarget } from "./permission-matrix-model";
import classes from "./roles-source/classes.json";
import "./roles-source/original.css";
import styles from "./TenantAccess.module.css";

export function PermissionMatrix({ roles, modules, onEdit, draft, onDraftChange, onRefresh, busy = false }: {
  roles: SystemRoleRow[]; modules: PermissionModule[]; onEdit: (role: SystemRoleRow, target?: RoleEditorTarget) => void;
  draft: PermissionDraft | null; onDraftChange: (draft: PermissionDraft | null) => void; onRefresh: () => Promise<unknown>; busy?: boolean;
}) {
  const { t } = useLocale();
  const uid = useId();
  const reduced = usePrefersReducedMotion();
  const grid = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [moduleCode, setModuleCode] = useState<string>();
  const [selectedRoles, setSelectedRoles] = useState<string[] | null>(null);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState("");
  const [highlightedRole, setHighlightedRole] = useState<string | null>(null);
  const [delays, setDelays] = useState<Record<string, number>>({});
  const [announcement, setAnnouncement] = useState("");
  const draftRole = roles.find(role => role.id === draft?.roleId);
  const stale = Boolean(draft && (!draftRole || draft.baseline !== rolePermissionBaseline(draftRole)));
  const chosen = roles.filter(role => selectedRoles === null || selectedRoles.includes(role.id) || draft?.roleId === role.id);
  const compared = chosen.length ? chosen : roles.slice(0, 1);
  const visible = projectPermissionModules(modules, compared, query, moduleCode, differencesOnly, t);
  const open = (code: string) => !collapsed.has(code);
  const allExpanded = visible.every(module => open(module.code));
  const changes = draftRole ? permissionDraftChanges(draftRole, draft) : { added: [], removed: [] };
  const changedCodes = new Set([...changes.added, ...changes.removed]);
  const currentGrant = (role: SystemRoleRow, code: string) => draft?.roleId === role.id && !stale ? draft.permissions.includes(code) : roleHasPermission(role, code);
  const disabledFor = (role: SystemRoleRow) => busy || stale || Boolean(draft && draft.roleId !== role.id);
  const cells: PermissionCell[] = [{ key: "expand-all", row: 0, column: 0 }, ...compared.map((role, index) => ({ key: `head:${role.id}`, row: 0, column: index + 1 }))];
  let rowIndex = 1;
  for (const module of visible) {
    cells.push({ key: `group:${module.code}`, row: rowIndex, column: 0 }, ...compared.map((role, index) => ({ key: `${module.code}:${role.id}`, row: rowIndex, column: index + 1 })));
    rowIndex++;
    if (open(module.code)) for (const permission of module.children) {
      cells.push(...compared.map((role, index) => ({ key: `${permission.code}:${role.id}`, row: rowIndex, column: index + 1 })));
      rowIndex++;
    }
  }
  const focusKey = cells.some(cell => cell.key === focused) ? focused : cells[0]?.key;
  const navigation = (key: string) => ({ "data-matrix-nav": key, tabIndex: key === focusKey ? 0 : -1, onFocus: () => {
    setFocused(key);
    const column = cells.find(cell => cell.key === key)?.column ?? 0;
    setHighlightedRole(compared[column - 1]?.id ?? null);
  } });
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-matrix-nav]") : null;
    const current = cells.find(cell => cell.key === target?.dataset.matrixNav);
    if (!current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = nextPermissionCell(cells, current, event.key, event.ctrlKey);
    if (!next) return;
    setFocused(next.key);
    Array.from(grid.current?.querySelectorAll<HTMLElement>("[data-matrix-nav]") ?? []).find(element => element.dataset.matrixNav === next.key)?.focus();
  };
  const toggle = (role: SystemRoleRow, codes: string[], enabled: boolean) => {
    if (disabledFor(role) || isFixedRole(role)) return;
    const next = changePermissionDraft(role, draft, codes, enabled);
    setDelays(Object.fromEntries(codes.map((code, index) => [code, codes.length > 1 ? Math.min((index + 1) * .75 * motionTokens.stagger.line, .36) : 0])));
    onDraftChange(next);
    setAnnouncement(`${role.name} · ${t(enabled ? "已在草稿中勾选" : "已在草稿中取消")} ${codes.length} ${t("项权限")}`);
  };
  useEffect(() => {
    if (!draft || !draftRole) return;
    if (!changes.added.length && !changes.removed.length) onDraftChange(null);
  }, [draft, draftRole, changes.added.length, changes.removed.length, onDraftChange]);
  useLayoutEffect(() => {
    const surface = workspace.current;
    const viewport = scroller.current;
    if (!surface || !viewport) return;
    const measure = () => {
      if (!viewport.getClientRects().length) return;
      const footer = viewport.nextElementSibling?.getBoundingClientRect().height ?? 0;
      const draftHeight = surface.querySelector('[data-permission-draft]')?.getBoundingClientRect().height ?? 0;
      const height = Math.max(220, window.innerHeight - Math.max(0, viewport.getBoundingClientRect().top) - footer - draftHeight - 32);
      viewport.style.setProperty('--matrix-viewport-height', `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [compared.length, visible.length]);
  return <section ref={workspace} className={styles.matrixWorkspace} aria-label={t("权限对照")} style={{
    "--matrix-label-default": `${ADMIN_PERMISSION_MATRIX_METRICS.labelWidth}px`,
    "--matrix-role-default": `${ADMIN_PERMISSION_MATRIX_METRICS.roleWidth}px`,
    "--matrix-label-compact": `${ADMIN_PERMISSION_MATRIX_METRICS.compactLabelWidth}px`,
    "--matrix-role-compact": `${ADMIN_PERMISSION_MATRIX_METRICS.compactRoleWidth}px`,
  } as CSSProperties}>
    <ListFilterBar>
      <SearchField label={t("查找权限")} placeholder={t("权限名称、编码或说明")} value={query} onValueChange={value => { setQuery(value); setCollapsed(new Set()); }} />
      <ListFilterItem label={t("权限模块")} active={Boolean(moduleCode)}><Select allowClear aria-label={t("权限模块")} placeholder={t("全部模块")} value={moduleCode} onChange={value => setModuleCode(value)} options={modules.map(module => ({ value: module.code, label: t(module.name) }))} /></ListFilterItem>
      <ListFilterItem kind="action"><Popover><PopoverTrigger asChild><Button icon={<Columns3 size={16} />}>{t("对照角色")} {compared.length}<ChevronDown size={14} /></Button></PopoverTrigger>
        <PopoverContent align="end" className={styles.roleChooser}>
          <SearchField label={t("查找角色")} placeholder={t("角色名称或编码")} value={roleQuery} onValueChange={setRoleQuery} />
          <div className={styles.roleChoices}>{roles.filter(role => `${role.name} ${role.code}`.toLocaleLowerCase().includes(roleQuery.trim().toLocaleLowerCase())).map(role => <Checkbox key={role.id}
            label={role.name} description={t(isFixedRole(role) ? "系统预设" : role.isActive ? "已启用" : "已停用")} checked={compared.some(item => item.id === role.id)}
            disabled={draft?.roleId === role.id || compared.length === 1 && compared[0]?.id === role.id}
            onCheckedChange={checked => setSelectedRoles(checked ? [...new Set([...compared.map(item => item.id), role.id])] : compared.filter(item => item.id !== role.id).map(item => item.id))} />)}</div>
          {!roles.some(role => `${role.name} ${role.code}`.toLocaleLowerCase().includes(roleQuery.trim().toLocaleLowerCase())) && <p>{t("没有匹配的角色")}</p>}
          <Button type="text" onClick={() => setSelectedRoles(null)}>{t("显示全部角色")}</Button>
        </PopoverContent></Popover></ListFilterItem>
      <ListFilterItem label={t("只看差异")} active={differencesOnly && compared.length > 1}><Tooltip title={compared.length < 2 ? t("选择至少两个角色后可比较差异") : undefined}><span className={styles.differenceControl}><Checkbox label={t("只看差异")} checked={differencesOnly && compared.length > 1} disabled={compared.length < 2} onCheckedChange={checked => setDifferencesOnly(checked === true)} /></span></Tooltip></ListFilterItem>
      <ListFilterItem kind="action"><ActionButton variant="secondary" label={t("刷新权限")} disabled={busy || Boolean(draft)} onAction={onRefresh} /></ListFilterItem>
      {(query || moduleCode || differencesOnly) && <Button data-list-filter-reset type="text" onClick={() => { setQuery(""); setModuleCode(undefined); setDifferencesOnly(false); }}>{t("清除筛选")}</Button>}
    </ListFilterBar>
    {stale && <Alert type="warning" showIcon title={t("角色资料已更新，请放弃旧草稿后重新核对。")}
      action={<Button onClick={() => onDraftChange(null)}>{t("放弃修改")}</Button>} />}
    <div className={styles.matrixHelp}>{compared.some(role => !isFixedRole(role)) && <span>{t("勾选先记入草稿，核对并保存后生效。")}</span>}{compared.some(isFixedRole) && <span>{t("系统预设角色的权限不可修改。")}</span>}</div>
    <div className={`${classes.card} ${classes.frame} ${styles.matrix}`} data-single-role={compared.length === 1 || undefined} style={{ "--matrix-role-count": compared.length } as CSSProperties}>
      {!compared.length || !visible.length ? <EmptyScene compact scene="search" title={t(!compared.length ? "没有匹配的角色" : differencesOnly && compared.length > 1 ? "所选角色在当前范围内没有权限差异" : "没有匹配的权限")} /> : <div ref={scroller} className={`${classes.scroller} ${styles.matrixScroller}`} aria-label={t("权限对照表")}>
        <div ref={grid} className={`${classes.frame} ${classes.grid}`} role="grid" aria-label={t("角色权限")} aria-rowcount={rowIndex} aria-colcount={compared.length + 1} onKeyDown={moveFocus}
          onPointerLeave={() => setHighlightedRole(null)}>
          <div className={`${classes.row} ${classes.headRow} ${styles.matrixHead}`} role="row">
            <div className={`${classes.label} ${classes.corner} ${styles.matrixCorner}`} role="columnheader"><span>{t("操作权限")} · {visible.reduce((total, module) => total + module.children.length, 0)}</span>
              <Tooltip title={t(allExpanded ? "收起全部" : "展开全部")}><Button {...navigation("expand-all")} type="text" size="small" aria-label={t(allExpanded ? "收起全部" : "展开全部")}
                icon={allExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />} onClick={() => setCollapsed(previous => { const next = new Set(previous); visible.forEach(module => allExpanded ? next.add(module.code) : next.delete(module.code)); return next; })} /></Tooltip>
            </div>
            {compared.map(role => <div key={role.id} className={classes.cell} role="columnheader" data-highlighted={highlightedRole === role.id || undefined} onPointerEnter={() => setHighlightedRole(role.id)}>
              <button {...navigation(`head:${role.id}`)} className={classes.roleTrigger} title={role.name} onClick={() => onEdit(role, { section: "permissions", draft: draft?.roleId === role.id && !stale ? draft : undefined, query })}>
                <span className={classes.roleName}>{isFixedRole(role) && <LockKeyhole className={classes.lock} size={12} aria-hidden="true" />}<span className={classes.roleText}>{role.name}</span></span>
                <span className={classes.rolePeople}>{t(isFixedRole(role) ? "查看固定权限" : "编辑角色权限")}</span>
                {!role.isActive && <span className={styles.inactiveRole}>{t("已停用")}</span>}
              </button>
            </div>)}
          </div>
          {visible.map(module => <Fragment key={module.code}>
            <div className={`${classes.row} ${classes.groupRow}`} role="row">
              <div className={classes.label} role="rowheader"><button {...navigation(`group:${module.code}`)} className={classes.disclosure} aria-expanded={open(module.code)} aria-controls={`${uid}-${module.code}`}
                onPointerEnter={() => setHighlightedRole(null)} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(module.code) ? next.delete(module.code) : next.add(module.code); return next; })}>
                <motion.span className={classes.disclosureIcon} initial={false} animate={{ rotate: open(module.code) ? 0 : -90 }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}><ChevronDown size={16} aria-hidden="true" /></motion.span>
                <span className={classes.groupName}>{t(module.name)}</span><span className={classes.groupCount}>{module.children.length}</span>
              </button></div>
              {compared.map(role => {
                const count = module.children.filter(permission => currentGrant(role, permission.code)).length;
                return <div className={classes.cell} role="gridcell" key={role.id} data-highlighted={highlightedRole === role.id || undefined} onPointerEnter={() => setHighlightedRole(role.id)}>
                  <div className={styles.groupGrant}><PermissionToggle {...navigation(`${module.code}:${role.id}`)} role="checkbox" state={count === module.children.length ? "on" : count ? "mixed" : "off"}
                    label={`${role.name} · ${t(module.name)} · ${t("全选当前显示权限")}`} title={isFixedRole(role) ? t("系统预设角色的权限不可修改。") : disabledFor(role) ? t("请先核对或放弃当前角色的修改") : undefined}
                    locked={isFixedRole(role)} disabled={disabledFor(role)} dirty={draft?.roleId === role.id && module.children.some(permission => changedCodes.has(permission.code))}
                    onToggle={() => toggle(role, module.children.map(permission => permission.code), count !== module.children.length)} /><span>{count}/{module.children.length}</span></div>
                </div>;
              })}
            </div>
            <AnimatePresence initial={false}>{open(module.code) && <PermissionGroupRows id={`${uid}-${module.code}`}>
              {module.children.map(permission => <div className={`${classes.row} ${classes.permRow}`} key={permission.code} role="row">
                <div className={`${classes.label} ${classes.permLabel}`} role="rowheader" title={[t(permission.name), permission.description && t(permission.description), permission.code].filter(Boolean).join("\n")} onPointerEnter={() => setHighlightedRole(null)}>{t(permission.name)}</div>
                {compared.map(role => <div className={classes.cell} key={role.id} role="gridcell" data-highlighted={highlightedRole === role.id || undefined} onPointerEnter={() => setHighlightedRole(role.id)}>
                  <div className={styles.permissionGrant}><PermissionToggle {...navigation(`${permission.code}:${role.id}`)} state={currentGrant(role, permission.code) ? "on" : "off"}
                    label={`${role.name} · ${t(permission.name)}${isFixedRole(role) ? ` · ${t("系统预设")}` : ""}`}
                    title={isFixedRole(role) ? t("系统预设角色的权限不可修改。") : disabledFor(role) ? t("请先核对或放弃当前角色的修改") : permission.code}
                    locked={isFixedRole(role)} disabled={disabledFor(role)} dirty={draft?.roleId === role.id && changedCodes.has(permission.code)} delay={draft?.roleId === role.id ? delays[permission.code] : 0}
                    onToggle={() => toggle(role, [permission.code], !currentGrant(role, permission.code))} />
                    {compared.length === 1 && <span aria-hidden="true">{t(currentGrant(role, permission.code) ? "已授权" : "未授权")}</span>}
                  </div>
                </div>)}
              </div>)}
            </PermissionGroupRows>}</AnimatePresence>
          </Fragment>)}
        </div>
      </div>}
      <footer className={classes.foot}><span className={classes.note}><Check size={14} aria-hidden="true" />{t("已授权")}</span><span className={classes.note}><Minus size={14} aria-hidden="true" />{t("未授权")}</span><span className={classes.note}>{t("方向键切换单元格，空格勾选")}</span></footer>
    </div>
    <p className={classes.srOnly} role="status" aria-live="polite">{announcement}</p>
    <AnimatePresence>{draft && draftRole && <motion.div className={styles.draftBar} data-permission-draft role="region" aria-label={t("未保存的权限修改")}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }} transition={reduced ? { duration: 0 } : { y: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: motionTokens.ease.standard } }}>
      <div><strong>{draftRole.name}</strong><span><AnimatedNumber value={changes.added.length + changes.removed.length} /> {t("项权限待保存")} · {t("新增")} {changes.added.length} · {t("移除")} {changes.removed.length}</span></div>
      <div><Button onClick={() => { onDraftChange(null); setDelays({}); }}>{t("放弃修改")}</Button><Button type="primary" disabled={stale || busy} onClick={() => onEdit(draftRole, { section: "permissions", draft, query })}>{t("核对并保存")}</Button></div>
    </motion.div>}</AnimatePresence>
  </section>;
}

/** Form-controlled selection retains permissions hidden by search or absent from the loaded catalog. */
export function PermissionEditor({ modules, value = [], onChange, disabled = false, initialQuery = "" }: { modules: PermissionModule[]; value?: string[]; onChange?: (value: string[]) => void; disabled?: boolean; initialQuery?: string }) {
  const { t } = useLocale();
  const uid = useId();
  const [query, setQuery] = useState(initialQuery);
  const [selectedModule, setSelectedModule] = useState<string>();
  const selected = new Set(value);
  const visible = modules.map(module => ({ ...module, children: module.children.filter(permission =>
    `${t(module.name)} ${module.code} ${t(permission.name)} ${permission.code} ${permission.description ? t(permission.description) : ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(module => module.children.length);
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
