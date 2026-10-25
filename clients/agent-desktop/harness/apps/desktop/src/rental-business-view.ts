/** Owns one isolated admin document, non-secret session projection, navigation and closed catalog/source reads. */
import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { WebContentsView, session, ipcMain, dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'
import { RENTAL_DESKTOP_PROTOCOL_VERSION, parseRentalDesktopSession, parseRentalDesktopCommand, parseRentalDesktopBounds,
  parseRentalDesktopCatalogQuery, parseRentalDesktopCatalogResult,
  parseRentalDesktopModelCatalogQuery, parseRentalDesktopModelCatalogResult, parseRentalDesktopModelInspection,
  projectRentalDesktopCatalogMaterial,
  parseRentalDesktopCatalogSourcesQuery, parseRentalDesktopCatalogSourcesResult,
  type RentalDesktopBusinessReadRequest, type RentalDesktopBusinessReadResult,
  type RentalDesktopModelSelection,
  type RentalDesktopCatalogResult,
  type RentalDesktopSnapshot, type RentalDesktopSession, type RentalDesktopBounds, type RentalDesktopCommand } from '@rental-os/shared/agent-desktop'
import { RENTAL_IPC } from './rental-desktop-protocol.ts'
import type { RentalDesktopConfig } from './rental-desktop-config.ts'

/** Business authentication does not grant access to the local Host. The approved document retains the original Web login. */
export class RentalBusinessView {
  private view: WebContentsView | undefined
  private statusView: WebContentsView | undefined
  private readonly previews = new Set<BrowserWindow>()
  private readonly downloads = new Set<Electron.DownloadItem>()
  private stopDownloads: (() => void) | undefined
  private owner: BrowserWindow | undefined
  private snapshot: RentalDesktopSnapshot = { protocolVersion: RENTAL_DESKTOP_PROTOCOL_VERSION, revision: 0, session: { status: 'unavailable' } }
  private mode: 'ai' | 'traditional' = 'ai'
  private bounds: RentalDesktopBounds | null = null
  private pending: { id: string; document: string; command: RentalDesktopCommand; session: RentalDesktopSession; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  private lostAcknowledgement: string | undefined
  private lostDocument: string | undefined
  private heartbeat: ReturnType<typeof setTimeout> | undefined
  private documentDeadline: ReturnType<typeof setTimeout> | undefined
  private unknownCommand = false
  private disposed = false
  private document: string | undefined
  private unloadingDocument: string | undefined
  private loading: Promise<void> | undefined
  private failurePrompt: Promise<void> | undefined
  private readonly origin: string
  private readonly waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>()
  private readonly catalogReads = new Map<string, { document: string; request: RentalDesktopBusinessReadRequest;
    resolve: (result: RentalDesktopBusinessReadResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private modelReads = 0

  /** Current UI admission; every API request still keeps the original business authorization. */
  get ready(): boolean { return this.snapshot.session.status === 'ready' }

  /** Wait for a server-verified business page, never for cached credentials. */
  waitUntilReady(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Business view disposed'))
    if (this.ready) return Promise.resolve()
    return new Promise((resolve, reject) => { this.waiters.add({ resolve, reject }) })
  }

  /** @param config - deployment-owned URL. @param preload - bundled isolated preload. @param admission - login/expiry callback, never a business authorization. */
  constructor(private readonly config: RentalDesktopConfig, private readonly preload: string,
    private readonly admission: (ready: boolean) => void,
    private readonly messages: () => { unavailable: string; reconnect: string; cancel: string; draft: string; download: string },
    private readonly inspectModel?: (selection: RentalDesktopModelSelection) => Promise<unknown>) {
    this.origin = new URL(config.adminUrl).origin
  }

  /** Bind IPC before loading either application document. */
  install(): void {
    ipcMain.handle(RENTAL_IPC.catalog, (event, value: unknown) => { this.assertApplication(event); return this.readCatalog(value) })
    ipcMain.handle(RENTAL_IPC.catalogForModel, (event, value: unknown) => { this.assertApplication(event); return this.readCatalogForModel(value) })
    ipcMain.handle(RENTAL_IPC.catalogSources, (event, value: unknown) => { this.assertApplication(event); return this.readBusiness(value, 'sources').then(parseRentalDesktopCatalogSourcesResult) })
    ipcMain.handle(RENTAL_IPC.catalogComplete, (event, envelope: unknown) => {
      const value = this.adminMessage(event, envelope)
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('id' in value) || typeof value.id !== 'string'
        || !('ok' in value) || typeof value.ok !== 'boolean') throw new Error('Invalid business read response')
      const pending = this.catalogReads.get(value.id)
      if (!pending) return
      this.catalogReads.delete(value.id); clearTimeout(pending.timer)
      try {
        if (Object.keys(value).some(key => !(value.ok ? ['id', 'ok', 'result'] : ['id', 'ok', 'code']).includes(key))) throw Error()
        if (!value.ok) {
          const code = 'code' in value && typeof value.code === 'string'
            && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_INVALID_INPUT', 'AI_RESOURCE_UNAVAILABLE'].includes(value.code)
            ? value.code : 'AI_RESOURCE_UNAVAILABLE'
          pending.reject(new Error(code)); return
        }
        const result = 'kind' in pending.request ? parseRentalDesktopCatalogSourcesResult('result' in value ? value.result : undefined)
          : parseRentalDesktopCatalogResult('result' in value ? value.result : undefined)
        const current = this.snapshot.session
        if (pending.document !== this.document || this.disposed || this.pending || this.unknownCommand || current.status !== 'ready' || current.audience !== 'tenant'
          || current.actorId !== pending.request.binding.actorId || current.tenantId !== pending.request.binding.tenantId
          || current.currentWorkspaceId !== pending.request.binding.workspaceId || result.requestId !== pending.request.id
          || JSON.stringify(result.binding) !== JSON.stringify(pending.request.binding)
          || (!('kind' in pending.request) && (result.execution !== 'read_only'
            || JSON.stringify(result.destination) !== JSON.stringify(pending.request.query.destination)
            || JSON.stringify(result.modelRoute ?? null) !== JSON.stringify(pending.request.query.modelRoute ?? null)
            || JSON.stringify(result.reopenedFrom ? { auditId: result.reopenedFrom.auditId, requestId: result.reopenedFrom.requestId } : null)
              !== JSON.stringify(pending.request.query.sourceRef ?? null)))
          || result.items.length > pending.request.query.limit || Date.parse(result.expiresAt) <= Date.now()) throw Error()
        pending.resolve(result)
      } catch { pending.reject(new Error('AI_RESOURCE_UNAVAILABLE')) }
    })
    ipcMain.handle(RENTAL_IPC.read, event => { this.assertApplication(event); return this.snapshot })
    ipcMain.handle(RENTAL_IPC.connect, (event, version: unknown) => {
      this.assertAdmin(event)
      if (version !== RENTAL_DESKTOP_PROTOCOL_VERSION) {
        this.accept({ status: 'unavailable' })
        this.showFailure()
        throw new Error('Unsupported business protocol')
      }
      // A document connects once from its isolated preload. Its nonce is never exposed to page JavaScript.
      this.unloadingDocument = undefined
      this.document ??= randomUUID()
      return this.document
    })
    ipcMain.handle(RENTAL_IPC.report, (event, envelope: unknown) => {
      const value = this.adminMessage(event, envelope)
      try { this.accept(parseRentalDesktopSession(value)) }
      catch (error) {
        this.accept({ status: 'unavailable' })
        this.showFailure()
        throw error
      }
    })
    ipcMain.handle(RENTAL_IPC.complete, (event, envelope: unknown) => {
      const value = this.adminMessage(event, envelope)
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['id', 'ok'].includes(key))
        || !('id' in value) || !('ok' in value) || typeof value.ok !== 'boolean') throw new Error('Invalid business acknowledgement')
      const pending = this.pending
      if (pending === undefined && value.id === this.lostAcknowledgement) {
        this.lostAcknowledgement = undefined
        this.lostDocument = undefined
        this.unknownCommand = false
        return
      }
      if (pending === undefined || value.id !== pending.id) return
      this.pending = undefined; clearTimeout(pending.timer)
      if (value.ok && this.commandObserved(pending.command, pending.session)) pending.resolve()
      else pending.reject(new Error('Business action refused'))
    })
    ipcMain.handle(RENTAL_IPC.request, (event, value: unknown) => { this.assertApplication(event); return this.request(parseRentalDesktopCommand(value)) })
    ipcMain.handle(RENTAL_IPC.present, (event, value: unknown) => {
      this.assertApplication(event)
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['mode', 'bounds'].includes(key))
        || !('mode' in value) || !['ai', 'traditional'].includes(String(value.mode)) || !('bounds' in value)) throw new Error('Invalid business presentation')
      this.mode = value.mode === 'ai' ? 'ai' : 'traditional'
      this.bounds = value.bounds === null ? null : parseRentalDesktopBounds(value.bounds)
      this.present()
    })
    ipcMain.handle(RENTAL_IPC.retry, event => { this.assertApplication(event); return this.retry() })
  }

  /** Create the remote view before admitting the Agent workbench. @param owner - desktop main window. */
  async attach(owner: BrowserWindow): Promise<void> {
    if (this.disposed) throw new Error('Business view disposed')
    if (this.owner) this.accept({ status: 'unavailable' })
    this.close()
    this.owner = owner
    const partition = `persist:rental-admin-${createHash('sha256').update(this.origin).digest('hex')}`
    const browserSession = session.fromPartition(partition)
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    const view = new WebContentsView({ webPreferences: { session: browserSession, preload: this.preload,
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      backgroundThrottling: false, additionalArguments: [`--rental-admin-origin=${this.origin}`] } })
    this.view = view
    const download = (event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => {
      if (contents !== view.webContents && ![...this.previews].some(popup => popup.webContents === contents)) return
      const chain = item.getURLChain()
      const allowed = chain.length > 0 && chain.every(url => {
        try { return url.startsWith(`blob:${this.origin}/`) || this.downloadAllowed(new URL(url)) }
        catch (_error) { return false }
      })
      if (!this.ready || !allowed) { event.preventDefault(); return }
      item.setSaveDialogOptions({ defaultPath: basename(item.getFilename()).replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_') })
      this.downloads.add(item)
      item.once('done', (_event, state) => {
        this.downloads.delete(item)
        if (state === 'interrupted' && this.owner && !this.owner.isDestroyed()) void dialog.showMessageBox(this.owner,
          { type: 'warning', message: this.messages().download, buttons: [this.messages().cancel] }).catch((_error: unknown) => {
            console.error('Rental OS download did not complete')
          })
      })
    }
    browserSession.on('will-download', download)
    this.stopDownloads = () => { browserSession.off('will-download', download) }
    view.webContents.setWindowOpenHandler(({ url }) => {
      // The original print page writes an escaped local document into about:blank; previews may use a same-origin Blob.
      const localDocument = url === 'about:blank' || url.startsWith(`blob:${this.origin}/`)
      if (!localDocument || !this.ready) {
        try {
          const target = new URL(url)
          if (this.downloadAllowed(target) && this.ready) view.webContents.downloadURL(url)
        } catch (_error) { /* Invalid or foreign URLs are never opened outside the controlled view. */ }
        return { action: 'deny' }
      }
      return { action: 'allow', overrideBrowserWindowOptions: { parent: owner,
        webPreferences: { preload: '', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } } }
    })
    view.webContents.on('did-create-window', popup => {
      this.previews.add(popup)
      popup.once('closed', () => { this.previews.delete(popup) })
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      popup.webContents.on('will-navigate', event => { event.preventDefault() })
    })
    const allowed = (url: string) => {
      try { const next = new URL(url); return next.origin === this.origin && !next.username && !next.password
        && next.pathname.startsWith(new URL(this.config.adminUrl).pathname) }
      catch { return false }
    }
    view.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
    view.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
    view.webContents.on('will-attach-webview', event => { event.preventDefault() })
    view.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace && this.view === view) {
        this.unloadingDocument = this.document
        this.document = undefined
        this.accept({ status: 'unavailable' })
        clearTimeout(this.documentDeadline)
        // A loaded HTML document is not a verified login or a functioning page bridge.
        this.documentDeadline = setTimeout(() => {
          if (this.view !== view || this.disposed) return
          if (this.loading && !view.webContents.isDestroyed()) view.webContents.stop()
          this.accept({ status: 'unavailable' })
          this.showFailure()
        }, 20_000)
      }
    })
    view.webContents.on('will-prevent-unload', () => {
      // Do not preventDefault: Electron then keeps the original document and its unsaved fields.
      this.document = this.unloadingDocument ?? this.document
      this.unloadingDocument = undefined
      const owner = this.owner
      if (owner && !owner.isDestroyed()) void dialog.showMessageBox(owner, { type: 'info', message: this.messages().draft,
        buttons: [this.messages().cancel] }).catch((_error: unknown) => { console.error('Rental OS draft notice unavailable') })
    })
    const failed = () => { if (this.view === view) { this.accept({ status: 'unavailable' }); this.showFailure() } }
    view.webContents.on('render-process-gone', failed)
    view.webContents.on('preload-error', failed)
    view.webContents.on('destroyed', failed)
    view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3 && this.view === view) { this.accept({ status: 'unavailable' }); this.showFailure() }
    })
    owner.contentView.addChildView(view)
    const statusView = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, webviewTag: false } })
    this.statusView = statusView
    statusView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    statusView.webContents.on('will-navigate', event => { event.preventDefault() })
    owner.contentView.addChildView(statusView)
    statusView.setVisible(false)
    const escape = (text: string) => text.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;color-scheme:light dark;background:Canvas;color:CanvasText;font:14px system-ui}body{display:grid;place-content:center;padding:32px;box-sizing:border-box}p{max-width:36rem;line-height:1.7}</style><p role="alert">${escape(this.messages().unavailable)}</p>`
    owner.on('resize', this.onResize)
    owner.once('closed', this.onClosed)
    this.present()
    await statusView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    if (this.disposed || this.view !== view || owner.isDestroyed()) throw new Error('Business owner closed during startup')
    await this.reload()
  }

  private downloadAllowed(url: URL): boolean {
    return !url.username && !url.password && ((url.origin === this.origin && ['https:', 'http:'].includes(url.protocol))
      || (url.protocol === 'https:' && this.config.downloadOrigins.includes(url.origin)))
  }
  private onResize = (): void => { this.present() }
  private onClosed = (): void => { this.accept({ status: 'unavailable' }); this.close() }
  private assertAdmin(event: IpcMainInvokeEvent): void {
    const contents = this.view?.webContents
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame
      || new URL(event.senderFrame.url).origin !== this.origin
      || !new URL(event.senderFrame.url).pathname.startsWith(new URL(this.config.adminUrl).pathname)) throw new Error('Rejected business sender')
  }
  private adminMessage(event: IpcMainInvokeEvent, envelope: unknown): unknown {
    this.assertAdmin(event)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).some(key => !['document', 'value'].includes(key))
      || !('document' in envelope) || !('value' in envelope) || !this.document || envelope.document !== this.document) throw new Error('Stale business document')
    return envelope.value
  }
  private assertApplication(event: IpcMainInvokeEvent): void {
    const contents = this.owner?.webContents
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://app/')) throw new Error('Rejected desktop sender')
  }
  private accept(next: RentalDesktopSession): void {
    const previous = this.snapshot.session
    const changed = JSON.stringify(previous) !== JSON.stringify(next)
    this.snapshot = { protocolVersion: RENTAL_DESKTOP_PROTOCOL_VERSION, revision: this.snapshot.revision + (changed ? 1 : 0), session: next }
    clearTimeout(this.heartbeat)
    if (next.status !== 'unavailable') {
      clearTimeout(this.documentDeadline)
      if (this.document && this.document !== this.lostDocument && !this.pending) {
        // Reconnection unlocks only after a new owned document reports its current server-verified state.
        this.lostAcknowledgement = undefined
        this.lostDocument = undefined
        this.unknownCommand = false
      }
    }
    if (next.status === 'ready') this.heartbeat = setTimeout(() => {
      this.accept({ status: 'unavailable' })
      this.showFailure()
    }, 60_000)
    const boundary = next.status !== 'ready' || previous.status !== 'ready' || next.actorId !== previous.actorId
      || next.tenantId !== previous.tenantId || next.audience !== previous.audience || next.currentWorkspaceId !== previous.currentWorkspaceId
    const expectedSwitch = previous.status === 'ready' && next.status === 'ready'
      && previous.actorId === next.actorId && previous.tenantId === next.tenantId
      && previous.audience === next.audience
      && this.pending?.command.kind === 'switch-workspace' && this.pending.command.workspaceId === next.currentWorkspaceId
    const expectedLogout = this.pending?.command.kind === 'logout' && next.status === 'signed-out'
    if (boundary && this.pending !== undefined && !expectedSwitch && !expectedLogout) this.failPending()
    if (boundary) {
      this.stopCatalogReads()
      for (const popup of this.previews) if (!popup.isDestroyed()) popup.destroy()
      this.previews.clear()
      for (const item of this.downloads) item.cancel()
      this.downloads.clear()
    }
    if (this.owner && !this.owner.webContents.isDestroyed()) this.owner.webContents.send(RENTAL_IPC.changed, this.snapshot)
    this.present()
    if (next.status === 'ready') { for (const waiter of this.waiters) waiter.resolve(); this.waiters.clear() }
    if (previous.status === 'ready' && next.status === 'ready' && (previous.actorId !== next.actorId || previous.tenantId !== next.tenantId
      || previous.audience !== next.audience || previous.currentWorkspaceId !== next.currentWorkspaceId)) {
      this.admission(false)
      this.admission(true)
    } else if ((previous.status === 'ready') !== (next.status === 'ready')) this.admission(next.status === 'ready')
  }
  private async readCatalogForModel(value: unknown) {
    const input = parseRentalDesktopModelCatalogQuery(value), document = this.document, before = this.snapshot.session
    const inspect = this.inspectModel
    if (!inspect || this.disposed || this.pending || this.unknownCommand || !document || before.status !== 'ready'
      || before.audience !== 'tenant' || !before.currentWorkspaceId || this.modelReads >= 2) throw new Error('AI_RESOURCE_UNAVAILABLE')
    const identity = JSON.stringify(before)
    const current = () => {
      if (this.disposed || this.pending || this.unknownCommand || this.document !== document || JSON.stringify(this.snapshot.session) !== identity)
        throw new Error('AI_SCOPE_CHANGED')
    }
    this.modelReads++
    try {
      const first = parseRentalDesktopModelInspection(await inspect(input.selection)); current()
      if (JSON.stringify(first.selection) !== JSON.stringify(input.selection) || Date.parse(first.expiresAt) <= Date.now()) throw new Error('AI_RESOURCE_UNAVAILABLE')
      const modelRoute = { ...first.destination, model: first.selection.model, protocol: first.protocol }
      const catalog = await this.readCatalog({ limit: input.limit, destination: first.destination, modelRoute,
        ...input.sourceRef ? { sourceRef: input.sourceRef } : {} }); current()
      const last = parseRentalDesktopModelInspection(await inspect(input.selection)); current()
      if (JSON.stringify(last.selection) !== JSON.stringify(input.selection) || JSON.stringify(first.destination) !== JSON.stringify(last.destination)
        || first.protocol !== last.protocol || first.preparationVersion !== last.preparationVersion
        || Date.parse(first.expiresAt) <= Date.now() || Date.parse(last.expiresAt) <= Date.now()
        || Date.parse(catalog.expiresAt) <= Date.now()) throw new Error('AI_RESOURCE_UNAVAILABLE')
      const bounded = { ...catalog, expiresAt: new Date(Math.min(Date.parse(catalog.expiresAt), Date.parse(last.expiresAt))).toISOString() }
      const content = projectRentalDesktopCatalogMaterial(bounded)
      return parseRentalDesktopModelCatalogResult({ catalog: bounded, inspection: last,
        material: { content, contentHash: createHash('sha256').update(content).digest('hex'), purpose: 'human_preview', modelRequest: 'not_sent' } })
    } finally { this.modelReads-- }
  }
  private readCatalog(value: unknown): Promise<RentalDesktopCatalogResult> {
    return this.readBusiness(value, 'catalog').then(parseRentalDesktopCatalogResult)
  }
  private readBusiness(value: unknown, kind: 'catalog' | 'sources'): Promise<RentalDesktopBusinessReadResult> {
    const current = this.snapshot.session
    const document = this.document, view = this.view
    if (!document || !view || view.webContents.isDestroyed() || this.disposed || this.pending || this.unknownCommand
      || current.status !== 'ready' || current.audience !== 'tenant' || !current.currentWorkspaceId || this.catalogReads.size >= 2)
      return Promise.reject(new Error('AI_RESOURCE_UNAVAILABLE'))
    const binding = { actorId: current.actorId, tenantId: current.tenantId, workspaceId: current.currentWorkspaceId }
    const request: RentalDesktopBusinessReadRequest = kind === 'sources'
      ? { kind: 'catalog_sources', id: randomUUID(), query: parseRentalDesktopCatalogSourcesQuery(value), binding }
      : { id: randomUUID(), query: parseRentalDesktopCatalogQuery(value), binding }
    return new Promise<RentalDesktopBusinessReadResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.catalogReads.delete(request.id)) return
        reject(new Error('AI_RESOURCE_UNAVAILABLE'))
      }, 15_000)
      this.catalogReads.set(request.id, { document, request, resolve, reject, timer })
      try { view.webContents.send(RENTAL_IPC.catalogRequest, { document, value: request }) }
      catch { this.catalogReads.delete(request.id); clearTimeout(timer); reject(new Error('AI_RESOURCE_UNAVAILABLE')) }
    })
  }
  private stopCatalogReads(): void {
    for (const pending of this.catalogReads.values()) { clearTimeout(pending.timer); pending.reject(new Error('AI_SCOPE_CHANGED')) }
    this.catalogReads.clear()
  }
  private commandObserved(command: RentalDesktopCommand, before: RentalDesktopSession): boolean {
    const current = this.snapshot.session
    if (command.kind === 'revalidate') return current.status !== 'unavailable'
    if (command.kind === 'logout') return current.status === 'signed-out'
    if (before.status !== 'ready' || current.status !== 'ready' || current.actorId !== before.actorId
      || current.tenantId !== before.tenantId || current.audience !== before.audience) return false
    if (command.kind === 'switch-workspace') return current.currentWorkspaceId === command.workspaceId
    if (command.kind !== 'navigate' || current.currentWorkspaceId !== before.currentWorkspaceId) return false
    const route = current.sections.flatMap(section => section.items).find(item => item.id === command.routeId)
    return route !== undefined && current.pathname === route.path
  }
  private request(command: RentalDesktopCommand): Promise<void> {
    if (command.revision !== this.snapshot.revision || this.pending || this.unknownCommand || !this.view || !this.document) return Promise.reject(new Error('Stale, unknown or pending business request'))
    const current = this.snapshot.session
    if (command.kind !== 'revalidate' && current.status !== 'ready') return Promise.reject(new Error('Business login required'))
    if (current.status === 'ready' && command.kind === 'navigate') {
      const routeId = command.routeId
      if (!current.sections.some(section => section.items.some(item => item.id === routeId))) return Promise.reject(new Error('Unknown business route'))
    }
    if (current.status === 'ready' && command.kind === 'switch-workspace') {
      const workspaceId = command.workspaceId
      if (!current.workspaces.some(workspace => workspace.id === workspaceId)) return Promise.reject(new Error('Unknown business workspace'))
    }
    const id = randomUUID()
    const document = this.document
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending?.id === id) { this.pending = undefined; this.lostAcknowledgement = id; this.lostDocument = document; this.unknownCommand = true; reject(new Error('Business result unknown; reconnect to revalidate')) } }, 20_000)
      this.pending = { id, document, command, session: current, resolve, reject, timer }
      this.view!.webContents.send(RENTAL_IPC.command, { document, value: { id, command,
        session: current.status === 'ready' ? { actorId: current.actorId, tenantId: current.tenantId, workspaceId: current.currentWorkspaceId } : null } })
    })
  }
  private present(): void {
    const owner = this.owner, view = this.view
    if (!owner || owner.isDestroyed()) return
    const { width, height } = owner.getContentBounds()
    const unavailable = this.snapshot.session.status === 'unavailable' || !view || view.webContents.isDestroyed()
    if (this.statusView && !this.statusView.webContents.isDestroyed()) {
      const top = process.platform === 'win32' ? WINDOWS_TITLEBAR_HEIGHT : 48
      this.statusView.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
      this.statusView.setVisible(unavailable)
    }
    if (!view || view.webContents.isDestroyed()) return
    if (unavailable) view.setVisible(false)
    else if (this.snapshot.session.status !== 'ready') {
      const top = process.platform === 'win32' ? WINDOWS_TITLEBAR_HEIGHT : 48
      view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
      view.setVisible(true)
    } else if (this.mode === 'traditional' && this.bounds && this.bounds.width > 0 && this.bounds.height > 0) {
      const bounds = this.bounds
      view.setBounds({ x: Math.min(width, bounds.x), y: Math.min(height, bounds.y),
        width: Math.max(0, Math.min(bounds.width, width - bounds.x)), height: Math.max(0, Math.min(bounds.height, height - bounds.y)) })
      view.setVisible(true)
    } else view.setVisible(false)
  }
  private reload(): Promise<void> {
    if (this.loading) return this.loading
    const view = this.view
    if (!view || view.webContents.isDestroyed()) return Promise.reject(new Error('Business view unavailable'))
    // loadURL uses the original beforeunload guard. Admission is revoked only when navigation actually begins.
    const loading = view.webContents.loadURL(this.config.adminUrl, { extraHeaders: 'Cache-Control: no-cache\n' }).catch((_error: unknown) => {
      if (this.view === view && !this.ready) this.showFailure()
      throw new Error('Rental OS Web unavailable or reload declined')
    }).finally(() => { if (this.loading === loading) this.loading = undefined })
    this.loading = loading
    return loading
  }
  private showFailure(): void {
    const owner = this.owner, view = this.view
    if (!owner || owner.isDestroyed() || this.disposed || this.failurePrompt) return
    const copy = this.messages()
    const prompt = dialog.showMessageBox(owner, { type: 'warning', message: copy.unavailable,
      buttons: [copy.reconnect, copy.cancel], defaultId: 1, cancelId: 1 }).then(async result => {
      if (result.response !== 0 || this.disposed || this.view !== view || this.ready) return
      this.failurePrompt = undefined
      await this.retry().catch((_error: unknown) => { console.error('Rental OS reconnection did not complete') })
    }).catch((_error: unknown) => { console.error('Rental OS unavailable; use the application reconnect menu') })
      .finally(() => { if (this.failurePrompt === prompt) this.failurePrompt = undefined })
    this.failurePrompt = prompt
  }

  /** Retry only the approved Web document, never the previous business command. */
  retry(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Business view disposed'))
    const owner = this.owner
    if (owner && (!this.view || this.view.webContents.isDestroyed())) return this.attach(owner)
    return this.reload()
  }
  private failPending(): void {
    const pending = this.pending
    if (pending) {
      this.pending = undefined
      this.lostAcknowledgement = pending.id
      this.lostDocument = pending.document
      this.unknownCommand = true
      clearTimeout(pending.timer)
      pending.reject(new Error('Business session changed; result must be checked'))
    }
  }
  private close(): void {
    this.stopCatalogReads()
    this.document = undefined
    this.unloadingDocument = undefined
    this.loading = undefined
    this.failurePrompt = undefined
    this.stopDownloads?.(); this.stopDownloads = undefined
    for (const item of this.downloads) item.cancel()
    this.downloads.clear()
    this.failPending(); clearTimeout(this.heartbeat); clearTimeout(this.documentDeadline)
    for (const popup of this.previews) if (!popup.isDestroyed()) popup.destroy()
    this.previews.clear()
    this.owner?.off('resize', this.onResize); this.owner?.off('closed', this.onClosed)
    const view = this.view
    this.view = undefined
    if (view) { this.owner?.contentView.removeChildView(view); if (!view.webContents.isDestroyed()) view.webContents.close() }
    const statusView = this.statusView
    this.statusView = undefined
    if (statusView) { this.owner?.contentView.removeChildView(statusView); if (!statusView.webContents.isDestroyed()) statusView.webContents.close() }
    this.owner = undefined
    this.snapshot = { protocolVersion: RENTAL_DESKTOP_PROTOCOL_VERSION, revision: this.snapshot.revision + 1, session: { status: 'unavailable' } }
  }
  /** Release native ownership and IPC without deleting Web storage, model configuration or session history. */
  dispose(): void {
    this.disposed = true; this.close()
    for (const waiter of this.waiters) waiter.reject(new Error('Business view disposed')); this.waiters.clear()
    for (const channel of [RENTAL_IPC.connect, RENTAL_IPC.read, RENTAL_IPC.report, RENTAL_IPC.complete, RENTAL_IPC.request, RENTAL_IPC.present, RENTAL_IPC.retry,
      RENTAL_IPC.catalog, RENTAL_IPC.catalogComplete, RENTAL_IPC.catalogForModel, RENTAL_IPC.catalogSources]) ipcMain.removeHandler(channel)
  }
}
