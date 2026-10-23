/** Pure workbench presentation over native-owned session/navigation data. Original AI panels remain mounted separately. */
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, SegmentedControl, IconChevronDownOutlineRegular, Tooltip, Toast, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextProps, NavigationProps, MainProps, ToastProps } from './contract.ts'
import css from './Workbench.module.css'

export function WorkbenchContext({ wide, useBusiness, useWorkMode, changeMode, switchWorkspace, logout, retry, t }: ContextProps) {
  const state = useBusiness(value => value)
  const mode = useWorkMode(value => value)
  const [open, setOpen] = useState(false)
  const session = state.snapshot?.session
  if (!session || session.status !== 'ready') return <Button onClick={retry}>{t('retry')}</Button>
  const current = session.workspaces.find(row => row.id === session.currentWorkspaceId)
  const label = current?.name ?? (session.audience === 'saas' ? t('platform') : t('noSpace'))
  return <div className={css.context}>
    <Menu open={open} onClose={() => { setOpen(false) }} portal autoFocus selectedId={session.currentWorkspaceId ?? undefined}
      anchor={<Tooltip label={label} disabled={wide}><button className={css.space} type="button" aria-label={t('space')}
        disabled={state.busy || session.workspaces.length < 2} onClick={() => { setOpen(value => !value) }}>
        <span className={css.title}>{label}</span><IconChevronDownOutlineRegular size={14} />
      </button></Tooltip>}
      items={session.workspaces.map(row => ({ id: row.id, label: row.name }))}
      onSelect={id => { setOpen(false); switchWorkspace(id) }} />
    <SegmentedControl id="rental-mode" value={mode} label={t('mode')} disabled={state.busy}
      options={[{ value: 'ai', label: t('ai') }, { value: 'traditional', label: t('traditional') }]} onChange={changeMode} />
    <div className={css.account}><span className={css.title}>{session.displayName}</span>
      <Button variant="ghost" disabled={state.busy} onClick={logout}>{t('logout')}</Button></div>
    {state.failed && <span className={css.failure} role="status">{t('unavailable')}</span>}
  </div>
}

export function WorkbenchNavigation({ wide, useBusiness, useWorkMode, navigate, t }: NavigationProps) {
  const state = useBusiness(value => value)
  const mode = useWorkMode(value => value)
  if (mode !== 'traditional') return null
  const session = state.snapshot?.session
  if (!session || session.status !== 'ready') return null
  return <nav className={css.navigation} aria-label={t('business')}>
    {session.sections.length === 0 ? <span>{t('noPages')}</span> : session.sections.map(section => <section key={section.id}>
      {wide && <h2>{section.label}</h2>}
      {section.items.map(item => <Tooltip key={item.id} label={item.label} disabled={wide}>
        <button className={css.menuItem} type="button" disabled={state.busy}
          aria-current={session.pathname === item.path || session.pathname.startsWith(item.path + '/') ? 'page' : undefined}
          onClick={() => { navigate(item.id) }}>{item.label}</button>
      </Tooltip>)}
    </section>)}
  </nav>
}

export function WorkbenchToast({ useBusiness, dismissNotice, t }: ToastProps) {
  const notice = useBusiness(value => value.notice)
  if (!notice) return null
  return <Toast key={notice.sequence} text={t(notice.ok ? 'completed' : 'failed')} onDone={dismissNotice}
    {...notice.ok ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular /> }} />
}

export function WorkbenchMain({ useBusiness, measure, retry, t }: MainProps) {
  const state = useBusiness(value => value)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    return measure(element)
  }, [measure])
  return <div ref={viewport} className={css.viewport} id="rental-mode-traditional-panel" role="tabpanel" aria-labelledby="rental-mode-traditional">
    {state.snapshot?.session.status !== 'ready' && <div className={css.unavailable}>
      <span>{t('unavailable')}</span><Button variant="outline" onClick={retry}>{t('retry')}</Button>
    </div>}
  </div>
}
