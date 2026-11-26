// useFeedPosts.js — data hook for the Work Feed
// Queries task_runs + embedded relations + room_status_history,
// batch-signs storage thumbnails, subscribes to Realtime, and falls back to 15s polling.

import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { getSignedUrlsBatch } from './signedUrlCache'

const PAGE_SIZE = 30
const POLL_INTERVAL_MS = 15_000

// ── Seed / mock data ──────────────────────────────────────────────────────────
function buildSeedItems(workDate) {
  const baseDate = workDate || new Date().toISOString().slice(0, 10)
  const ts = (hhmm) => `${baseDate}T${hhmm}:00.000Z`

  return [
    {
      itemType: 'system',
      post_id: 'seed-sys-1',
      room_id: '101',
      status: 'clean_start',
      created_at: ts('08:55'),
      isMock: true,
    },
    {
      itemType: 'media',
      post_id: 'seed-1',
      id: 'seed-1',
      daily_task_id: 1001,
      kind: 'photo',
      stage: 'start',
      cleaner_id: 'seed-c1',
      cleaner_name: 'Shalo Fernando',
      branch_id: 'Main Branch',
      room_id: '101',
      task_name: 'Bathroom Clean',
      template_name: 'Morning Turnover',
      work_date: baseDate,
      created_at: ts('08:56'),
      file_url: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=960&q=80',
      thumbnail_url: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=320&q=70',
      duration_seconds: null,
      caption: 'Room entrance photographed before cleaning.',
      isMock: true,
    },
    {
      itemType: 'media',
      post_id: 'seed-2',
      id: 'seed-2',
      daily_task_id: 1002,
      kind: 'photo',
      stage: 'start',
      cleaner_id: 'seed-c2',
      cleaner_name: 'Priya Nair',
      branch_id: 'West Wing',
      room_id: '102',
      task_name: 'Linen Change',
      template_name: 'Morning Turnover',
      work_date: baseDate,
      created_at: ts('09:05'),
      file_url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=960&q=80',
      thumbnail_url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=320&q=70',
      duration_seconds: null,
      caption: null,
      isMock: true,
    },
    {
      itemType: 'media',
      post_id: 'seed-3',
      id: 'seed-3',
      daily_task_id: 1001,
      kind: 'video',
      stage: 'finish',
      cleaner_id: 'seed-c1',
      cleaner_name: 'Shalo Fernando',
      branch_id: 'Main Branch',
      room_id: '101',
      task_name: 'Bathroom Clean',
      template_name: 'Morning Turnover',
      work_date: baseDate,
      created_at: ts('09:14'),
      file_url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=960&q=80',
      thumbnail_url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=320&q=70',
      duration_seconds: 24,
      caption: null,
      isMock: true,
    },
    {
      itemType: 'system',
      post_id: 'seed-sys-2',
      room_id: '101',
      status: 'ready',
      created_at: ts('09:16'),
      isMock: true,
    },
    {
      itemType: 'media',
      post_id: 'seed-4',
      id: 'seed-4',
      daily_task_id: 1003,
      kind: 'photo',
      stage: 'start',
      cleaner_id: 'seed-c3',
      cleaner_name: 'Ramesh Kumar',
      branch_id: 'Main Branch',
      room_id: '201',
      task_name: 'Deep Vacuum',
      template_name: 'VIP Inspection',
      work_date: baseDate,
      created_at: ts('09:28'),
      file_url: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=960&q=80',
      thumbnail_url: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=320&q=70',
      duration_seconds: null,
      caption: null,
      isMock: true,
    },
  ]
}

function isMissingColumnError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return (
    msg.includes('branch_id') ||
    msg.includes('room_id') ||
    msg.includes('storage_path') ||
    msg.includes('thumb_path') ||
    msg.includes('duration_seconds')
  )
}

