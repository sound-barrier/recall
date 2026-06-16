import { describe, it, expect } from 'vitest'
import { useManualMatchForm } from '@/composables/matches/useManualMatchForm'

describe('useManualMatchForm', () => {
  it('requires map, mode, queue, result, and at least one hero', () => {
    const f = useManualMatchForm()
    expect(f.canSubmit.value).toBe(false)
    f.map.value = 'ilios'
    f.playMode.value = 'competitive'
    f.queueType.value = 'open' // open queue needs no role category
    f.result.value = 'victory'
    expect(f.canSubmit.value).toBe(false) // no hero yet
    f.addHero('ana')
    expect(f.canSubmit.value).toBe(true)
  })

  it('requires a role category in role queue, but not in open queue', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.playMode.value = 'competitive'
    f.result.value = 'victory'
    f.addHero('ana')

    // Role queue: a single role is mandatory (it constrains the hero list).
    f.queueType.value = 'role'
    expect(f.missingRequired.value).toContain('role')
    expect(f.canSubmit.value).toBe(false)
    f.roleCategory.value = 'support'
    expect(f.missingRequired.value).not.toContain('role')
    expect(f.canSubmit.value).toBe(true)

    // Open queue: any role mix is allowed, so role isn't required.
    f.queueType.value = 'open'
    f.roleCategory.value = ''
    expect(f.missingRequired.value).not.toContain('role')
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

  it('blocks submit on an out-of-range rank and clears once valid', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.queueType.value = 'open'
    f.result.value = 'victory'
    f.addHero('ana')
    f.playMode.value = 'competitive'
    f.rankTier.value = 'platinum'
    expect(f.canSubmit.value).toBe(true) // progress 0 / change 0 are valid

    f.rankProgress.value = 150
    expect(f.rankValid.value).toBe(false)
    expect(f.rankError.value).toMatch(/0 and 100/)
    expect(f.canSubmit.value).toBe(false)

    f.rankProgress.value = 50
    f.rankChange.value = 2_000_000
    expect(f.rankValid.value).toBe(false)
    expect(f.canSubmit.value).toBe(false)

    f.rankChange.value = 25
    expect(f.rankValid.value).toBe(true)
    expect(f.canSubmit.value).toBe(true)
  })

  it('does not validate rank when no tier is set', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.queueType.value = 'open'
    f.result.value = 'victory'
    f.addHero('ana')
    f.playMode.value = 'competitive'
    f.rankProgress.value = 999 // ignored: no tier, so no rank is sent
    expect(f.rankActive.value).toBe(false)
    expect(f.canSubmit.value).toBe(true)
  })

  it('includes leaver only when one is picked', () => {
    const f = useManualMatchForm()
    expect(f.toInput().leaver).toBeUndefined()
    f.leaver.value = 'team'
    expect(f.toInput().leaver).toBe('team')
  })

  it('carries optional replay code, note, lowercased tags, and verbatim group members', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.playMode.value = 'quickplay'
    f.queueType.value = 'open'
    f.result.value = 'victory'
    f.addHero('ana')
    f.replayCode.value = '  A1B2C3  '
    f.note.value = '  great comeback  '
    f.addTag('Clutch')
    f.addTag('clutch') // dedupes case-insensitively
    f.addTag('stream')
    f.addMember('Apollo#11234')
    f.addMember('Apollo#11234') // dedupes verbatim

    const input = f.toInput()
    expect(input.replay_code).toBe('A1B2C3')
    expect(input.note).toBe('great comeback')
    expect(input.tags).toEqual(['clutch', 'stream'])
    expect(input.members).toEqual(['Apollo#11234'])
  })

  it('omits the optional annotation fields when left blank', () => {
    const f = useManualMatchForm()
    f.map.value = 'ilios'
    f.playMode.value = 'quickplay'
    f.queueType.value = 'open'
    f.result.value = 'victory'
    f.addHero('ana')

    const input = f.toInput()
    expect(input.replay_code).toBeUndefined()
    expect(input.note).toBeUndefined()
    expect(input.tags).toBeUndefined()
    expect(input.members).toBeUndefined()
  })

  it('removeTag / removeMember drop a chip', () => {
    const f = useManualMatchForm()
    f.addTag('clutch')
    f.addMember('Apollo#11234')
    f.removeTag('clutch')
    f.removeMember('Apollo#11234')
    expect(f.tags.value).toEqual([])
    expect(f.members.value).toEqual([])
  })
})
