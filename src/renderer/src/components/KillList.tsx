import { useEffect, useState } from 'react'
import type { ScanResult } from '../../../shared/types'
import { CheckIcon, ChevronLeft, CloseIcon, CopyIcon } from './icons'

interface Props {
  scan: ScanResult
  killList: Set<string>
  onRemove: (id: string) => void
  onBack: () => void
  onRescan: () => void
  onClose: () => void
}

type Snippet = Record<string, { disabledMcpjsonServers: string[] }>

export default function KillList({ scan, killList, onRemove, onBack, onRescan, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [snippet, setSnippet] = useState<Snippet>({})
  const [snippetLoading, setSnippetLoading] = useState(false)

  const flaggedIds = [...killList]
  const flaggedServers = scan.servers.filter((s) => killList.has(s.id))
  const flaggedProjectServers = flaggedServers.filter((s) => s.source === 'project')
  const flaggedPluginServers = flaggedServers.filter((s) => s.source === 'plugin')

  useEffect(() => {
    let cancelled = false
    if (flaggedIds.length === 0) {
      setSnippet({})
      return
    }
    setSnippetLoading(true)
    window.toolDietBridge?.buildSnippet(flaggedIds).then((result) => {
      if (!cancelled) {
        setSnippet(result ?? {})
        setSnippetLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedIds.join(',')])

  const projectCount = Object.keys(snippet).length
  const snippetText = JSON.stringify({ projects: snippet }, null, 2)

  async function handleCopy() {
    if (window.toolDietBridge) {
      await window.toolDietBridge.copyToClipboard(snippetText)
    } else {
      await navigator.clipboard.writeText(snippetText)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="panel" style={{ position: 'relative' }}>
      <div className="panel-header">
        <div className="back-row">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <ChevronLeft />
          </button>
          <div>
            <h1>Kill list</h1>
            <p className="panel-sub">
              {flaggedServers.length} server{flaggedServers.length === 1 ? '' : 's'} flagged
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn close-btn" onClick={onClose} aria-label="Close drawer">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="chip-row">
        {flaggedServers.map((s) => (
          <span key={s.id} className="chip">
            {s.label} &middot; {s.idle ? 'idle' : `${s.totalCalls} calls`}
            <button className="chip-remove" onClick={() => onRemove(s.id)} aria-label={`Remove ${s.label}`}>
              &times;
            </button>
          </span>
        ))}
        {flaggedServers.length === 0 && (
          <div className="empty-state" style={{ padding: '12px 0' }}>
            <span className="empty-icon">
              <CheckIcon />
            </span>
            <span>Nothing flagged yet &mdash; go back, open a server, and add it to the kill list.</span>
          </div>
        )}
      </div>

      <div className="savings-card">
        <p className="savings-label">What this actually does</p>
        <p className="savings-sub" style={{ color: '#c8f0d6' }}>
          For idle project-configured servers, generates the real{' '}
          <code>disabledMcpjsonServers</code> config field below. For idle plugins, there&apos;s no
          verified local snippet &mdash; see the list underneath. Either way, Claude Code&apos;s tool
          search already keeps unused tool schemas out of context by default, so this doesn&apos;t reclaim
          loaded-tool tokens &mdash; it removes the idle connection itself and any wasted tool-search
          round trips.
        </p>
      </div>

      <p className="section-label">
        Generated config snippet{' '}
        {snippetLoading
          ? '· updating…'
          : projectCount > 0
            ? `· ${projectCount} project${projectCount === 1 ? '' : 's'}`
            : ''}
      </p>
      <pre className="snippet">{projectCount > 0 ? snippetText : '{}'}</pre>

      {flaggedPluginServers.length > 0 && (
        <>
          <p className="section-label">Flagged plugins &mdash; remove manually</p>
          <div className="note-box">
            <p className="panel-sub">
              {flaggedPluginServers.map((s) => s.label).join(', ')}. Manage installed plugins with the
              /plugin command in Claude Code &mdash; no generated snippet for these yet.
            </p>
          </div>
        </>
      )}

      <div className="button-row">
        <button
          className="primary-btn secondary"
          onClick={handleCopy}
          disabled={flaggedProjectServers.length === 0}
        >
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy snippet'}
        </button>
        <button className="outline-btn" onClick={onRescan} disabled={flaggedServers.length === 0}>
          Re-scan after restart
        </button>
      </div>

      {copied && <div className="toast">Copied config snippet to clipboard</div>}
    </div>
  )
}
