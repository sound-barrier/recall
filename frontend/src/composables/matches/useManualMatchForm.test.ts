import { describe, it, expect } from 'vitest'
import { useManualMatchForm } from '@/composables/matches/useManualMatchForm'

describe('useManualMatchForm', () => {
  it('requires map, mode, queue, result, and at least one hero', () => {
    const f = useManualMatchForm()
    expect(f.canSubmit.value).toBe(false)
    f.map.value = 'ilios'
    f.playMode.value = 'competitive'
    f.queueType.value = 'role'
    f.result.value = 'victory'
    expect(f.canSubmit.value).toBe(false) // no hero yet
    f.addHero('ana')
    expect(f.canSubmit.value).toBe(true)
  })

  it('addHero dedupes and keeps the first as primary; removeHero drops', () => {
    const f = useManualMatchForm()
    f.addHero('ana')
    f.addHero('ana') // duplicate ignored
    f.addHero('kiriko')
    expect(f.heroes.value).toEqual(['ana', 'kiriko'])
    expect(f.primaryHero.value).toBe('ana')
    f.removeHero('ana')
    expect(f.heroes.value).toEqual(['kiriko'])
    expect(f.primaryHero.value).toBe('kiriko')
  })

  it('toInput builds the wire payload with an ISO played_at and no rank for quickplay', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.playMode.value = 'quickplay'
    f.queueType.value = 'open'
    f.result.value = 'defeat'
    f.addHero('reinhardt')
    f.playedAt.value = '2026-06-15T14:30'

    const input = f.toInput()
    expect(input.map).toBe('ilios')
    expect(input.play_mode).toBe('quickplay')
    expect(input.queue_type).toBe('open')
    expect(input.heroes).toEqual(['reinhardt'])
    expect(input.result).toBe('defeat')
    expect(input.played_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(input.rank).toBeUndefined()
  })

  it('includes rank only for competitive with a tier set', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.queueType.value = 'role'
    f.result.value = 'victory'
    f.addHero('ana')
    f.playMode.value = 'competitive'
    f.rankTier.value = 'platinum'
    f.rankDivision.value = 3
    f.rankProgress.value = 45
    f.rankChange.value = 22
    f.demotionProtection.value = true

    expect(f.toInput().rank).toEqual({
      tier: 'platinum', division: 3, progress: 45, change_percent: 22, demotion_protection: true,
    })
  })
})
