function initialsFor(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export default function Avatar({ name = '', src = '', size = 'md', className = '' }) {
  return (
    <span className={`wt-avatar wt-avatar-${size} ${className}`} title={name || undefined}>
      {src ? <img src={src} alt={name || 'User'} /> : <span>{initialsFor(name)}</span>}
    </span>
  )
}

export function AvatarGroup({ users = [], max = 4, size = 'sm' }) {
  const visible = users.slice(0, max)
  const overflow = Math.max(0, users.length - visible.length)
  return (
    <div className="wt-avatar-group">
      {visible.map((user, index) => (
        <Avatar
          key={user.id || user.name || index}
          name={user.name || user.full_name}
          src={user.src}
          size={size}
        />
      ))}
      {overflow > 0 ? (
        <span className={`wt-avatar wt-avatar-${size} wt-avatar-overflow`}>+{overflow}</span>
      ) : null}
    </div>
  )
}
