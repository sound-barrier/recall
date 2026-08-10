import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import EditableStat from './EditableStat.vue'

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
