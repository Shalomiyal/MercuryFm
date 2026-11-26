import { useCallback, useEffect, useState } from 'react'
import WorkFeed from '../components/feed/WorkFeed'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { db } from '../lib/db'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function WorkFeedPage() {
  const { revision } = useDataRefresh()
  const [cleaners, setCleaners] = useState([])
  const [branches, setBranches] = useState([])

  const loadLookups = useCallback(async () => {
    try {
      const orgDb = await db()
      const [cleanerRes, branchRes] = await Promise.all([
        orgDb.from('members').select('id, full_name').eq('role', 'cleaner').eq('is_active', true).order('full_name'),
        orgDb.from('branches').select('branch_id').order('branch_id'),
      ])
      if (!cleanerRes.error) setCleaners(cleanerRes.data || [])
      if (!branchRes.error) setBranches(branchRes.data || [])
    } catch {
      // WorkFeed handles its own error/empty states
    }
  }, [])

  useEffect(() => {
    loadLookups()
  }, [loadLookups, revision])

  return (
    <section className="content-page work-feed-page">
      <WorkFeed workDate={today()} cleaners={cleaners} branches={branches} fullHeight />
    </section>
  )
}
