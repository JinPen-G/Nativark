/** Non-secret UI projection and callback shares; the native-view owner handles IPC. */
import type { RentalDesktopBounds, RentalDesktopSnapshot } from '@rental-os/shared/agent-desktop'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RentalWorkbenchKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export interface WorkbenchState {
  snapshot: RentalDesktopSnapshot | null
  busy: boolean
  failed: boolean
  notice: { sequence: number; ok: boolean } | null
}
export interface WorkbenchInjected {
  hooks: { business: HostObservable<WorkbenchState>; workMode: HostObservable<'ai' | 'traditional'> }
  changeMode(mode: 'ai' | 'traditional'): void
  navigate(routeId: string): void
  switchWorkspace(workspaceId: string): void
  logout(): void
  retry(): void
  dismissNotice(): void
  measure(element: HTMLElement): () => void
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rental-workbench': RentalWorkbenchKey }
}
export type ContextProps = PropsRuntime<'sidebar.rental.context'> & PropsLocale<'rental-workbench'> & InjectFace<WorkbenchInjected>
export type NavigationProps = PropsRuntime<'sidebar.rental.navigation'> & PropsLocale<'rental-workbench'> & InjectFace<WorkbenchInjected>
export type MainProps = PropsRuntime<'main'> & PropsLocale<'rental-workbench'> & InjectFace<WorkbenchInjected>
export type ToastProps = PropsRuntime<'shell.overlay'> & PropsLocale<'rental-workbench'> & InjectFace<WorkbenchInjected>
export type BusinessBounds = RentalDesktopBounds
