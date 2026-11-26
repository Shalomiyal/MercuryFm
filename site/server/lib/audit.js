import { adminClient } from './serverSupabase.js'

let auditFunctionMissing = false

// Best-effort audit write. Auditing must never turn a successful mutation into
// a failed response when the migration has not been applied yet.
export async function writeAuditLog({
  actorId = null,
  action,
  orgId = null,
  targetUserId = null,
  metadata = {},
}) {
  if (!action || auditFunctionMissing) return
  try {
    const { error } = await adminClient().rpc('write_audit_log', {
      p_actor_id: actorId,
      p_action: action,
      p_org_id: orgId,
      p_target_user_id: targetUserId,
      p_metadata: metadata,
    })
    if (error) {
      if (/could not find the function public\.write_audit_log/i.test(error.message)) {
        auditFunctionMissing = true
      } else {
        console.warn('[audit] write failed:', error.message)
      }
    }
  } catch (error) {
    console.warn('[audit] write failed:', error?.message || error)
  }
}
