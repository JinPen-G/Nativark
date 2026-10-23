/** Rental OS desktop-only slot registrations. No agent, model or business executor is replaced. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RentalDesktopBridge, RentalDesktopSnapshot, RentalDesktopCommand } from '@rental-os/shared/agent-desktop'
import { RENTAL_DESKTOP_PROTOCOL_VERSION, parseRentalDesktopSession, parseRentalDesktopCatalogQuery, parseRentalDesktopCatalogResult } from '@rental-os/shared/agent-desktop'
import { WorkbenchContext, WorkbenchNavigation, WorkbenchMain, WorkbenchToast } from './Workbench.tsx'
import type { WorkbenchInjected, WorkbenchState } from './contract.ts'
import { zh, en } from './locales.ts'

export const inject = ['slots', 'layout', 'locale']
/** Register only when the owned native bridge has a configured Rental OS view. @param ctx - client plugin context. */
export function apply(ctx: Context): void {
  const bridge = (globalThis as typeof globalThis & { rentalDesktop?: RentalDesktopBridge }).rentalDesktop
  if (bridge?.protocolVersion !== RENTAL_DESKTOP_PROTOCOL_VERSION) return
  const state = createSnapshotStore<WorkbenchState>({ snapshot: null, busy: false, failed: false, notice: null, catalog: { busy: false, failed: false, result: null } })
  let catalogGeneration = 0
  let catalogExpiry: ReturnType<typeof setTimeout> | undefined
  const clearCatalog = () => {
    catalogGeneration++
    clearTimeout(catalogExpiry)
    state.update(value => { value.catalog = { busy: false, failed: false, result: null } })
  }
  let noticeSequence = 0
  const panel = 'rental-business' as MainPanelId
  const workMode = {
    getSnapshot: (): 'ai' | 'traditional' => ctx.layout.panelInfo.getSnapshot().activePanelId === panel ? 'traditional' : 'ai',
    subscribe: (listener: () => void) => ctx.layout.panelInfo.subscribe(listener),
  }
  let disposed = false
  let aiPanel: MainPanelId | null = ctx.layout.panelInfo.getSnapshot().activePanelId
  let bounds: { x: number; y: number; width: number; height: number } | null = null
  const fail = () => { if (!disposed) { clearCatalog(); state.update(value => { value.failed = true; value.busy = false }) } }
  const present = () => {
    const overlay = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [role="alert"], [data-shell-overlay] > *')]
      .some(node => node.getClientRects().length > 0)
    return bridge.present({ mode: workMode.getSnapshot(), bounds: overlay ? null : bounds }).catch(fail)
  }
  const accept = (value: RentalDesktopSnapshot) => {
    if (disposed) return
    try {
      if (value.protocolVersion !== RENTAL_DESKTOP_PROTOCOL_VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Unsupported desktop projection')
      const session = parseRentalDesktopSession(value.session)
      const previous = state.getSnapshot().snapshot
      if (previous && value.revision < previous.revision) return
      if (JSON.stringify(previous?.session) !== JSON.stringify(session)) clearCatalog()
      state.update(draft => { draft.snapshot = { protocolVersion: value.protocolVersion, revision: value.revision, session } })
    } catch (_error) {
      clearCatalog()
      // Invalid native data cannot leave the previous menu usable.
      state.update(draft => { draft.snapshot = null; draft.failed = true; draft.busy = false })
      void bridge.present({ mode: 'ai', bounds: null }).catch(fail)
    }
  }
  const request = (command: RentalDesktopCommand) => {
    if (disposed || state.getSnapshot().busy || state.getSnapshot().snapshot?.session.status !== 'ready') return
    state.update(value => { value.busy = true; value.failed = false })
    void bridge.request(command).then(() => {
      if (!disposed) state.update(value => { value.busy = false; value.notice = { sequence: ++noticeSequence, ok: true } })
    }, () => {
      if (!disposed) state.update(value => { value.busy = false; value.notice = { sequence: ++noticeSequence, ok: false } })
    })
  }
  const revision = () => state.getSnapshot().snapshot?.revision ?? 0
  const props: WorkbenchInjected = {
    hooks: { business: state, workMode },
    changeMode: mode => {
      state.update(value => { value.failed = false })
      if (mode === 'traditional' && workMode.getSnapshot() === 'ai') aiPanel = ctx.layout.panelInfo.getSnapshot().activePanelId
      try { ctx.layout.selectPanel(mode === 'ai' ? aiPanel : panel) }
      catch (_error) { ctx.layout.selectPanel(null); aiPanel = null; fail() }
      void present()
    },
    navigate: routeId => { request({ kind: 'navigate', routeId, revision: revision() }) },
    switchWorkspace: workspaceId => { request({ kind: 'switch-workspace', workspaceId, revision: revision() }) },
    logout: () => { request({ kind: 'logout', revision: revision() }) },
    retry: () => { void bridge.retry().catch(fail) },
    dismissNotice: () => { state.update(value => { value.notice = null }) },
    discardCatalog: clearCatalog,
    readCatalog: query => {
      const before = state.getSnapshot()
      if (disposed || before.busy || before.catalog.busy || before.snapshot?.session.status !== 'ready') return
      clearCatalog()
      const generation = catalogGeneration
      let input
      try { input = parseRentalDesktopCatalogQuery(query) }
      catch { state.update(value => { value.catalog.failed = true }); return }
      state.update(value => { value.catalog.busy = true })
      // Human-only preview. It neither inserts facts into a conversation nor attests a model destination.
      void Promise.resolve().then(() => {
        if (!bridge.catalog) throw new Error('AI_RESOURCE_UNAVAILABLE')
        return bridge.catalog(input)
      }).then(value => {
        if (disposed || generation !== catalogGeneration) return
        const result = parseRentalDesktopCatalogResult(value)
        const session = state.getSnapshot().snapshot?.session
        if (session?.status !== 'ready' || result.binding.actorId !== session.actorId || result.binding.tenantId !== session.tenantId
          || result.binding.workspaceId !== session.currentWorkspaceId || Date.parse(result.expiresAt) <= Date.now()) throw new Error('AI_SCOPE_CHANGED')
        state.update(draft => { draft.catalog = { busy: false, failed: false, result } })
        catalogExpiry = setTimeout(clearCatalog, Math.max(0, Date.parse(result.expiresAt) - Date.now()))
      }).catch(() => {
        if (!disposed && generation === catalogGeneration) state.update(value => { value.catalog = { busy: false, failed: true, result: null } })
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
    catalogGeneration++; clearTimeout(catalogExpiry)
    if (workMode.getSnapshot() === 'traditional') ctx.layout.selectPanel(null)
    void bridge.present({ mode: 'ai', bounds: null }).catch(() => undefined)
  }, 'rental: native presentation')
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
    const unsubscribeMode = workMode.subscribe(() => { sync(); void present() })
    sync()
    return () => {
      unsubscribe(); unsubscribeMode()
      if (previous === null) delete document.documentElement.dataset.rentalWorkMode
      else document.documentElement.setAttribute('data-rental-work-mode', previous)
    }
  }, 'rental: sidebar presentation')
}
