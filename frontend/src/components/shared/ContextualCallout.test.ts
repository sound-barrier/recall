import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import ContextualCallout from '@/components/shared/ContextualCallout.vue'

beforeEach(() => {
  // Each test runs against a fresh body so the Teleport-target lookups
  // don't see stale callouts from prior assertions.
  document.body.innerHTML = ''
})

function makeAnchor(): HTMLElement {
  const el = document.createElement('div')
  el.id = 'anchor'
  el.getBoundingClientRect = () => ({
    top: 100, bottom: 130, left: 200, right: 300, width: 100, height: 30,
    x: 200, y: 100, toJSON: () => ({}),
  } as DOMRect)
  document.body.appendChild(el)
  return el
}

const user = () => userEvent.setup()

describe('ContextualCallout', () => {
  it('renders the heading + body when an anchor exists', async () => {
    makeAnchor()
    render(ContextualCallout, {
      props: {
        target:  '#anchor',
        heading: 'Welcome to the picker',
        body:    'Each card maps to one capture tool.',
      },
    })
    // Allow the next-tick reposition to land.
    await new Promise((r) => setTimeout(r, 30))
    const callout = screen.getByRole('dialog')
    expect(callout).toHaveTextContent('Welcome to the picker')
    expect(callout).toHaveTextContent('Each card maps to one capture tool.')
  })

  it('emits dismiss when the close glyph is clicked', async () => {
    makeAnchor()
    const { emitted } = render(ContextualCallout, {
      props: {
        target:  '#anchor',
        heading: 'Hi',
        body:    'Body',
      },
    })
    await new Promise((r) => setTimeout(r, 30))
    await user().click(screen.getByRole('button', { name: 'Dismiss this hint' }))
    expect(emitted('dismiss')).toBeTruthy()
  })

  it('renders + emits the action button when actionLabel is passed', async () => {
    makeAnchor()
    const { emitted } = render(ContextualCallout, {
      props: {
        target:      '#anchor',
        heading:     'Hi',
        body:        'Body',
        actionLabel: 'Got it',
      },
    })
    await new Promise((r) => setTimeout(r, 30))
    await user().click(screen.getByRole('button', { name: 'Got it' }))
    expect(emitted('action')).toBeTruthy()
  })

  it('hides itself when the target selector does not resolve', async () => {
    // No anchor in the DOM — the callout's reposition logic must
    // refuse to render rather than positioning at (0, 0).
    render(ContextualCallout, {
      props: {
        target:  '#missing',
        heading: 'Hi',
        body:    'Body',
      },
    })
    await new Promise((r) => setTimeout(r, 30))
    // The callout is mounted (teleport target's child) but its inline
    // style hides it via display:none — the pin IS the inline style, so
    // reach for the element directly.
    // eslint-disable-next-line testing-library/no-node-access -- the display:none inline style IS the contract under test
    const callout = document.querySelector<HTMLElement>('[data-ctx-callout]')
    expect(callout?.style.display).toBe('none')
  })

  it('Esc on the document fires dismiss', async () => {
    makeAnchor()
    const { emitted } = render(ContextualCallout, {
      props: {
        target:  '#anchor',
        heading: 'Hi',
        body:    'Body',
      },
    })
    await new Promise((r) => setTimeout(r, 30))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(emitted('dismiss')).toBeTruthy()
  })
})
