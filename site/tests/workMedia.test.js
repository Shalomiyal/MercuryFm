import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(),
    },
  },
}))

import { buildWorkMediaPaths } from '../src/lib/media'
import {
  buildFeedTimeline,
  formatDividerLabel,
  formatDuration,
  formatSystemMessage,
} from '../src/components/feed/feedUtils'
import {
  clearSignedUrlCache,
  getCachedSignedUrl,
  invalidateSignedUrl,
  setCachedSignedUrl,
} from '../src/components/feed/signedUrlCache'

describe('buildWorkMediaPaths', () => {
  it('builds tenant-scoped storage and thumbnail paths', () => {
    const result = buildWorkMediaPaths({
      schemaName: 'org_mercuryfm',
      cleanerId: 'cleaner-uuid-1',
      workDate: '2026-11-25',
      dailyTaskId: 42,
      stage: 'start',
      ext: 'jpg',
      timestamp: 1700000000000,
    })

    expect(result.storagePath).toBe(
      'org_mercuryfm/cleaner-uuid-1/2026-11-25/42_start_1700000000000.jpg',
    )
    expect(result.thumbPath).toBe(
      'org_mercuryfm/cleaner-uuid-1/2026-11-25/42_start_1700000000000_thumb.jpg',
    )
  })

  it('normalizes finish stage and extension', () => {
    const result = buildWorkMediaPaths({
      schemaName: 'org_demo',
      cleanerId: 'u2',
      workDate: '2026-11-25',
      dailyTaskId: 7,
      stage: 'finish',
      ext: '.MP4',
      timestamp: 123,
    })

    expect(result.storagePath).toBe('org_demo/u2/2026-11-25/7_finish_123.mp4')
    expect(result.thumbPath).toBe('org_demo/u2/2026-11-25/7_finish_123_thumb.jpg')
  })

  it('throws when required fields are missing', () => {
    expect(() =>
      buildWorkMediaPaths({ schemaName: '', cleanerId: 'u1', workDate: '2026-11-25', dailyTaskId: 1, stage: 'start' }),
    ).toThrow()
  })
})

describe('feedUtils', () => {
  it('formats Today, Yesterday, and older date dividers', () => {
    expect(formatDividerLabel('2026-11-25', '2026-11-25', '2026-11-24')).toBe('Today')
    expect(formatDividerLabel('2026-11-24', '2026-11-25', '2026-11-24')).toBe('Yesterday')
    expect(formatDividerLabel('2026-11-20', '2026-11-25', '2026-11-24')).toContain('20 Nov 2026')
  })

  it('formats video duration in m:ss', () => {
    expect(formatDuration(24)).toBe('0:24')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(null)).toBe('')
  })

  it('formats system status events', () => {
    const label = formatSystemMessage({
      room_id: '101',
      status: 'clean_start',
      created_at: '2026-11-25T08:55:00.000Z',
    })
    expect(label).toContain('Room 101')
    expect(label).toContain('Clean started')
  })

  it('inserts date dividers and groups close posts from same cleaner/task/stage', () => {
    const timeline = buildFeedTimeline([
      {
        itemType: 'media',
        post_id: 'p1',
        cleaner_id: 'c1',
        daily_task_id: 10,
        stage: 'start',
        created_at: '2026-11-25T08:00:00.000Z',
      },
      {
        itemType: 'media',
        post_id: 'p2',
        cleaner_id: 'c1',
        daily_task_id: 10,
        stage: 'start',
        created_at: '2026-11-25T08:02:00.000Z',
      },
      {
        itemType: 'media',
        post_id: 'p3',
        cleaner_id: 'c1',
        daily_task_id: 10,
        stage: 'finish',
        created_at: '2026-11-25T08:20:00.000Z',
      },
      {
        itemType: 'system',
        post_id: 'sys-1',
        room_id: '101',
        status: 'ready',
        created_at: '2026-11-25T08:25:00.000Z',
      },
    ])

    expect(timeline.map((t) => t.type)).toEqual(['divider', 'bubble', 'bubble', 'system'])
    expect(timeline[1].posts).toHaveLength(2)
    expect(timeline[2].posts).toHaveLength(1)
  })
})

describe('signedUrlCache', () => {
  beforeEach(() => {
    clearSignedUrlCache()
  })

  it('returns cached URL before expiry and expires after TTL', () => {
    const now = 1_000_000
    setCachedSignedUrl('org_a/u1/file.jpg', 'https://signed.example/1', 3600, now)

    expect(getCachedSignedUrl('org_a/u1/file.jpg', now + 10_000)).toBe('https://signed.example/1')
    // Refresh buffer is 60s before 3600s expiry
    expect(getCachedSignedUrl('org_a/u1/file.jpg', now + 3_540_000)).toBeNull()
  })

  it('invalidates individual paths', () => {
    const now = 1_000_000
    setCachedSignedUrl('org_a/u1/file.jpg', 'https://signed.example/1', 3600, now)
    invalidateSignedUrl('org_a/u1/file.jpg')
    expect(getCachedSignedUrl('org_a/u1/file.jpg', now + 100)).toBeNull()
  })
})
