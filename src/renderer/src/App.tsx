import { useCallback, useEffect, useRef, useState } from 'react'
import HandleTab from './components/HandleTab'
import Dashboard from './components/Dashboard'
import Drilldown from './components/Drilldown'
import KillList from './components/KillList'
import type { ScanResult } from '../../shared/types'

type View = 'idle' | 'dashboard' | 'drilldown' | 'killlist'

const SINCE_DAYS = 7

export default function App() {
  const [view, setView] = useState<View>('idle')
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [killList, setKillList] = useState<Set<string>>(new Set())
  const [isResizing, setIsResizing] = useState(false)
  const wasExpandedRef = useRef(false)

  const runScan = useCallback(async () => {
    setLoading(true)
    const result = await window.toolDietBridge?.runScan(SINCE_DAYS)
    if (result) setScan(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    runScan()
  }, [runScan])

  useEffect(() => {
    const expanded = view !== 'idle'
    window.toolDietBridge?.setExpanded(expanded)

    // Only when actually crossing the idle <-> expanded boundary does the
    // native window resize (dashboard/drilldown/killlist are all the same
    // window width, so navigating between them never resizes anything).
    // While the OS animates that resize, our CSS layout keeps reflowing to
    // match the in-between widths, which can flash an OS/webkit scrollbar
    // for a frame or two — suppressed here for the animation's duration.
    if (expanded !== wasExpandedRef.current) {
      wasExpandedRef.current = expanded
      setIsResizing(true)
      const timer = setTimeout(() => setIsResizing(false), 320)
      return () => clearTimeout(timer)
    }
  }, [view])

  const idleServerCount = scan ? scan.servers.filter((s) => s.idle).length : null
  const activeServer = scan?.servers.find((s) => s.id === activeServerId) ?? null

  function toggleServerInKillList(id: string) {
    setKillList((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAppliedRescan() {
    setKillList(new Set())
    setActiveServerId(null)
    await runScan()
    setView('idle')
  }

  // Just collapses the drawer back to the idle handle — doesn't touch the
  // scan, the kill list, or quit the app. Quitting is a separate action
  // (right-click → Quit), not what closing the drawer means.
  function closeDrawer() {
    setActiveServerId(null)
    setView('idle')
  }

  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault()
    window.toolDietBridge?.showContextMenu()
  }

  return (
    <div
      className={isResizing ? 'app-shell is-resizing' : 'app-shell'}
      onContextMenu={handleContextMenu}
    >
      {view === 'idle' && (
        <HandleTab idleServerCount={idleServerCount} onOpen={() => setView('dashboard')} />
      )}

      {view === 'dashboard' && (
        <Dashboard
          scan={scan}
          loading={loading}
          onSelectServer={(id) => {
            setActiveServerId(id)
            setView('drilldown')
          }}
          onViewKillList={() => setView('killlist')}
          onRefresh={runScan}
          onClose={closeDrawer}
        />
      )}

      {view === 'drilldown' && activeServer && scan && (
        <Drilldown
          server={activeServer}
          sinceDays={scan.sinceDays}
          inKillList={killList.has(activeServer.id)}
          onToggle={() => toggleServerInKillList(activeServer.id)}
          onBack={() => setView('dashboard')}
          onViewKillList={() => setView('killlist')}
          onClose={closeDrawer}
        />
      )}

      {view === 'killlist' && scan && (
        <KillList
          scan={scan}
          killList={killList}
          onRemove={toggleServerInKillList}
          onBack={() => setView('dashboard')}
          onRescan={handleAppliedRescan}
          onClose={closeDrawer}
        />
      )}
    </div>
  )
}
