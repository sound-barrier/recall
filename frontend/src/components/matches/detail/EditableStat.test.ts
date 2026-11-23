import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldRegion } from '@/api'
import { setApiBacking } from '@/api-client'
import EditableStat from '@/components/matches/detail/EditableStat.vue'
import { resetWriteGate } from '@/test-utils/writeGateStub'

// The source crop reads the write gate (a coaching session loans no files).
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

const user = () => userEvent.setup()

async function edit(label: string, value: string) {
  const u = user()
  await u.click(screen.getByRole('button', { name: new RegExp(`${label}: .*Click to edit`) }))
  const input = screen.getByLabelText(`Edit ${label}`)
  await u.clear(input)
  await u.type(input, `${value}{Enter}`)
}

describe('EditableStat numeric validation', () => {
  it('rejects a negative number: shows an inline error, keeps editing, no commit', async () => {
    const { emitted } = render(EditableStat, { props: { label: 'Damage', value: 100, kind: 'number' } })
    await edit('Damage', '-5')
    expect(emitted('commit')).toBeUndefined()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Edit Damage')).toBeInTheDocument() // stays open to fix
  })

  it('rejects a value above max', async () => {
    const { emitted } = render(EditableStat, { props: { label: 'Damage', value: 100, kind: 'number', max: 1000 } })
    await edit('Damage', '5000')
    expect(emitted('commit')).toBeUndefined()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('commits a valid in-range number and shows no error', async () => {
    const { emitted } = render(EditableStat, { props: { label: 'Damage', value: 100, kind: 'number' } })
    await edit('Damage', '250')
    expect(emitted('commit')?.[0]).toEqual([250])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not range-check text fields', async () => {
    const { emitted } = render(EditableStat, { props: { label: 'Note', value: 'a', kind: 'text' } })
    await edit('Note', '-5')
    expect(emitted('commit')?.[0]).toEqual(['-5'])
  })
})

const FILE = 'summary.png'
const region = (field = 'data.damage'): FieldRegion => ({
  source_file: FILE, dir_id: 0, field,
  x: 400, y: 300, width: 80, height: 40, image_width: 1920, image_height: 1080,
})

describe('EditableStat — the source crop', () => {
  beforeEach(() => {
    resetWriteGate()
    setActivePinia(createPinia())
    // The crop warms the ui store's preload registry, whose store graph
    // reads the match cluster on first use.
    setApiBacking({
      GetMatchResults: vi.fn(async () => []),
      GetFailedFiles: vi.fn(async () => []),
      GetNewScreenshotCount: vi.fn(async () => ({ count: 0, parked: 0 })),
    })
  })

  it('offers no disclosure when the value has no source to show', () => {
    render(EditableStat, { props: { label: 'Damage', value: 100 } })
    expect(screen.queryByRole('button', { name: /^Show source/ })).not.toBeInTheDocument()
  })

  it('reveals every crop behind "Show source", each captioned with its screen', async () => {
    const crops = [
      { region: region(), caption: 'SUMMARY · read 74' },
      { region: { ...region(), source_file: 'teams.png' }, caption: 'TEAMS · read 9' },
    ]
    const { emitted } = render(EditableStat, { props: { label: 'Damage', value: 100, source: { status: 'ready', crops } } })
    const toggle = screen.getByRole('button', { name: 'Show source of Damage' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('img', { name: /^Source crop/ })).not.toBeInTheDocument()

    await user().click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(emitted('show-source')).toHaveLength(1)
    expect(screen.getByRole('figure', { name: 'SUMMARY · read 74' }))
      .toContainElement(screen.getByRole('img', { name: `Source crop of Damage from ${FILE}` }))
    expect(screen.getByRole('figure', { name: 'TEAMS · read 9' }))
      .toContainElement(screen.getByRole('img', { name: 'Source crop of Damage from teams.png' }))

    await user().click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('img', { name: /^Source crop/ })).not.toBeInTheDocument()
  })

  it.each([
    [{ status: 'pending' } as const, 'Loading where this value was read…'],
    [{ status: 'error' } as const, "Couldn't load where this value was read."],
    [{ status: 'ready', crops: [] } as const, 'No crop recorded for this value — Re-parse All records where each value was read.'],
  ])('says so when the source is %o', async (source, note) => {
    render(EditableStat, { props: { label: 'Damage', value: 100, source } })
    await user().click(screen.getByRole('button', { name: 'Show source of Damage' }))
    expect(screen.getByText(note)).toBeInTheDocument()
  })
})

describe('EditableStat — a flagged value', () => {
  it('still shows what was read, marked as left out, and asks for its review', async () => {
    const { emitted } = render(EditableStat, { props: { label: 'Elims', value: 74, flag: { state: 'open' } } })
    const value = screen.getByRole('button', { name: /^Elims: 74\. Click to edit\./ })
    expect(value).toHaveAccessibleDescription('Left out of stats — needs review')

    await user().click(screen.getByRole('button', { name: 'Review Elims in Unknown' }))
    expect(emitted('review')).toHaveLength(1)
  })

  it('says nothing once the flag is settled', () => {
    render(EditableStat, { props: { label: 'Elims', value: 74, flag: { state: 'confirmed' } } })
    expect(screen.queryByText('Left out of stats — needs review')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument()
  })

  it('still marks the value under a write lock, but offers no review it could not act on', () => {
    render(EditableStat, { props: { label: 'Elims', value: 74, flag: { state: 'open' }, locked: true } })
    expect(screen.getByText('Left out of stats — needs review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument()
  })

  // E/A/D are one line: a flag on one leaves its siblings out too, and each
  // says whose review it waits on rather than offering one of its own.
  it("marks a value left out by a sibling's flag, naming that flag", () => {
    render(EditableStat, { props: { label: 'Assists', value: 9, leftOutWith: 'Eliminations' } })
    expect(screen.getByRole('button', { name: /^Assists: 9\./ }))
      .toHaveAccessibleDescription('Left out of stats — Eliminations needs review')
    expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument()
  })
})
