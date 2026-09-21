import type { ScanResult } from '../../shared/types'

export {}

declare global {
  interface Window {
    toolDietBridge?: {
      setExpanded: (expanded: boolean) => Promise<void>
      copyToClipboard: (text: string) => Promise<void>
      runScan: (sinceDays: number) => Promise<ScanResult>
      buildSnippet: (
        flaggedServerIds: string[]
      ) => Promise<Record<string, { disabledMcpjsonServers: string[] }>>
      showContextMenu: () => Promise<void>
    }
  }
}
