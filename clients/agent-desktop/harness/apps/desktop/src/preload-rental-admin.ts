/** Preload for the owned Rental OS main frame only. Credentials stay in the original Web authentication flow. */
import { contextBridge, ipcRenderer } from 'electron'
import { RENTAL_DESKTOP_PROTOCOL_VERSION, type RentalAdminDesktopBridge, type RentalDesktopCommandRequest } from '@rental-os/shared/agent-desktop'
import { RENTAL_IPC } from './rental-desktop-protocol.ts'

const approved = process.argv.find(value => value.startsWith('--rental-admin-origin='))?.slice('--rental-admin-origin='.length)
if (process.isMainFrame && approved === location.origin) {
  const connected: Promise<string> = ipcRenderer.invoke(RENTAL_IPC.connect, RENTAL_DESKTOP_PROTOCOL_VERSION)
  void connected.catch((_error: unknown) => { console.error('Rental OS document connection unavailable') })
  const send = async (channel: string, value: unknown): Promise<void> => {
    const document = await connected
    await ipcRenderer.invoke(channel, { document, value })
  }
  const bridge: RentalAdminDesktopBridge = {
    protocolVersion: RENTAL_DESKTOP_PROTOCOL_VERSION,
    report: session => send(RENTAL_IPC.report, session),
    complete: result => send(RENTAL_IPC.complete, result),
    onCommand: listener => {
      const receive = (_event: Electron.IpcRendererEvent, envelope: { document: string; value: RentalDesktopCommandRequest }) => {
        void connected.then(document => { if (envelope.document === document) listener(envelope.value) }).catch((_error: unknown) => {
          console.error('Rental OS document connection unavailable')
        })
      }
      ipcRenderer.on(RENTAL_IPC.command, receive)
      return () => { ipcRenderer.off(RENTAL_IPC.command, receive) }
    },
  }
  contextBridge.exposeInMainWorld('rentalDesktopAdmin', bridge)
}
