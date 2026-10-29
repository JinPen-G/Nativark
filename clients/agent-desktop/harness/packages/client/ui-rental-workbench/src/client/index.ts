/** Rental OS desktop-only slot registrations. No agent, model or business executor is replaced. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RentalDesktopBridge, RentalDesktopSnapshot, RentalDesktopCommand, RentalDesktopModelCatalogResult } from '@rental-os/shared/agent-desktop'
import { RENTAL_DESKTOP_PROTOCOL_VERSION, parseRentalDesktopSession, parseRentalDesktopModelCatalogQuery, parseRentalDesktopModelCatalogResult, parseRentalDesktopCatalogSourcesResult, parseRentalDesktopCatalogCheckResult } from '@rental-os/shared/agent-desktop'
import { WorkbenchContext, WorkbenchNavigation, WorkbenchMain, WorkbenchToast } from './Workbench.tsx'
import type { PreviewStatus, WorkbenchInjected, WorkbenchState } from './contract.ts'
import { zh, en } from './locales.ts'

export const inject = ['slots', 'layout', 'locale']
/** Register only when the owned native bridge has a configured Rental OS view. @param ctx - client plugin context. */
export function apply(ctx: Context): void {
  const bridge = (globalThis as typeof globalThis & { rentalDesktop?: RentalDesktopBridge }).rentalDesktop
  if (bridge?.protocolVersion !== RENTAL_DESKTOP_PROTOCOL_VERSION) return
  const state = createSnapshotStore<WorkbenchState>({ purpose: 'personal', expanded: false, snapshot: null, busy: false, failed: false, notice: null, catalog: { status: 'idle', result: null, inspection: null, material: null }, sources: { status: 'idle', result: null } })
  let catalogGeneration = 0
  let catalogExpiry: ReturnType<typeof setTimeout> | undefined
  let catalogRenewal: ReturnType<typeof setTimeout> | undefined
  const clearCatalog = (status: PreviewStatus = 'idle') => {
    catalogGeneration++
    clearTimeout(catalogExpiry)
    clearTimeout(catalogRenewal)
    state.update(value => { value.catalog = { status, result: null, inspection: null, material: null } })
  }
  let sourcesGeneration = 0
  let sourcesExpiry: ReturnType<typeof setTimeout> | undefined
  let sourcesRenewal: ReturnType<typeof setTimeout> | undefined
  let sourcesDeadline = 0
  const clearSources = (status: PreviewStatus = 'idle') => {
    sourcesGeneration++; clearTimeout(sourcesExpiry); clearTimeout(sourcesRenewal); sourcesDeadline = 0
    state.update(value => { value.sources = { status, result: null } })
  }
  const withdrawMaterials = (status: PreviewStatus) => {
    const before = state.getSnapshot()
    clearCatalog(['loading', 'ready'].includes(before.catalog.status) ? status : before.catalog.status)
    clearSources(['loading', 'ready'].includes(before.sources.status) ? status : before.sources.status)
  }
  const previews = new Map<'catalog' | 'sources', { element: HTMLDetailsElement; release: () => void }>()
  let expandedContexts = 0
  const previewVisible = (kind: 'catalog' | 'sources') => {
    const catalog = previews.get('catalog')?.element, sources = previews.get('sources')?.element
    return !disposed && expandedContexts > 0 && purpose.getSnapshot() === 'business'
      && !document.hidden && document.hasFocus() && !!catalog?.isConnected && catalog.open
      && (kind === 'catalog' || (!!sources?.isConnected && sources.open))
  }
  let noticeSequence = 0
  // Reuse the retained business panel so the personal composer and its draft stay mounted.
  const panel = 'rental-business' as MainPanelId
  const subscribeView = (getSnapshot: () => string, listener: () => void) => {
    let previous = getSnapshot()
    const notify = () => {
      const next = getSnapshot()
      if (next !== previous) { previous = next; listener() }
    }
    const releaseState = state.subscribe(notify), releasePanel = ctx.layout.panelInfo.subscribe(notify)
    return () => { releaseState(); releasePanel() }
  }
  const purpose = {
    getSnapshot: (): 'personal' | 'business' => ctx.layout.panelInfo.getSnapshot().activePanelId === panel ? state.getSnapshot().purpose : 'personal',
    subscribe: (listener: () => void) => subscribeView(purpose.getSnapshot, listener),
  }
  const workMode = {
    getSnapshot: (): 'ai' | 'traditional' => ctx.layout.panelInfo.getSnapshot().activePanelId === panel && purpose.getSnapshot() !== 'business' ? 'traditional' : 'ai',
    subscribe: (listener: () => void) => subscribeView(workMode.getSnapshot, listener),
  }
  let disposed = false
  let aiPanel: MainPanelId | null = ctx.layout.panelInfo.getSnapshot().activePanelId === panel ? null : ctx.layout.panelInfo.getSnapshot().activePanelId
  const leaveBusinessPurpose = () => {
    if (purpose.getSnapshot() === 'business') ctx.layout.selectPanel(null)
    state.update(value => { value.purpose = 'personal' })
  }
  let bounds: { x: number; y: number; width: number; height: number } | null = null
  const fail = () => { if (!disposed) { withdrawMaterials('failed'); state.update(value => { value.failed = true; value.busy = false }) } }
  const present = () => {
    const overlay = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [role="alert"], [data-shell-overlay] > *')]
      .some(node => node.getClientRects().length > 0)
    return bridge.present({ mode: workMode.getSnapshot(), bounds: overlay || purpose.getSnapshot() === 'business' ? null : bounds }).catch(fail)
  }
  const accept = (value: RentalDesktopSnapshot) => {
    if (disposed) return
    try {
      if (value.protocolVersion !== RENTAL_DESKTOP_PROTOCOL_VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Unsupported desktop projection')
      const session = parseRentalDesktopSession(value.session)
      const previous = state.getSnapshot().snapshot
      if (previous && value.revision < previous.revision) return
      if (JSON.stringify(previous?.session) !== JSON.stringify(session)) { withdrawMaterials('changed'); leaveBusinessPurpose() }
      state.update(draft => { draft.snapshot = { protocolVersion: value.protocolVersion, revision: value.revision, session } })
    } catch (_error) {
      withdrawMaterials('failed'); leaveBusinessPurpose()
      // Invalid native data cannot leave the previous menu usable.
      state.update(draft => { draft.snapshot = null; draft.failed = true; draft.busy = false })
      void bridge.present({ mode: 'ai', bounds: null }).catch(fail)
    }
  }
  const request = (command: RentalDesktopCommand) => {
    if (disposed || state.getSnapshot().busy || state.getSnapshot().snapshot?.session.status !== 'ready') return
    if (command.kind === 'logout' || command.kind === 'switch-workspace') { withdrawMaterials('changed'); leaveBusinessPurpose() }
    state.update(value => { value.busy = true; value.failed = false })
    void bridge.request(command).then(() => {
      if (!disposed) state.update(value => { value.busy = false; value.notice = { sequence: ++noticeSequence, ok: true } })
    }, () => {
      if (!disposed) state.update(value => { value.busy = false; value.notice = { sequence: ++noticeSequence, ok: false } })
    })
  }
  const revision = () => state.getSnapshot().snapshot?.revision ?? 0
  const checkCatalog = async (value: RentalDesktopModelCatalogResult, generation: number) => {
    if (disposed || generation !== catalogGeneration) return false
    if (!previewVisible('catalog') || !bridge.checkCatalogForModel) throw new Error('AI_RESOURCE_UNAVAILABLE')
    const { catalog, inspection } = value
    const check = parseRentalDesktopCatalogCheckResult(await bridge.checkCatalogForModel({ previewRequestId: catalog.requestId,
      selection: inspection.selection, preparationVersion: inspection.preparationVersion }))
    if (disposed || generation !== catalogGeneration) return false
    if (!previewVisible('catalog') || check.previewRequestId !== catalog.requestId || check.sourceObservedAt !== catalog.observedAt
      || JSON.stringify(check.binding) !== JSON.stringify(catalog.binding) || check.configurationVersion !== catalog.configurationVersion
      || check.policyHash !== catalog.policyHash || check.policyRevision !== catalog.policyRevision
      || JSON.stringify(check.modelRoute) !== JSON.stringify(catalog.modelRoute) || Date.parse(check.expiresAt) <= Date.now()
      || Date.parse(check.observedAt) > Date.now()) throw new Error('AI_SCOPE_CHANGED')
    const deadline = Math.min(Date.parse(check.expiresAt), Date.parse(catalog.expiresAt), Date.parse(inspection.expiresAt))
    if (deadline <= Date.now()) throw new Error('AI_RESOURCE_UNAVAILABLE')
    clearTimeout(catalogExpiry); clearTimeout(catalogRenewal)
    // The expiry timer is independent of a stuck renewal. Renewals cannot extend the original observation.
    catalogExpiry = setTimeout(() => clearCatalog('expired'), deadline - Date.now())
    if (deadline - Date.now() > 1000) catalogRenewal = setTimeout(() => {
      void checkCatalog(value, generation).catch(() => {
        if (!disposed && generation === catalogGeneration) { withdrawMaterials('failed') }
      })
    }, Math.min(3000, deadline - Date.now() - 1000))
    return true
  }
  const readSources = (generation: number) => {
    if (disposed || generation !== sourcesGeneration) return Promise.resolve()
    if (!previewVisible('sources') || !bridge.catalogSources) return Promise.reject(new Error('AI_RESOURCE_UNAVAILABLE'))
    return bridge.catalogSources({ limit: 10 }).then(value => {
      if (disposed || generation !== sourcesGeneration) return
      const result = parseRentalDesktopCatalogSourcesResult(value), session = state.getSnapshot().snapshot?.session
      if (!previewVisible('sources') || session?.status !== 'ready' || result.binding.actorId !== session.actorId || result.binding.tenantId !== session.tenantId
        || result.binding.workspaceId !== session.currentWorkspaceId || Date.parse(result.expiresAt) <= Date.now()) throw new Error('AI_SCOPE_CHANGED')
      if (!sourcesDeadline) sourcesDeadline = Date.parse(result.expiresAt)
      const deadline = Math.min(sourcesDeadline, Date.parse(result.expiresAt), Date.now() + 5000)
      if (deadline <= Date.now()) throw new Error('AI_RESOURCE_UNAVAILABLE')
      state.update(draft => { draft.sources = { status: 'ready', result: { ...result,
        expiresAt: new Date(Math.min(sourcesDeadline, Date.parse(result.expiresAt))).toISOString() } } })
      clearTimeout(sourcesExpiry); clearTimeout(sourcesRenewal)
      sourcesExpiry = setTimeout(() => clearSources('expired'), deadline - Date.now())
      if (deadline - Date.now() > 1000) sourcesRenewal = setTimeout(() => { void readSources(generation).catch(() => {
        if (!disposed && generation === sourcesGeneration) { withdrawMaterials('failed') }
      }) }, Math.min(3000, deadline - Date.now() - 1000))
    })
  }
  const props: WorkbenchInjected = {
    hooks: { business: state, workMode, purpose },
    changeMode: mode => {
      if (disposed || state.getSnapshot().busy || mode === workMode.getSnapshot()) return
      withdrawMaterials('changed')
      const active = ctx.layout.panelInfo.getSnapshot().activePanelId
      if (active !== panel) aiPanel = active
      try {
        if (mode === 'ai') ctx.layout.selectPanel(aiPanel)
        state.update(value => { value.failed = false; value.purpose = 'personal' })
        if (mode === 'traditional') ctx.layout.selectPanel(panel)
      } catch (_error) { ctx.layout.selectPanel(null); aiPanel = null; fail() }
      void present()
    },
    changePurpose: next => {
      const before = state.getSnapshot(), session = before.snapshot?.session
      if (disposed || before.busy || (next === 'business' && !before.expanded) || workMode.getSnapshot() !== 'ai' || next === purpose.getSnapshot()
        || session?.status !== 'ready' || (next === 'business' && (session.audience !== 'tenant' || !session.currentWorkspaceId))) return
      withdrawMaterials('changed')
      const active = ctx.layout.panelInfo.getSnapshot().activePanelId
      if (active !== panel) aiPanel = active
      try {
        if (next === 'personal') ctx.layout.selectPanel(aiPanel)
        state.update(value => { value.purpose = next; value.failed = false })
        if (next === 'business') ctx.layout.selectPanel(panel)
      } catch (_error) { ctx.layout.selectPanel(null); state.update(value => { value.purpose = 'personal' }); aiPanel = null; fail() }
      void present()
    },
    observeExpandedContext: () => {
      if (disposed) return () => undefined
      expandedContexts++
      state.update(value => { value.expanded = true })
      let released = false
      return () => {
        if (released) return
        released = true; expandedContexts--
        if (!expandedContexts) { withdrawMaterials('inactive'); state.update(value => { value.expanded = false }) }
      }
    },
    navigate: routeId => { request({ kind: 'navigate', routeId, revision: revision() }) },
    switchWorkspace: workspaceId => { request({ kind: 'switch-workspace', workspaceId, revision: revision() }) },
    logout: () => { request({ kind: 'logout', revision: revision() }) },
    retry: () => { void bridge.retry().catch(fail) },
    dismissNotice: () => { state.update(value => { value.notice = null }) },
    discardCatalog: () => { withdrawMaterials('changed') },
    clearMaterials: () => { clearCatalog('cleared'); clearSources('cleared') },
    observePreview: (element, kind) => {
      if (disposed) return () => undefined
      previews.get(kind)?.release()
      const closed = () => { if (!element.open) withdrawMaterials('inactive') }
      // Toggle events may coalesce a close/reopen into one open event. Any removal still withdraws the old observation.
      const observer = new MutationObserver(records => {
        if (records.some(record => record.oldValue !== null)) withdrawMaterials('inactive')
      })
      observer.observe(element, { attributes: true, attributeFilter: ['open'], attributeOldValue: true })
      element.addEventListener('toggle', closed)
      const release = () => {
        observer.disconnect(); element.removeEventListener('toggle', closed)
        if (previews.get(kind)?.release !== release) return
        previews.delete(kind)
        withdrawMaterials('inactive')
      }
      previews.set(kind, { element, release })
      return release
    },
    readSources: () => {
      const before = state.getSnapshot()
      if (!previewVisible('sources') || before.busy || before.sources.status === 'loading' || before.snapshot?.session.status !== 'ready') return
      clearSources('loading'); const generation = sourcesGeneration
      sourcesExpiry = setTimeout(() => clearSources('expired'), 5000)
      void Promise.resolve().then(() => readSources(generation)).catch(() => { if (!disposed && generation === sourcesGeneration) {
        withdrawMaterials('failed')
      } })
    },
    readCatalog: query => {
      const before = state.getSnapshot()
      if (!previewVisible('catalog') || before.busy || before.catalog.status === 'loading' || before.snapshot?.session.status !== 'ready') return
      clearCatalog()
      const generation = catalogGeneration
      let input
      try { input = parseRentalDesktopModelCatalogQuery(query) }
      catch { clearCatalog('failed'); return }
      if (input.sourceRef && (!previewVisible('sources') || before.sources.status !== 'ready'
        || !before.sources.result || Date.parse(before.sources.result.expiresAt) <= Date.now()
        || !before.sources.result.items.some(source => source.state === 'reference'
          && source.auditId === input.sourceRef?.auditId && source.requestId === input.sourceRef.requestId
          && Date.parse(source.sourceExpiresAt) > Date.now()))) { clearCatalog('failed'); return }
      state.update(value => { value.catalog.status = 'loading' })
      catalogExpiry = setTimeout(() => clearCatalog('expired'), 15000)
      // Human-only preview; the native Host resolves the prepared route. Never fall back to a hand-entered URL.
      void Promise.resolve().then(() => {
        if (disposed || generation !== catalogGeneration) return
        if (!previewVisible('catalog')) { withdrawMaterials('inactive'); return }
        if (!bridge.catalogForModel) throw new Error('AI_RESOURCE_UNAVAILABLE')
        return bridge.catalogForModel(input)
      }).then(async value => {
        if (disposed || generation !== catalogGeneration) return
        const { catalog: result, inspection, material } = parseRentalDesktopModelCatalogResult(value)
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(material.content))
        if (disposed || generation !== catalogGeneration) return
        if ([...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') !== material.contentHash)
          throw new Error('AI_RESOURCE_UNAVAILABLE')
        const session = state.getSnapshot().snapshot?.session
        if (!previewVisible('catalog') || session?.status !== 'ready' || result.binding.actorId !== session.actorId || result.binding.tenantId !== session.tenantId
          || result.binding.workspaceId !== session.currentWorkspaceId || Date.parse(result.expiresAt) <= Date.now()
          || JSON.stringify(result.reopenedFrom ? { auditId: result.reopenedFrom.auditId, requestId: result.reopenedFrom.requestId } : null)
            !== JSON.stringify(input.sourceRef ?? null)
          || JSON.stringify(inspection.selection) !== JSON.stringify(input.selection)) throw new Error('AI_SCOPE_CHANGED')
        clearTimeout(catalogExpiry)
        catalogExpiry = setTimeout(() => clearCatalog('expired'), 5000)
        if (!await checkCatalog({ catalog: result, inspection, material }, generation) || disposed || generation !== catalogGeneration) return
        state.update(draft => { draft.catalog = { status: 'ready', result, inspection, material } })
      }).catch(() => {
        if (!disposed && generation === catalogGeneration) { withdrawMaterials('failed') }
      })
    },
    measure: element => {
      const update = () => {
        const rect = element.getBoundingClientRect()
        bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        void present()
      }
      const observer = new ResizeObserver(update)
      const overlays = new MutationObserver(() => { void present() })
      overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'hidden', 'data-state', 'style', 'class'] })
      observer.observe(element); window.addEventListener('resize', update); update()
      return () => { observer.disconnect(); overlays.disconnect(); window.removeEventListener('resize', update); bounds = null; void present() }
    },
  }
  void bridge.read().then(accept).catch(fail)
  ctx.effect(() => bridge.subscribe(accept), 'rental: session projection')
  ctx.effect(() => () => {
    disposed = true
    for (const preview of [...previews.values()]) preview.release()
    withdrawMaterials('inactive')
    if (ctx.layout.panelInfo.getSnapshot().activePanelId === panel) ctx.layout.selectPanel(null)
    void bridge.present({ mode: 'ai', bounds: null }).catch(() => undefined)
  }, 'rental: native presentation')
  ctx.effect(() => {
    const clear = () => { withdrawMaterials('inactive') }
    const visibility = () => { if (document.hidden) clear() }
    window.addEventListener('blur', clear); window.addEventListener('pagehide', clear)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clear(); window.removeEventListener('blur', clear); window.removeEventListener('pagehide', clear)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, 'rental: withdraw inactive business material')
  ctx.effect(() => ctx.locale.register('rental-workbench', { zh, en }), 'rental: dictionaries')
  ctx.slots.inject('sidebar.rental.context', () => ctx.slots.register({ name: 'sidebar.rental.context', locale: 'rental-workbench', inject: () => props }, WorkbenchContext))
  ctx.slots.inject('sidebar.rental.navigation', () => ctx.slots.register({ name: 'sidebar.rental.navigation', locale: 'rental-workbench', inject: () => props }, WorkbenchNavigation))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: 'rental-workbench', inject: () => props }, WorkbenchMain))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'rental.notice', locale: 'rental-workbench', inject: () => props }, WorkbenchToast))
  ctx.effect(() => {
    const previous = document.documentElement.getAttribute('data-rental-work-mode')
    const sync = () => {
      const snapshot = state.getSnapshot()
      document.documentElement.dataset.rentalWorkMode = snapshot.snapshot?.session.status === 'ready' ? workMode.getSnapshot() : ''
    }
    const unsubscribe = state.subscribe(sync)
    const unsubscribeMode = workMode.subscribe(() => { withdrawMaterials('changed'); sync(); void present() })
    const unsubscribePurpose = purpose.subscribe(() => { withdrawMaterials('changed'); sync(); void present() })
    const unsubscribePanel = ctx.layout.panelInfo.subscribe(() => {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== panel && state.getSnapshot().purpose === 'business') {
        withdrawMaterials('changed'); state.update(value => { value.purpose = 'personal' })
      }
    })
    sync()
    return () => {
      unsubscribe(); unsubscribeMode(); unsubscribePurpose(); unsubscribePanel()
      if (previous === null) delete document.documentElement.dataset.rentalWorkMode
      else document.documentElement.setAttribute('data-rental-work-mode', previous)
    }
  }, 'rental: sidebar presentation')
}
