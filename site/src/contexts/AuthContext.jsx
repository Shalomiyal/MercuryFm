import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase } from '../lib/supabase'
import { clearTenantCache } from '../lib/db'

const AuthContext = createContext(null)

// Always reload from the database. Admin/cleaner details live in the tenant
// schema, so the public row alone cannot tell us whether the first password
// change or email verification has completed.
async function loadProfile(userId) {
  // One RPC replaces the profile + schema + tenant-user calls on startup.
  // Older databases keep working through the fallback below.
  try {
    const { data: contextData, error: contextError } =
      await supabase.rpc('get_my_context')
    const payload = Array.isArray(contextData) ? contextData[0] : contextData
    if (!contextError && payload?.profile) {
      const tenantUser = Array.isArray(payload.tenant_user)
        ? payload.tenant_user[0]
        : payload.tenant_user
      return {
        profile: tenantUser
          ? {
              ...payload.profile,
              full_name: tenantUser.full_name ?? payload.profile.full_name,
              phone: tenantUser.phone ?? null,
              is_active: tenantUser.is_active ?? null,
              must_change_password:
                tenantUser.must_change_password ?? payload.profile.must_change_password,
            }
          : payload.profile,
        schemaName: payload.schema_name || null,
      }
    }
  } catch (contextException) {
    console.warn('Startup context RPC unavailable; using fallback:', contextException?.message)
  }

  let data = null
  let error = null
  try {
    const result = await supabase
      .from('profiles')
      .select('id, full_name, role, org_id, must_change_password, email_verified')
      .eq('id', userId)
      .maybeSingle()
    data = result.data
    error = result.error
  } catch (profileException) {
    error = profileException
  }

  let nextSchemaName = null
  if (!error && data) {
    if (data.role !== 'platform_admin') {
      const { data: resolvedSchema, error: schemaError } = await supabase.rpc('my_schema')
      if (!schemaError) nextSchemaName = resolvedSchema || null

      // Admin/cleaner details live in the tenant users table; public.profiles
      // is only the auth map for these roles.
      if (!['platform_admin', 'org_admin'].includes(data.role)) {
        const { data: tenantUser, error: tenantError } =
          await supabase.rpc('my_tenant_user')
        if (!tenantError && tenantUser?.[0]) {
          data = {
            ...data,
            full_name: tenantUser[0].full_name,
            phone: tenantUser[0].phone,
            is_active: tenantUser[0].is_active,
            must_change_password: tenantUser[0].must_change_password,
          }
        }
      }
    }
  }

  return { profile: error ? null : data, schemaName: nextSchemaName }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [schemaName, setSchemaName] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function applySession(nextSession) {
      if (!active) return
      clearTenantCache()
      setSession(nextSession)
      if (!nextSession) {
        setProfile(null)
        setSchemaName(null)
        setLoading(false)
        return
      }

      setLoading(true)
      const { profile: nextProfile, schemaName: nextSchema } =
        await loadProfile(nextSession.user.id)
      if (active) {
        setProfile(nextProfile)
        setSchemaName(nextSchema)
        setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session))
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => applySession(nextSession),
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  // Call this after any server-side change to the profile or tenant user row
  // (password change, admin reset, email verification) so redirects use fresh
  // values instead of the profile captured at login.
  const refreshProfile = useCallback(async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    if (!currentSession?.user) {
      setProfile(null)
      setSchemaName(null)
      return null
    }
    const { profile: nextProfile, schemaName: nextSchema } =
      await loadProfile(currentSession.user.id)
    setProfile(nextProfile)
    setSchemaName(nextSchema)
    return nextProfile
  }, [])

  const value = useMemo(
    () => ({
      session,
      profile,
      setProfile,
      loading,
      schemaName,
      refreshProfile,
      signIn: (email, password) =>
        supabase.auth.signInWithPassword({ email, password }),
      signOut: () => {
        clearTenantCache()
        return supabase.auth.signOut()
      },
    }),
    [session, profile, schemaName, loading, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
