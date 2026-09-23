import type { ScanResult } from '../../shared/types'

export {}

declare global {
  interface Window {
    toolDietBridge?: {
      setExpanded: (expanded: boolean) => Promise<void>
      runScan: (sinceDays: number) => Promise<ScanResult>
      showContextMenu: () => Promise<void>
      openConnect: () => Promise<void>
    }
  }
}
