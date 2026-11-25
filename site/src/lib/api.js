import { supabase } from './supabase'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export function apiUrl(path) {
  return `${API_BASE_URL}/api${path}`
}

async function apiRequest(path, { method = 'POST', body, authenticated = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (authenticated) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    /* empty or non-JSON response */
  }
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.')
    error.code = data.code
    error.retryAfter = data.retryAfter
    error.status = response.status
    throw error
  }
  return data
}

export function apiPost(path, body) {
  return apiRequest(path, { method: 'POST', body })
}

export function apiPostAuthed(path, body) {
  return apiRequest(path, { method: 'POST', body, authenticated: true })
}
