#!/usr/bin/env node
// Renders the Elo scenario snapshots (tests/e2e/elo-scenarios.spec.ts-snapshots)
// into a reviewable markdown catalog: one row per scenario with the verdict,
// the simulator cells, and which data-poor gates fired. Zero dependencies.
//
// Usage: node scripts/elo-scenario-catalog.cjs [snapshot-dir] [out-file]
// Defaults: the spec's snapshot dir → ../tmp/elo-scenario-catalog.md

const fs = require('node:fs')
const path = require('node:path')

const snapDir = process.argv[2] ?? path.join(__dirname, '..', 'tests', 'e2e', 'elo-scenarios.spec.ts-snapshots')
const outFile = process.argv[3] ?? path.join(__dirname, '..', '..', 'tmp', 'elo-scenario-catalog.md')

const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json')).sort()
if (files.length === 0) {
  console.error(`no snapshots in ${snapDir} — run: npx playwright test elo-scenarios`)
  process.exit(1)
}

const pick = (cap, key) => (cap[key] ?? '').trim()
const firstPct = (s) => {
  const m = /(\d+(?:\.\d+)?)%/.exec(s)
  return m ? `${m[1]}%` : '—'
}

const rows = files.map((f) => {
  const cap = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8'))
  const id = f.replace(/\.json$/, '')
  const answer = pick(cap, 'data-elo-answer')
  const eyebrowMatch = /^(Early read[^A-Z]*|Reality check(?: — for your edits)?|If your (?:form|edits) hold[s]?|You're there)/.exec(answer)
  const eyebrow = eyebrowMatch ? eyebrowMatch[1] : answer.slice(0, 30)
  const reach = firstPct(pick(cap, 'data-elo-sim-stat=reach'))
  const lower = firstPct(pick(cap, 'data-elo-sim-stat=lower'))
  const season = pick(cap, 'data-elo-stat=season')
  const gates = []
  if (/not enough rank cards/i.test(JSON.stringify(cap))) gates.push('meter-fallback')
  if (/too few games/i.test(JSON.stringify(cap))) gates.push('too-few-games')
  if (/skeptic prior/i.test(JSON.stringify(cap))) gates.push('prior-disclosed')
  if (/Early read/.test(answer)) gates.push('early-read')
  return { id, eyebrow, reach, lower, season: firstPct(season), answer, gates: gates.join(' ') || '—' }
})

const lines = [
  '# Elo Calculator scenario catalog',
  '',
  `Generated from ${files.length} snapshot(s) in \`${path.relative(process.cwd(), snapDir)}\`.`,
  '',
  '| id | verdict | sim reach | sim lower | season card | gates |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.eyebrow} | ${r.reach} | ${r.lower} | ${r.season} | ${r.gates} |`),
  '',
  '## Full verdicts',
  '',
  ...rows.map((r) => `**${r.id}** — ${r.answer}\n`),
]

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, lines.join('\n'))
console.log(`wrote ${outFile} (${rows.length} scenarios)`)
