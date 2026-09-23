import type { RealServer } from '../../../shared/types'
import { ChevronLeft, CloseIcon } from './icons'

interface Props {
  server: RealServer
  sinceDays: number
  onBack: () => void
  onClose: () => void
}

const SOURCE_NOTE: Record<RealServer['source'], string | null> = {
  project: null,
  plugin:
    'Installed via Claude Code’s plugin system, not project config. Manage installed plugins with the /plugin command.',
  connector:
    'A claude.ai account connector, not local config. This only knows it was connected at some point — not whether it still is. Manage it at claude.ai → Settings → Connectors.',
  unknown:
    'Tool calls with this prefix were found in your session logs, but it doesn’t match any known config, plugin, or connector source.'
}

export default function Drilldown({ server, sinceDays, onBack, onClose }: Props) {
  const note = SOURCE_NOTE[server.source]

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="back-row">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <ChevronLeft />
          </button>
          <div>
            <h1>
              {server.label}
              {server.source !== 'project' && (
                <span className={`source-tag ${server.source}`}>{server.source}</span>
              )}
            </h1>
            <p className="panel-sub">
              {server.idle
                ? server.idleConfidence === 'low'
                  ? `No calls in the last ${sinceDays} days — based on limited local signal, see note below`
                  : `No calls in the last ${sinceDays} days`
                : `${server.totalCalls} call${server.totalCalls === 1 ? '' : 's'} in the last ${sinceDays} days · ${server.tools.length} distinct tool${server.tools.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn close-btn" onClick={onClose} aria-label="Close drawer">
            <CloseIcon />
          </button>
        </div>
      </div>

      {server.alwaysLoad && (
        <div className="stat-tile warn">
          <p className="stat-label">alwaysLoad: true</p>
          <p className="tool-name">
            Connects eagerly at startup &mdash; skips tool search&apos;s default deferral, whether or not
            it&apos;s used.
          </p>
        </div>
      )}

      {note && (
        <div className="note-box">
          <p className="panel-sub">{note}</p>
        </div>
      )}

      {server.tools.length > 0 ? (
        <div className="tool-list">
          {server.tools.map((tool) => (
            <div key={tool.name} className="tool-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
              <span className="tool-name">{tool.name}</span>
              <span className="tool-calls">{tool.calls}</span>
              <span className="badge used">used</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-sub">
          No tool calls recorded for this server in the window. Tool-diet can&apos;t see the full list of
          tools it exposes without connecting to it &mdash; but zero calls this window is a real signal
          it&apos;s idle.
        </p>
      )}
    </div>
  )
}
