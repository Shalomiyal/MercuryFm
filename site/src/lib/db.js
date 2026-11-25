import { supabase } from './supabase'

let cachedSchema = null
let cachePromise = null

export async function resolveMySchema() {
  if (cachedSchema) return cachedSchema
  if (cachePromise) return cachePromise

  cachePromise = supabase.rpc('my_schema').then(({ data, error }) => {
    if (error) throw error
    if (!data) throw new Error('No active organization is assigned to this account.')
    cachedSchema = data
    return data
  })
  return cachePromise
}

export async function db() {
  const schemaName = await resolveMySchema()
  return supabase.schema(schemaName)
}

export function clearTenantCache() {
  cachedSchema = null
  cachePromise = null
}
