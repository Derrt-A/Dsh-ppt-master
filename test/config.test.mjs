// Configuration diagnostics: a data root without settings.json must produce an
// actionable error instead of a stack trace, and DSH_PPT_DATA must isolate the
// plugin from the machine-local config.local.json.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { baseState, makeContext, writeState } from './helpers.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ppt-gated-config-'))
const project = path.join(root, 'projects', 'demo_ppt169_20260101')
fs.mkdirSync(path.join(project, 'svg_output'), { recursive: true })
fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ demo: { path: project } }), 'utf8')
writeState(project, baseState('lock_draft'))
fs.writeFileSync(path.join(project, 'spec_lock.md'), '# lock\nppt-master-schema: spec-lock/v1\n', 'utf8')

process.env.DSH_PPT_DATA = root

const mod = await import('../lib/index.js')
const { ctx, call } = makeContext()
mod.apply(ctx)

after(() => fs.rmSync(root, { recursive: true, force: true }))

test('DSH_PPT_DATA wins over config.local.json', async () => {
  const out = await call('ppt_status')
  assert.equal(out.ok, true)
  assert.deepEqual(out.projects.map((p) => p.slug), ['demo'])
})

test('a missing settings.json is reported with the path and setup hint', async () => {
  const out = await call('ppt_lock', { slug: 'demo', action: 'submit' })
  assert.equal(out.ok, false)
  assert.match(out.error, /settings\.json/)
  assert.match(out.error, /setup\.ps1/)
})

test('an empty data root lists no projects instead of failing', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ppt-gated-empty-'))
  const previous = process.env.DSH_PPT_DATA
  process.env.DSH_PPT_DATA = empty
  try {
    // A query-string import creates a second module instance so the data root
    // is resolved again from the updated environment.
    const fresh = await import('../lib/index.js?empty-root')
    const freshContext = makeContext()
    fresh.apply(freshContext.ctx)
    const out = await freshContext.call('ppt_status')
    assert.equal(out.ok, true)
    assert.deepEqual(out.projects, [])
  } finally {
    process.env.DSH_PPT_DATA = previous
    fs.rmSync(empty, { recursive: true, force: true })
  }
})
