import { contextBridge, ipcRenderer } from 'electron'
import type { ScanResult } from '../shared/types'

contextBridge.exposeInMainWorld('toolDietBridge', {
  setExpanded: (expanded: boolean) => ipcRenderer.invoke('window:set-expanded', expanded),
  runScan: (sinceDays: number): Promise<ScanResult> => ipcRenderer.invoke('scan:run', sinceDays),
  showContextMenu: () => ipcRenderer.invoke('window:context-menu'),
  // Opens a fixed GitHub Discussion in the real browser — see
  // main/index.ts's CONNECT_DISCUSSION_URL. Takes no argument on purpose.
  openConnect: () => ipcRenderer.invoke('connect:open')
})
