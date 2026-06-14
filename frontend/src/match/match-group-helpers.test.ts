import { describe, it, expect } from 'vitest'
import { groupMatchesByMonthWeekDay } from '@/match/match-group-helpers'

// ─── groupMatchesByMonthWeekDay ──────────────────────────────────────
//
// Three-level tree (Month → Week → Day). Each level carries its own
// W/L/D tally — the month tally is the sum of its weeks; the week is
// the sum of its days. The Monday of each week is the day-bucket key
// so weeks straddle month boundaries gracefully.

describe('groupMatchesByMonthWeekDay', () => {
  it('returns an empty array for an empty input', () => {
    expect(groupMatchesByMonthWeekDay([], 'desc')).toEqual([])
  })

  it('keeps records without a parseable date, in the UNKNOWN DATE bucket', () => {
    const out = groupMatchesByMonthWeekDay([{ data: {} }], 'desc')
    expect(out).toHaveLength(1)
    expect(out[0]!.level).toBe('unknown')
  })

  it('groups three records on the same day under one Month/Week/Day', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-10', finished_at: '22:05', result: 'defeat' } },
      { data: { date: '2026-05-10', finished_at: '22:40', result: 'victory' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(tree).toHaveLength(1)
    const month = tree[0]!
    expect(month.level).toBe('month')
    expect(month.tally).toEqual({ w: 2, l: 1, d: 0 })
    expect(month.children).toHaveLength(1)

    const week = month.children![0]!
    expect(week.level).toBe('week')
    expect(week.tally).toEqual({ w: 2, l: 1, d: 0 })
    expect(week.children).toHaveLength(1)

    const day = week.children![0]!
    expect(day.level).toBe('day')
    expect(day.tally).toEqual({ w: 2, l: 1, d: 0 })
    expect(day.matches).toHaveLength(3)
  })

  it('splits two days within the same week into two Day groups', () => {
    // 2026-05-08 (Friday) and 2026-05-09 (Saturday) — same Sun-anchored
    // week (Sun May 3 – Sat May 9). Default weekStart is Sunday.
    const recs = [
      { data: { date: '2026-05-09', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-08', finished_at: '20:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children![0]!.children).toHaveLength(2)
  })

  it('keys each Month/Week/Day uniquely and stably across calls', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const a = groupMatchesByMonthWeekDay(recs, 'desc')
    const b = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(a[0]!.key).toBe(b[0]!.key)
    expect(a[0]!.children![0]!.key).toBe(b[0]!.children![0]!.key)
    expect(a[0]!.children![0]!.children![0]!.key).toBe(b[0]!.children![0]!.children![0]!.key)
  })

  it('orders groups newest → oldest under sortDir=desc', () => {
    const recs = [
      { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-03', finished_at: '21:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    // Months: May 2026 first, then April 2026.
    expect(tree.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026'])
    const may = tree[0]!
    // Within May, week of May 10 (Mon May 4-Sun 10? actually depends on
    // anchor; just assert the dates are in the right relative position).
    const firstWeekFirstDay = may.children![0]!.children![0]!.matches![0]!
    expect(firstWeekFirstDay.data!.date).toBe('2026-05-10')
  })

  it('orders groups oldest → newest under sortDir=asc', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'asc')
    expect(tree.map(g => g.label)).toEqual(['APRIL 2026', 'MAY 2026'])
  })

  it('week label uses "Week of <anchor date>" form with the Sunday anchor by default', () => {
    // Default weekStart is Sunday → 2026-05-10 (Sunday itself) anchors to itself.
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const week = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!
    expect(week.label).toMatch(/^Week of /)
    expect(week.label).toContain('May 10')
  })

  it('honors weekStart=1 (Monday) for the anchor', () => {
    // 2026-05-10 is a Sunday → its Monday is 2026-05-04.
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const week = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 1 })[0]!.children![0]!
    expect(week.label).toContain('May 4')
  })

  it('groups Saturday + Sunday differently across weekStart 0 vs 1', () => {
    //   2026-05-09 Sat + 2026-05-10 Sun:
    //     Sunday-start (0): DIFFERENT weeks (Sat anchors to Sun May 3; Sun anchors to itself).
    //     Monday-start (1): SAME week (both anchor to Mon May 4 – Sun May 10).
    const recs = [
      { data: { date: '2026-05-09', finished_at: '21:00', result: 'victory' } },
      { data: { date: '2026-05-10', finished_at: '21:00', result: 'victory' } },
    ]
    const sun = groupMatchesByMonthWeekDay(recs, 'desc') // default Sunday
    expect(sun[0]!.children).toHaveLength(2)

    const mon = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 1 })
    expect(mon[0]!.children).toHaveLength(1)
  })

  it('day label spells out the full weekday name (no Sun/Mon/Tue abbreviation)', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
    ]
    const day = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!.children![0]!
    // 2026-05-10 is a Sunday — full name, not "Sun".
    expect(day.label).toMatch(/^Sunday\b/)
    expect(day.label).toContain('May 10')
  })

  // ── weekStart can be any day 0-6 ─────────────────────────────────────
  //
  // Each test uses the same two records — Saturday 2026-05-09 and the
  // following Sunday 2026-05-10 — varying only the weekStart. The
  // weekend boundary makes whether they share a week a function of the
  // chosen start day.

  it('weekStart=5 (Friday) groups Fri-Thu; Sat May 9 + Sun May 10 share a Friday-anchored week', () => {
    const recs = [
      { data: { date: '2026-05-09', finished_at: '21:00', result: 'victory' } }, // Sat
      { data: { date: '2026-05-10', finished_at: '21:00', result: 'victory' } }, // Sun
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 5 })
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children![0]!.label).toContain('May 8') // Friday May 8 anchors both
  })

  it('weekStart=6 (Saturday) splits Fri May 8 from Sat May 9 — Sat anchors its own week', () => {
    const recs = [
      { data: { date: '2026-05-08', finished_at: '21:00', result: 'victory' } }, // Fri, anchors to prev Sat May 2
      { data: { date: '2026-05-09', finished_at: '21:00', result: 'victory' } }, // Sat, anchors to itself
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: 6 })
    expect(tree[0]!.children).toHaveLength(2)
  })

  it('weekStart accepts every day 0-6 without error', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:00', result: 'victory' } },
    ]
    for (let ws = 0; ws <= 6; ws++) {
      const tree = groupMatchesByMonthWeekDay(recs, 'desc', { weekStart: ws as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
      expect(tree).toHaveLength(1)
      expect(tree[0]!.children![0]!.label).toMatch(/^Week of /)
    }
  })

  it('month tally equals sum of week tallies', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-05-03', finished_at: '21:00', result: 'defeat' } },
      { data: { date: '2026-05-01', finished_at: '21:00', result: 'draw' } },
    ]
    const month = groupMatchesByMonthWeekDay(recs, 'desc')[0]!
    const weekTotal = month.children!.reduce(
      (acc, w) => ({ w: acc.w + w.tally.w, l: acc.l + w.tally.l, d: acc.d + w.tally.d }),
      { w: 0, l: 0, d: 0 },
    )
    expect(weekTotal).toEqual(month.tally)
    expect(month.tally).toEqual({ w: 1, l: 1, d: 1 })
  })

  it('matches inside a day are sorted by finished_at honoring sortDir', () => {
    const recs = [
      { match_key: 'a', data: { date: '2026-05-10', finished_at: '20:00', result: 'victory' } },
      { match_key: 'b', data: { date: '2026-05-10', finished_at: '22:00', result: 'defeat' } },
      { match_key: 'c', data: { date: '2026-05-10', finished_at: '21:00', result: 'draw' } },
    ]
    const desc = groupMatchesByMonthWeekDay(recs, 'desc')[0]!.children![0]!.children![0]!.matches!
    expect(desc.map(r => r.match_key)).toEqual(['b', 'c', 'a'])

    const asc = groupMatchesByMonthWeekDay(recs, 'asc')[0]!.children![0]!.children![0]!.matches!
    expect(asc.map(r => r.match_key)).toEqual(['a', 'c', 'b'])
  })

  it('splits a week that straddles a month boundary into both month buckets', () => {
    // 2026-05-31 is a Sunday — same ISO week as 2026-06-01 (Monday)?
    // Actually 2026-05-31 Sun is the END of its week (Mon May 25 - Sun May 31).
    // Use 2026-04-30 (Thu) and 2026-05-01 (Fri) — same ISO week.
    const recs = [
      { match_key: 'apr', data: { date: '2026-04-30', finished_at: '21:00', result: 'victory' } },
      { match_key: 'may', data: { date: '2026-05-01', finished_at: '21:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    // Two month buckets, each containing the same calendar week.
    expect(tree).toHaveLength(2)
    const may = tree[0]!
    const apr = tree[1]!
    expect(may.label).toBe('MAY 2026')
    expect(apr.label).toBe('APRIL 2026')
    // The same Monday anchors the week in both buckets.
    expect(may.children![0]!.key).toBe(apr.children![0]!.key)
    // But each month bucket holds only its own day(s).
    expect(may.children![0]!.children!.map(d => d.matches!.length)).toEqual([1])
    expect(apr.children![0]!.children!.map(d => d.matches!.length)).toEqual([1])
  })

  // ── UNKNOWN DATE bucket ────────────────────────────────────────────
  //
  // Records that pass the matched-view filter (have a map) but lack a
  // data.date must NOT vanish from the tree. They get bucketed into a
  // single "UNKNOWN DATE" group, pinned at the bottom of the tree
  // regardless of sort direction. (The unknown bucket has no
  // chronological rank — it's triage, not history.)

  it('puts dateless records into a single UNKNOWN DATE group', () => {
    const tree = groupMatchesByMonthWeekDay(
      [{ data: { result: 'victory' } }],
      'desc',
    )
    expect(tree).toHaveLength(1)
    const unknown = tree[0]!
    expect(unknown.level).toBe('unknown')
    expect(unknown.label).toBe('UNKNOWN DATE')
    expect(unknown.key).toBe('unknown')
    expect(unknown.matches).toHaveLength(1)
    expect(unknown.children).toBeUndefined()
  })

  it('pins UNKNOWN DATE at the bottom under sortDir=desc', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { result: 'defeat' } }, // undated
        { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      ],
      'desc',
    )
    expect(tree.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026', 'UNKNOWN DATE'])
    expect(tree.at(-1)!.level).toBe('unknown')
  })

  it('pins UNKNOWN DATE at the bottom under sortDir=asc (does NOT flip with sort)', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { result: 'defeat' } }, // undated
        { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      ],
      'asc',
    )
    expect(tree.map(g => g.label)).toEqual(['APRIL 2026', 'MAY 2026', 'UNKNOWN DATE'])
    expect(tree.at(-1)!.level).toBe('unknown')
  })

  it('tallies W/L/D for the UNKNOWN DATE group from the undated records', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { result: 'victory' } },
        { data: { result: 'defeat' } },
        { data: { result: 'draw' } },
        { data: { result: 'victory' } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.tally).toEqual({ w: 2, l: 1, d: 1 })
  })

  it('returns only the UNKNOWN DATE group when every record is dateless', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { } },
        { data: { } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.level).toBe('unknown')
    expect(tree[0]!.matches).toHaveLength(2)
  })

  it('does NOT create an UNKNOWN DATE group when every record has a date', () => {
    const tree = groupMatchesByMonthWeekDay(
      [{ data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } }],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.level).toBe('month')
    // No phantom empty unknown bucket.
    expect(tree.some(g => g.level === 'unknown')).toBe(false)
  })

  it('orders dateless records by match_key for a stable bucket order', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { match_key: 'unmatched-zzz.png', data: { result: 'victory' } },
        { match_key: 'unmatched-aaa.png', data: { result: 'defeat' } },
        { match_key: 'unmatched-mmm.png', data: { result: 'draw' } },
      ],
      'desc',
    )
    const keys = tree[0]!.matches!.map(r => r.match_key)
    expect(keys).toEqual(['unmatched-aaa.png', 'unmatched-mmm.png', 'unmatched-zzz.png'])
  })

  it('also catches records whose date string is unparseable (not just absent)', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: 'not-a-date', result: 'victory' } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.level).toBe('unknown')
  })

  // ── Year level ──────────────────────────────────────────────────────
  //
  // Multi-year datasets wrap the existing Month → Week → Day tree inside
  // Year groups. Single-year datasets unwrap the Year level so the tree
  // shape stays identical to the pre-Year behavior — no noise for the
  // common case where a user only has a few months of data.

  it('does NOT wrap in Year groups when all records fall within one year', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { date: '2026-04-15', finished_at: '20:00', result: 'defeat' } },
      ],
      'desc',
    )
    // Single year → root level is 'month', not 'year'.
    expect(tree.every(g => g.level === 'month')).toBe(true)
    expect(tree.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026'])
  })

  it('wraps in Year groups when records span multiple years', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
      ],
      'desc',
    )
    expect(tree).toHaveLength(2)
    expect(tree[0]!.level).toBe('year')
    expect(tree[0]!.label).toBe('2026')
    expect(tree[1]!.label).toBe('2025')
  })

  it('keys Year groups as "year:<YYYY>"', () => {
    const tree = groupMatchesByMonthWeekDay(
      [
        { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
        { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
      ],
      'desc',
    )
    expect(tree[0]!.key).toBe('year:2026')
    expect(tree[1]!.key).toBe('year:2025')
  })

  it('year tally equals sum of its month tallies', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-03-15', finished_at: '20:00', result: 'defeat' } },
      { data: { date: '2025-11-01', finished_at: '20:00', result: 'draw' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    const y2026 = tree[0]!
    const monthSum = y2026.children!.reduce(
      (acc, m) => ({ w: acc.w + m.tally.w, l: acc.l + m.tally.l, d: acc.d + m.tally.d }),
      { w: 0, l: 0, d: 0 },
    )
    expect(monthSum).toEqual(y2026.tally)
    expect(y2026.tally).toEqual({ w: 1, l: 1, d: 0 })
  })

  it('reorders Year groups under sortDir', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
    ]
    const desc = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(desc.map(g => g.label)).toEqual(['2026', '2025'])
    const asc = groupMatchesByMonthWeekDay(recs, 'asc')
    expect(asc.map(g => g.label)).toEqual(['2025', '2026'])
  })

  it('keeps the UNKNOWN DATE bucket at the bottom irrespective of year wrapping', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2025-12-30', finished_at: '20:00', result: 'defeat' } },
      { match_key: 'unmatched-x.png', data: { result: 'victory' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    expect(tree).toHaveLength(3)
    expect(tree.at(-1)!.level).toBe('unknown')
    // The two year wrappers come before unknown.
    expect(tree.slice(0, 2).every(g => g.level === 'year')).toBe(true)
  })

  it('within a Year, months / weeks / days follow the normal sort + structure', () => {
    const recs = [
      { data: { date: '2026-05-10', finished_at: '21:29', result: 'victory' } },
      { data: { date: '2026-04-15', finished_at: '20:00', result: 'victory' } },
      { data: { date: '2025-11-01', finished_at: '20:00', result: 'defeat' } },
    ]
    const tree = groupMatchesByMonthWeekDay(recs, 'desc')
    const y2026 = tree[0]!
    // 2026 has two months in newest-first order.
    expect(y2026.children!.map(m => m.label)).toEqual(['MAY 2026', 'APRIL 2026'])
    // Drill into the first month → week → day still works.
    const may = y2026.children![0]!
    expect(may.children![0]!.level).toBe('week')
    expect(may.children![0]!.children![0]!.level).toBe('day')
    expect(may.children![0]!.children![0]!.matches).toHaveLength(1)
  })
})
