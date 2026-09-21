interface Props {
  idleServerCount: number | null
  onOpen: () => void
}

export default function HandleTab({ idleServerCount, onOpen }: Props) {
  const hasIdle = (idleServerCount ?? 0) > 0

  return (
    <button
      className={hasIdle ? 'handle has-idle' : 'handle'}
      onClick={onOpen}
      aria-label="Open Tool diet audit"
    >
      <span style={{ position: 'relative' }}>
        <span className="handle-icon" />
        {hasIdle && <span className="handle-dot" />}
      </span>
      <span className="handle-badge">
        {idleServerCount === null ? 'scanning' : `${idleServerCount} idle`}
      </span>
    </button>
  )
}
