import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import SessionsWidget from '@/components/dashboard/widgets/SessionsWidget.vue'
import { renderWidget } from '@/test-utils'

describe('Sessions', () => {
  it('Sessions shows the session count', () => {
    renderWidget(SessionsWidget, { dossier: { sessions: 7 } })
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