function normalizeRuns(runData) {
  const rows = []
  for (const run of runData || []) {
    const dt = run.daily_tasks
    const da = dt?.daily_assignments
    const member = run.members
    const branchId = run.branch_id || dt?.branch_id || ''
    const roomId = run.room_id || dt?.room_id || ''
    const base = {
      itemType: 'media',
      daily_task_id: dt?.id || run.daily_task_id,
      cleaner_id: run.cleaner_id,
      cleaner_name: member?.full_name || 'Cleaner',
      branch_id: branchId,
      room_id: roomId,
      task_name: dt?.task_name || '',
      template_name: da?.task_templates?.name || '',
      assignment_id: da?.id,
      work_date: da?.work_date || run.run_date,
      caption: null,
      file_url: null,
      thumbnail_url: null,
      isMock: false,
    }
    if (run.start_photo_id) {
      const media = run.start_photo || {}
      rows.push({
        ...base,
        post_id: `${run.id}-photo`,
        id: run.id,
        kind: 'photo',
        stage: 'start',
        media_id: run.start_photo_id,
        storage_path: media.storage_path || null,
        thumb_path: media.thumb_path || null,
        duration_seconds: media.duration_seconds ?? null,
        created_at: run.started_at,
      })
    }
    if (run.finish_video_id) {
      const media = run.finish_video || {}
      rows.push({
        ...base,
        post_id: `${run.id}-video`,
        id: run.id,
        kind: 'video',
        stage: 'finish',
        media_id: run.finish_video_id,
        storage_path: media.storage_path || null,
        thumb_path: media.thumb_path || null,
        duration_seconds: media.duration_seconds ?? null,
        created_at: run.finished_at,
      })
    }
  }
  return rows
}

