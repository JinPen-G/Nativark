/** Pure workbench presentation over native-owned session/navigation data. Original AI panels remain mounted separately. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Menu, SegmentedControl, IconChevronDownOutlineRegular, Tooltip, Toast, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextProps, NavigationProps, MainProps, ToastProps } from './contract.ts'
import type { WorkbenchState } from './contract.ts'
import { prepareRentalDesktopCatalogInput } from '@rental-os/shared/agent-desktop'
import css from './Workbench.module.css'

export function WorkbenchContext({ wide, useBusiness, useWorkMode, changeMode, switchWorkspace, logout, retry, readCatalog, discardCatalog, readSources, t }: ContextProps) {
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
    {wide && session.audience === 'tenant' && session.currentWorkspaceId && <CatalogPreview key={JSON.stringify([session.actorId, session.tenantId, session.currentWorkspaceId])}
      catalog={state.catalog} sources={state.sources} busy={state.busy} readCatalog={readCatalog} discardCatalog={discardCatalog} readSources={readSources} t={t} />}
  </div>
}

/** A scoped human request never enters ordinary Harness chat, session history or a model. */
function CatalogPreview({ catalog, sources, busy, readCatalog, discardCatalog, readSources, t }: Pick<ContextProps, 'readCatalog' | 'discardCatalog' | 'readSources' | 't'> & { catalog: WorkbenchState['catalog']; sources: WorkbenchState['sources']; busy: boolean }) {
  const [provider, setProvider] = useState(''), [model, setModel] = useState(''), [text, setText] = useState('')
  const prepared = prepareRentalDesktopCatalogInput(text)
  return <details className={css.catalog}>
      <summary>{t('catalogPreview')}</summary>
      <p>{t('catalogBoundary')}</p>
      <form autoComplete="off" onSubmit={event => { event.preventDefault(); if (prepared.state === 'prepared') readCatalog({ limit: prepared.input.limit, selection: { provider, model } }) }}>
        <label>{t('catalogRequest')}<Input value={text} maxLength={256} required disabled={catalog.busy} onChange={event => { setText(event.target.value); discardCatalog() }} /></label>
        <p>{t('catalogSyntax')}</p>
        <label>{t('provider')}<Input value={provider} maxLength={128} required disabled={catalog.busy} onChange={event => { setProvider(event.target.value); discardCatalog() }} /></label>
        <label>{t('catalogModel')}<Input value={model} maxLength={256} required disabled={catalog.busy} onChange={event => { setModel(event.target.value); discardCatalog() }} /></label>
        <p role="status">{prepared.state === 'prepared' ? <>{t('catalogPreparedLimit')}: {prepared.input.limit} · {t(prepared.sources.limit === 'preview_default' ? 'catalogDefaultLimit' : 'catalogExplicitLimit')}</>
          : t(prepared.reason === 'empty' ? 'catalogInputEmpty' : 'catalogClarify')}</p>
        <Button type="submit" variant="outline" disabled={busy || catalog.busy || prepared.state !== 'prepared'}>{t(catalog.busy ? 'catalogLoading' : 'catalogRead')}</Button>
      </form>
      <div role="status" aria-live="polite">
        {catalog.failed && <p>{t('catalogDenied')}</p>}
        {catalog.inspection && <p>{t('catalogInspectedRoute')}: {catalog.inspection.selection.model} · {catalog.inspection.protocol} · {catalog.inspection.destination.baseUrl}<br />{t('catalogInspectionBoundary')}</p>}
        {catalog.result && <>
          <p>{t('catalogObserved')} <time dateTime={catalog.result.observedAt}>{catalog.result.observedAt}</time></p>
          <p>{t('catalogPolicyRevision')}: {catalog.result.policyRevision} · {t('catalogExpires')}: <time dateTime={catalog.result.expiresAt}>{catalog.result.expiresAt}</time></p>
          {catalog.result.reopenedFrom && <p>{t('catalogReopened')}: <time dateTime={catalog.result.reopenedFrom.observedAt}>{catalog.result.reopenedFrom.observedAt}</time> · {t(catalog.result.configurationVersion === catalog.result.reopenedFrom.configurationVersion ? 'catalogVersionSame' : 'catalogVersionChanged')}</p>}
          <p>{t(catalog.result.truncated ? 'catalogPartial' : catalog.result.items.length ? 'catalogReady' : 'catalogEmpty')}</p>
          <ul>{catalog.result.items.map(item => <li key={item.reference}><span>{item.reference}</span><span>{item.categoryCode} · {t(item.status)}</span></li>)}</ul>
        </>}
        {catalog.material && <details>
          <summary>{t('catalogMaterial')}</summary>
          <p>{t('catalogMaterialBoundary')}</p>
          <pre className={css.material}>{JSON.stringify(JSON.parse(catalog.material.content), null, 2)}</pre>
          <p>{t('catalogMaterialHash')}: <code>{catalog.material.contentHash}</code></p>
        </details>}
      </div>
      <details>
        <summary>{t('catalogSources')}</summary>
        <p>{t('catalogSourcesBoundary')}</p>
        <Button type="button" variant="outline" disabled={busy || sources.busy} onClick={readSources}>{t(sources.busy ? 'catalogLoading' : 'catalogReadSources')}</Button>
        {sources.failed && <p role="status">{t('catalogSourcesUnavailable')}</p>}
        {sources.result && <>
          <p role="status">{t(sources.result.truncated ? 'catalogSourcesPartial' : sources.result.items.length ? 'catalogSourcesReady' : 'catalogSourcesEmpty')}</p>
          <ul>{sources.result.items.map(source => <li key={source.auditId}>
            <time dateTime={source.observedAt}>{source.observedAt}</time>
            {source.state === 'reference' ? <>
              <span>{source.query.modelRoute.model} · {source.query.modelRoute.protocol} · {t('catalogPolicyRevision')}: {source.policyRevision}</span>
              <Button type="button" variant="outline" disabled={busy || catalog.busy || Date.parse(source.sourceExpiresAt) <= Date.now()} onClick={() => {
                const selection = { provider: source.query.modelRoute.provider, model: source.query.modelRoute.model }
                setProvider(selection.provider); setModel(selection.model); setText(`show first ${source.query.limit} products`)
                readCatalog({ selection, limit: source.query.limit, sourceRef: { auditId: source.auditId, requestId: source.requestId } })
              }}>{t('catalogReopenSource')}</Button>
            </> : <span>{t('catalogSourceLegacy')}</span>}
          </li>)}</ul>
        </>}
      </details>
    </details>
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
