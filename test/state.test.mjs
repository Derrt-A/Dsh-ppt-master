// Offline state-machine coverage: every transition that does not invoke the
// Python engine is exercised against a temp data root.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'

import { baseState, makeContext, makeWorkspace, readState, writeState } from './helpers.mjs'

const ws = makeWorkspace()
process.env.DSH_PPT_DATA = ws.root

const mod = await import('../lib/index.js')
const { ctx, call } = makeContext()
mod.apply(ctx)

after(() => fs.rmSync(ws.root, { recursive: true, force: true }))

test('ppt_status lists projects from the configured data root', async () => {
  writeState(ws.project, baseState('spec_draft'))
  const out = await call('ppt_status')
  assert.equal(out.ok, true)
  assert.equal(out.projects.length, 1)
  assert.equal(out.projects[0].slug, 'demo')
  assert.equal(out.projects[0].phase, 'spec_draft')
})

test('ppt_spec approve moves gate1 to lock_draft, and is rejected out of phase', async () => {
  writeState(ws.project, baseState('gate1'))
  const approved = await call('ppt_spec', { slug: 'demo', action: 'approve' })
  assert.equal(approved.ok, true)
  assert.equal(approved.phase, 'lock_draft')
  assert.equal(approved.gates.gate1, 'approved')
  assert.equal(readState(ws.project).gates.gate1, 'approved')

  const again = await call('ppt_spec', { slug: 'demo', action: 'approve' })
  assert.equal(again.ok, false)
  assert.match(again.error, /不能 approve/)
})

test('ppt_spec reject returns to spec_draft and records the rejection', async () => {
  writeState(ws.project, baseState('gate1'))
  const rejected = await call('ppt_spec', { slug: 'demo', action: 'reject' })
  assert.equal(rejected.ok, true)
  assert.equal(rejected.phase, 'spec_draft')
  assert.equal(rejected.gates.gate1, 'rejected')
  assert.match(rejected.next, /design_spec/)
})

test('ppt_lock approve moves gate2 to author', async () => {
  writeState(ws.project, baseState('gate2'))
  const out = await call('ppt_lock', { slug: 'demo', action: 'approve' })
  assert.equal(out.ok, true)
  assert.equal(out.phase, 'author')
  assert.equal(out.gates.gate2, 'approved')
})

test('ppt_author registers an existing page and rejects a bad name', async () => {
  writeState(ws.project, baseState('author'))
  fs.writeFileSync(path.join(ws.project, 'svg_output', '01_cover.svg'), '<svg/>', 'utf8')

  const ok = await call('ppt_author', { slug: 'demo', action: 'page', page: '01_cover.svg' })
  assert.equal(ok.ok, true)
  assert.equal(ok.pages, 1)
  assert.equal(readState(ws.project).pages[0].file, '01_cover.svg')

  const bad = await call('ppt_author', { slug: 'demo', action: 'page', page: '../escape.svg' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /NN_name\.svg/)

  const missing = await call('ppt_author', { slug: 'demo', action: 'page', page: '02_missing.svg' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /文件不存在/)
})

test('pages_done requires a passing final QA gate, then notes_done requires total.md', async () => {
  writeState(ws.project, baseState('author', { qa: {} }))
  const blocked = await call('ppt_author', { slug: 'demo', action: 'pages_done' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /stage=final/)

  writeState(ws.project, baseState('notes', { qa: { final: { pass: true } } }))
  const notYet = await call('ppt_author', { slug: 'demo', action: 'notes_done' })
  assert.equal(notYet.ok, false)
  assert.match(notYet.error, /total\.md/)

  fs.writeFileSync(path.join(ws.project, 'notes', 'total.md'), '# 01_cover\n', 'utf8')
  const done = await call('ppt_author', { slug: 'demo', action: 'notes_done' })
  assert.equal(done.ok, true)
  assert.equal(done.phase, 'critic_svg')
})

test('ppt_critic fail needs a report, returns to author, then escalates at max_rounds', async () => {
  writeState(ws.project, baseState('critic_svg'))
  const noReport = await call('ppt_critic', { slug: 'demo', layer: 'svg', verdict: 'fail', round: 1 })
  assert.equal(noReport.ok, false)
  assert.match(noReport.error, /报告不存在/)

  fs.writeFileSync(path.join(ws.project, 'validation', 'critic_svg_r1.md'), '# review\n', 'utf8')
  const failed = await call('ppt_critic', { slug: 'demo', layer: 'svg', verdict: 'fail', round: 1 })
  assert.equal(failed.ok, true)
  assert.equal(failed.critic_fail, true)
  assert.equal(failed.phase, 'author')

  writeState(ws.project, baseState('critic_svg', { critic: { svg: { rounds: 1 }, pptx: { rounds: 0 } } }))
  fs.writeFileSync(path.join(ws.project, 'validation', 'critic_svg_r2.md'), '# review\n', 'utf8')
  const escalated = await call('ppt_critic', { slug: 'demo', layer: 'svg', verdict: 'fail', round: 2 })
  assert.equal(escalated.ok, false)
  assert.equal(escalated.escalated, true)
  assert.equal(readState(ws.project).phase, 'critic_svg')
})

test('ppt_export approve closes gate3 and reaches done', async () => {
  writeState(ws.project, baseState('gate3'))
  const out = await call('ppt_export', { slug: 'demo', action: 'approve' })
  assert.equal(out.ok, true)
  assert.equal(out.phase, 'done')
  assert.equal(out.delivered, true)
  assert.equal(out.gates.gate3, 'approved')
})

test('ppt_new rejects an invalid slug before touching the engine', async () => {
  const out = await call('ppt_new', { slug: 'bad slug', title: 'x' })
  assert.equal(out.ok, false)
  assert.match(out.error, /slug/)
})

test('unknown project is reported, unknown enum is rejected by schema validation', async () => {
  const missing = await call('ppt_status', { slug: 'nope' })
  assert.equal(missing.ok, false)

  writeState(ws.project, baseState('gate1'))
  await assert.rejects(
    () => call('ppt_spec', { slug: 'demo', action: 'explode' }),
    /"action" must be one of/,
  )
})
