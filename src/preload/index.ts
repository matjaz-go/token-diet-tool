import { contextBridge, ipcRenderer } from 'electron'
import type { ScanResult } from '../shared/types'

contextBridge.exposeInMainWorld('toolDietBridge', {
  setExpanded: (expanded: boolean) => ipcRenderer.invoke('window:set-expanded', expanded),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  runScan: (sinceDays: number): Promise<ScanResult> => ipcRenderer.invoke('scan:run', sinceDays),
  buildSnippet: (flaggedServerIds: string[]): Promise<Record<string, { disabledMcpjsonServers: string[] }>> =>
    ipcRenderer.invoke('scan:snippet', flaggedServerIds),
  showContextMenu: () => ipcRenderer.invoke('window:context-menu')
})
