// Offline smoke test for the durable dsh-ppt package: module resolves, exports
// the Cordis shape, and every tool definition compiles through defineTool.
import assert from 'node:assert/strict'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as mod from '../lib/index.js'

assert.equal(typeof mod.apply, 'function', 'apply must be exported')
assert.equal(typeof mod.name, 'string', 'name must be exported')
assert.ok(Array.isArray(mod.inject), 'inject must be an array')
assert.deepEqual(mod.inject, ['tools', 'fs', 'subprocess'])

const registered = []
const ctx = {
  get: () => undefined,
  effect: (fn) => fn(),
  tools: { register: (tool) => { registered.push(tool); return () => {} } },
  fs: {},
  subprocess: {},
}
mod.apply(ctx)

assert.equal(registered.length, 8, 'exactly eight tools must register')
const names = registered.map((t) => t.name).sort()
assert.deepEqual(names, [
  'ppt_author', 'ppt_critic', 'ppt_export', 'ppt_lock',
  'ppt_new', 'ppt_qa', 'ppt_spec', 'ppt_status',
])

for (const tool of registered) {
  assert.equal(typeof tool.description, 'string')
  assert.equal(typeof tool.parameters, 'object')
  assert.equal(tool.parameters.type, 'object', tool.name + ' parameters compile to an object root')
  assert.equal(tool.output.schema.type, 'string', tool.name + ' returns a JSON string')
  assert.equal(typeof tool.execute, 'function')
  const rendered = tool.output.render({}, '{"ok":true}')
  assert.equal(rendered[0].type, 'text')
}

// Argument validation is the reason the host's defineTool is imported rather
// than hand-rolled: a missing required argument must be rejected before the
// body runs.
const newTool = registered.find((t) => t.name === 'ppt_new')
let ran = false
const guarded = defineTool({
  name: 'probe',
  description: 'probe',
  parameters: { slug: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'x' }] },
  execute: async () => { ran = true; return 'ok' },
})
await assert.rejects(() => guarded.execute({}, {}), /slug/)
assert.equal(ran, false)
assert.ok(newTool.parameters.required.includes('slug'))

console.log('dsh-ppt package OK:', registered.length, 'tools ->', names.join(', '))