export function useFeedPosts({ workDate, allDates = false, schemaName, revision = 0 }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isMock, setIsMock] = useState(false)
  const oldestTsRef = useRef(null)
  const channelRef = useRef(null)
  const pollTimerRef = useRef(null)

  const fetchPage = useCallback(async ({ beforeTimestamp = null } = {}) => {
    const orgDb = await db()

    let runsQuery = orgDb
      .from('task_runs')
      .select(`
        id,
        run_date,
        started_at,
        finished_at,
        start_photo_id,
        finish_video_id,
        state,
        cleaner_id,
        branch_id,
        room_id,
        members(id, full_name),
        daily_tasks!inner(
          id,
          task_name,
          branch_id,
          room_id,
          daily_assignments!inner(
            id,
            work_date,
            task_templates(name)
          )
        ),
        start_photo:media!start_photo_id(id, storage_path, thumb_path, duration_seconds, width, height),
        finish_video:media!finish_video_id(id, storage_path, thumb_path, duration_seconds, width, height)
      `)
      .order('started_at', { ascending: false })
      .limit(PAGE_SIZE + 1)

    if (!allDates && workDate) {
      runsQuery = runsQuery.eq('daily_tasks.daily_assignments.work_date', workDate)
    }
    if (beforeTimestamp) {
      runsQuery = runsQuery.lt('started_at', beforeTimestamp)
    }

    let { data: runData, error: runError } = await runsQuery

    if (runError && isMissingColumnError(runError)) {
      let fallbackQuery = orgDb
        .from('task_runs')
        .select(`
          id,
          run_date,
          started_at,
          finished_at,
          start_photo_id,
          finish_video_id,
          state,
          cleaner_id,
          members(id, full_name),
          daily_tasks!inner(
            id,
            task_name,
            daily_assignments!inner(
              id,
              work_date,
              task_templates(name)
            )
          )
        `)
        .order('started_at', { ascending: false })
        .limit(PAGE_SIZE + 1)

      if (!allDates && workDate) {
        fallbackQuery = fallbackQuery.eq('daily_tasks.daily_assignments.work_date', workDate)
      }
      if (beforeTimestamp) {
        fallbackQuery = fallbackQuery.lt('started_at', beforeTimestamp)
      }
      const fallback = await fallbackQuery
      runData = fallback.data
      runError = fallback.error
    }

    if (runError) throw runError

    const hasNext = (runData || []).length > PAGE_SIZE
    const slicedRuns = hasNext ? runData.slice(0, PAGE_SIZE) : runData || []
    const mediaRows = normalizeRuns(slicedRuns)

    // Batch-sign thumbnail URLs for visible storage items
    const thumbPaths = mediaRows.map((r) => r.thumb_path || r.storage_path).filter(Boolean)
    if (thumbPaths.length > 0) {
      await getSignedUrlsBatch(thumbPaths).catch(() => {})
    }

    // Fetch room_status_history system events (only on initial page load or date filter)
    let systemRows = []
    if (!beforeTimestamp) {
      let histQuery = orgDb
        .from('room_status_history')
        .select('id, room_id, status, status_time, created_by')
        .order('status_time', { ascending: false })
        .limit(20)

      if (!allDates && workDate) {
        histQuery = histQuery
          .gte('status_time', `${workDate}T00:00:00`)
          .lte('status_time', `${workDate}T23:59:59.999`)
      }

      const [{ data: histData }, { data: memberRows }, { data: profileRows }] = await Promise.all([
        histQuery,
        orgDb.from('members').select('id, full_name'),
        supabase.from('profiles').select('id, full_name'),
      ])
      const memberById = Object.fromEntries([
        ...(profileRows || []).map((p) => [p.id, p.full_name]),
        ...(memberRows || []).map((m) => [m.id, m.full_name]),
      ])
      systemRows = (histData || []).map((h) => ({
        itemType: 'system',
        post_id: `sys-${h.id}`,
        room_id: h.room_id,
        status: h.status,
        created_by: h.created_by || null,
        updated_by_name: h.created_by ? memberById[h.created_by] || '' : '',
        created_at: h.status_time,
        isMock: false,
      }))
    }

    const combined = [...mediaRows, ...systemRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )

    const oldestStarted = slicedRuns.length
      ? slicedRuns[slicedRuns.length - 1]?.started_at || null
      : null

    return { items: combined, hasNext, oldestStarted }
  }, [workDate, allDates])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { items, hasNext, oldestStarted } = await fetchPage()
      oldestTsRef.current = oldestStarted
      setHasMore(hasNext)

      if (items.length === 0) {
        setIsMock(true)
        setPosts(buildSeedItems(workDate))
        setHasMore(false)
      } else {
        setIsMock(false)
        setPosts(items)
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load feed.')
    } finally {
      setLoading(false)
    }
  }, [fetchPage, workDate])

  // Incremental silent sync: appends/updates only new items without resetting scroll or showing loading skeleton
  const syncLatest = useCallback(async () => {
    try {
      const { items } = await fetchPage()
      if (items.length === 0) return
      setIsMock(false)
      setPosts((prev) => {
        const realPrev = prev.filter((p) => !p.isMock)
        const byId = new Map(realPrev.map((p) => [p.post_id, p]))
        let changed = realPrev.length !== prev.length
        for (const item of items) {
          const existing = byId.get(item.post_id)
          if (
            !existing ||
            existing.created_at !== item.created_at ||
            existing.storage_path !== item.storage_path ||
            existing.thumb_path !== item.thumb_path
          ) {
            byId.set(item.post_id, item)
            changed = true
          }
        }
        if (!changed) return prev
        return Array.from(byId.values()).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
      })
    } catch {
      // Silent background sync: keep existing chat intact on transient errors
    }
  }, [fetchPage])

  const loadMore = useCallback(async () => {
    if (isMock || loadingMore || !hasMore || !oldestTsRef.current) return
    setLoadingMore(true)
    try {
      const { items, hasNext, oldestStarted } = await fetchPage({
        beforeTimestamp: oldestTsRef.current,
      })
      oldestTsRef.current = oldestStarted
      setHasMore(hasNext)
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.post_id))
        const fresh = items.filter((p) => !existingIds.has(p.post_id))
        return [...fresh, ...prev].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
      })
    } catch (loadMoreError) {
      console.warn('Feed load-more error:', loadMoreError)
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, hasMore, isMock, loadingMore])

  useEffect(() => {
    if (!schemaName) return undefined

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current).catch(() => {})
    }

    try {
      channelRef.current = supabase
        .channel(`work-feed:${schemaName}:${allDates ? 'all' : workDate}`)
        .on('postgres_changes', { event: 'INSERT', schema: schemaName, table: 'task_runs' }, () => {
          syncLatest()
        })
        .on('postgres_changes', { event: 'UPDATE', schema: schemaName, table: 'task_runs' }, () => {
          syncLatest()
        })
        .on('postgres_changes', { event: 'INSERT', schema: schemaName, table: 'room_status_history' }, () => {
          syncLatest()
        })
        .subscribe()
    } catch (rtError) {
      console.warn('Feed realtime unavailable, polling only:', rtError)
    }

    pollTimerRef.current = setInterval(syncLatest, POLL_INTERVAL_MS)

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current).catch(() => {})
        channelRef.current = null
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [schemaName, workDate, allDates, syncLatest])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (revision > 0) {
      syncLatest()
    }
  }, [revision, syncLatest])

  return { posts, loading, error, hasMore, loadingMore, reload: syncLatest, loadMore, isMock }
}
