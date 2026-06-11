import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ParseProgressPanel, { type ParseProgressEvent } from './ParseProgressPanel.vue'

function progress(over: Partial<ParseProgressEvent> = {}): ParseProgressEvent {
  return {
    done: 1,
    total: 5,
    filename: 'sample.png',
    screenshot_type: 'summary',
    ...over,
  }
}

describe('ParseProgressPanel', () => {
  it('renders nothing when loading=false', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: { parseBusy: false, parseProgress: null, parseLog: [], isOpen: false },
    })
    expect(wrapper.find('.parse-progress-panel').exists()).toBe(false)
  })

  it('renders the panel when loading=true', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: { parseBusy: true, parseProgress: null, parseLog: [], isOpen: false },
    })
    expect(wrapper.find('.parse-progress-panel').exists()).toBe(true)
  })

  it('shows 0/… counter while progress is null', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: { parseBusy: true, parseProgress: null, parseLog: [], isOpen: false },
    })
    expect(wrapper.find('.pp-done').text()).toBe('0')
    expect(wrapper.find('.pp-total').text()).toBe('…')
  })

  it('renders done/total from parseProgress', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress({ done: 3, total: 7 }),
        parseLog: [],
        isOpen: false,
      },
    })
    expect(wrapper.find('.pp-done').text()).toBe('3')
    expect(wrapper.find('.pp-total').text()).toBe('7')
  })

  it('progress bar width reflects done/total ratio', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress({ done: 2, total: 5 }),
        parseLog: [],
        isOpen: false,
      },
    })
    const fill = wrapper.find('.pp-bar-fill')
    expect(fill.attributes('style')).toContain('width: 40%')
  })

  it('bar collapses to 0% when total is 0', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress({ done: 0, total: 0 }),
        parseLog: [],
        isOpen: false,
      },
    })
    expect(wrapper.find('.pp-bar-fill').attributes('style')).toContain('width: 0%')
  })

  it('does not render the expanded details when isOpen=false', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress(),
        parseLog: [],
        isOpen: false,
      },
    })
    expect(wrapper.find('.pp-current').exists()).toBe(false)
  })

  it('renders the current-file detail row when isOpen=true', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress({ filename: 'overwatch.png', screenshot_type: 'summary' }),
        parseLog: [],
        isOpen: true,
      },
    })
    expect(wrapper.find('.pp-current').exists()).toBe(true)
    expect(wrapper.find('.pp-cur-filename').text()).toBe('overwatch.png')
    expect(wrapper.find('.pp-type-badge').text()).toBe('SUMMARY')
  })

  it('summary-type renders map / result / date / length fields when present', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress({
          screenshot_type: 'summary',
          data: { map: 'rialto', result: 'victory', date: '2026-05-10', game_length: '11:25' },
        }),
        parseLog: [],
        isOpen: true,
      },
    })
    const text = wrapper.find('.pp-cur-fields').text()
    expect(text).toContain('rialto')
    expect(text).toContain('victory')
    expect(text).toContain('2026-05-10')
    expect(text).toContain('11:25')
  })

  it('scoreboard-type renders the E/A/D + damage triple', () => {
    const wrapper = mount(ParseProgressPanel, {
      props: {
        parseBusy: true,
        parseProgress: progress({
          screenshot_type: 'teams',
          data: { eliminations: 17, assists: 16, deaths: 11, damage: 7200 },
        }),
        parseLog: [],
        isOpen: true,
      },
    })
    const text = wrapper.find('.pp-cur-fields').text()
    expect(text).toContain('17')
    expect(text).toContain('16')
    expect(text).toContain('11')
    expect(text).toContain('7,200') // toLocaleString puts in the comma
  })

  it('clicking the summary row emits toggle-open', async () => {
    const wrapper = mount(ParseProgressPanel, {
      props: { parseBusy: true, parseProgress: null, parseLog: [], isOpen: false },
    })
    await wrapper.find('.pp-summary').trigger('click')
    expect(wrapper.emitted('toggle-open')).toBeTruthy()
  })

  it('chevron carries the .open class when isOpen=true', () => {
    const open = mount(ParseProgressPanel, {
      props: { parseBusy: true, parseProgress: null, parseLog: [], isOpen: true },
    })
    expect(open.find('.pp-chev').classes()).toContain('open')

    const closed = mount(ParseProgressPanel, {
      props: { parseBusy: true, parseProgress: null, parseLog: [], isOpen: false },
    })
    expect(closed.find('.pp-chev').classes()).not.toContain('open')
  })
})
