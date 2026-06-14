import { describe, expect, it, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

import ContextualCallout from '@/components/ContextualCallout.vue'

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

describe('ContextualCallout', () => {
  it('renders the heading + body when an anchor exists', async () => {
    makeAnchor()
    const wrapper = mount(ContextualCallout, {
      props: {
        target:  '#anchor',
        heading: 'Welcome to the picker',
        body:    'Each card maps to one capture tool.',
      },
      attachTo: document.body,
    })
    // Allow the next-tick reposition to land.
    await new Promise((r) => setTimeout(r, 30))
    const callout = document.querySelector('[data-ctx-callout]')
    expect(callout).not.toBeNull()
    expect(callout!.textContent).toContain('Welcome to the picker')
    expect(callout!.textContent).toContain('Each card maps to one capture tool.')
    wrapper.unmount()
  })

  it('emits dismiss when the close glyph is clicked', async () => {
    makeAnchor()
    const wrapper = mount(ContextualCallout, {
      props: {
        target:  '#anchor',
        heading: 'Hi',
        body:    'Body',
      },
      attachTo: document.body,
    })
    await new Promise((r) => setTimeout(r, 30))
    const close = document.querySelector<HTMLButtonElement>('[data-ctx-callout] .ctx-close')!
    close.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('dismiss')).toBeTruthy()
    wrapper.unmount()
  })

  it('renders + emits the action button when actionLabel is passed', async () => {
    makeAnchor()
    const wrapper = mount(ContextualCallout, {
      props: {
        target:      '#anchor',
        heading:     'Hi',
        body:        'Body',
        actionLabel: 'Got it',
      },
      attachTo: document.body,
    })
    await new Promise((r) => setTimeout(r, 30))
    const action = document.querySelector<HTMLButtonElement>('[data-ctx-callout] .ctx-action')!
    expect(action.textContent).toContain('Got it')
    action.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('action')).toBeTruthy()
    wrapper.unmount()
  })

  it('hides itself when the target selector does not resolve', async () => {
    // No anchor in the DOM — the callout's reposition logic must
    // refuse to render rather than positioning at (0, 0).
    const wrapper = mount(ContextualCallout, {
      props: {
        target:  '#missing',
        heading: 'Hi',
        body:    'Body',
      },
      attachTo: document.body,
    })
    await new Promise((r) => setTimeout(r, 30))
    const callout = document.querySelector<HTMLElement>('[data-ctx-callout]')
    // The callout is mounted (teleport target's child) but its
    // inline style hides it via display:none.
    expect(callout?.style.display).toBe('none')
    wrapper.unmount()
  })

  it('Esc on the document fires dismiss', async () => {
    makeAnchor()
    const wrapper = mount(ContextualCallout, {
      props: {
        target:  '#anchor',
        heading: 'Hi',
        body:    'Body',
      },
      attachTo: document.body,
    })
    await new Promise((r) => setTimeout(r, 30))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('dismiss')).toBeTruthy()
    wrapper.unmount()
  })
})
