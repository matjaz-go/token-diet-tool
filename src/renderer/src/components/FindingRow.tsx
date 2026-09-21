import { useState } from 'react'
import type { Finding } from '../../../shared/types'
import { formatTokens, formatUsd } from '../format'
import { ChevronLeft } from './icons'

interface Props {
  finding: Finding
}

export default function FindingRow({ finding }: Props) {
  const [expanded, setExpanded] = useState(false)

  const impact =
    typeof finding.impactTokens === 'number'
      ? `${formatTokens(finding.impactTokens)} tok`
      : typeof finding.impactUsd === 'number'
        ? formatUsd(finding.impactUsd)
        : null

  return (
    <div className={`finding-row status-${finding.status}`}>
      <button className="finding-summary" onClick={() => setExpanded((v) => !v)}>
        <span className="finding-dot" />
        <span className="finding-label">{finding.recommendText || finding.label}</span>
        {impact && <span className="finding-impact">{impact}</span>}
        <span className={expanded ? 'finding-chevron expanded' : 'finding-chevron'}>
          <ChevronLeft />
        </span>
      </button>
      {expanded && (
        <div className="finding-detail">
          <p className="panel-sub">{finding.detail}</p>
          {finding.fix && finding.fix.length > 0 && (
            <ul className="finding-fix">
              {finding.fix.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
