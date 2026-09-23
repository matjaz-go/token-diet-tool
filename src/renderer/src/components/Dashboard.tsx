import type { ScanResult } from '../../../shared/types'
import { CheckIcon, CloseIcon, RefreshIcon } from './icons'
import { formatTokens, formatRelativeTime, formatUsd, formatPct } from '../format'
import FindingRow from './FindingRow'

interface Props {
  scan: ScanResult | null
  loading: boolean
  onSelectServer: (id: string) => void
  onRefresh: () => void
  onClose: () => void
}

export default function Dashboard({ scan, loading, onSelectServer, onRefresh, onClose }: Props) {
  const idleCount = scan ? scan.servers.filter((s) => s.idle).length : 0
  const toolsCalled = scan ? scan.servers.reduce((sum, s) => sum + s.tools.length, 0) : 0
  const maxCalls = scan ? Math.max(1, ...scan.servers.map((s) => s.totalCalls)) : 1

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h1>Tool diet audit</h1>
          <p className="panel-sub">
            Claude Code &middot;{' '}
            {scan ? `scanned ${formatRelativeTime(scan.scannedAt)}` : 'scanning…'}
          </p>
        </div>
        <div className="header-actions">
          <button
            className={loading ? 'icon-btn spinning' : 'icon-btn'}
            onClick={onRefresh}
            aria-label="Re-scan"
            disabled={loading}
          >
            <RefreshIcon />
          </button>
          <button className="icon-btn close-btn" onClick={onClose} aria-label="Close drawer">
            <CloseIcon />
          </button>
        </div>
      </div>

      {scan?.error && (
        <div className="stat-tile warn">
          <p className="stat-label">Couldn&apos;t scan</p>
          <p className="tool-name">{scan.error}</p>
        </div>
      )}

      {scan && !scan.error && (
        <div className="panel-body">
          {scan.potentialReduction && (
            <div className="savings-card">
              <p className="savings-label">Potential this week</p>
              <p className="savings-value">
                ~{formatTokens(scan.potentialReduction.totalTokens)} tokens (
                {formatPct(scan.potentialReduction.pct)})
              </p>
              <p className="savings-sub" style={{ color: '#c8f0d6' }}>
                Real, de-duplicated reducible total across {scan.potentialReduction.contributors.length}{' '}
                finding{scan.potentialReduction.contributors.length === 1 ? '' : 's'} below.
              </p>
            </div>
          )}

          <div className="stat-grid">
            <div className="stat-tile">
              <p className="stat-label">MCP servers</p>
              <p className="stat-value">{scan.servers.length}</p>
            </div>
            <div className={idleCount > 0 ? 'stat-tile warn' : 'stat-tile'}>
              <p className="stat-label">Idle servers</p>
              <p className="stat-value">{idleCount}</p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Tools called</p>
              <p className="stat-value">{toolsCalled}</p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Context tokens, {scan.sinceDays}d</p>
              <p className="stat-value">{formatTokens(scan.tokensThisWindow)}</p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Spend this week</p>
              <p className="stat-value">
                {scan.weeklySpendUsd !== null ? formatUsd(scan.weeklySpendUsd) : '—'}
              </p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Cache hit rate</p>
              <p className="stat-value">
                {scan.cacheHitRate !== null ? `${Math.round(scan.cacheHitRate * 100)}%` : '—'}
              </p>
            </div>
          </div>

          {scan.findings.length > 0 && (
            <>
              <p className="section-label">Findings</p>
              <div className="findings-list">
                {scan.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} />
                ))}
              </div>
            </>
          )}

          <p className="section-label">
            Servers by usage &middot; {scan.projectsScanned} project
            {scan.projectsScanned === 1 ? '' : 's'} scanned
          </p>

          {scan.servers.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <CheckIcon />
              </span>
              <span>No MCP servers found &mdash; project config, installed plugins, or connectors.</span>
            </div>
          ) : (
            <div className="waste-list">
              {scan.servers.map((s) => (
                <button key={s.id} className="waste-row" onClick={() => onSelectServer(s.id)}>
                  <span className="waste-name">
                    {s.label}
                    {s.source !== 'project' && <span className={`source-tag ${s.source}`}>{s.source}</span>}
                  </span>
                  <span className="waste-track">
                    <span
                      className="waste-fill"
                      style={{
                        width: s.idle ? '3%' : `${Math.max(6, (s.totalCalls / maxCalls) * 100)}%`,
                        background: s.idle ? 'var(--amber)' : 'var(--green)'
                      }}
                    />
                  </span>
                  <span className="waste-fraction">{s.idle ? 'idle' : `${s.totalCalls} calls`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {scan && !scan.error && scan.potentialReduction?.avgPerSessionTokens ? (
        <div className="connect-card">
          <p className="connect-text">
            ~{formatTokens(scan.potentialReduction.avgPerSessionTokens)} wasted tokens per session.
            Is that normal for a team your size?{' '}
            <button
              className="link-btn connect-inline"
              onClick={() => window.toolDietBridge?.openConnect()}
            >
              Connect to find out.
            </button>
          </p>
          <p className="connect-note">
            Computed entirely from your own local data. &ldquo;Connect&rdquo; only opens a GitHub
            Discussion in your browser &mdash; nothing is sent automatically.
          </p>
        </div>
      ) : null}
    </div>
  )
}
