// Shared fixture for the offline state-machine tests. No engine, no Python:
// the filesystem provider is a thin real-fs adapter and subprocess is unused by
// the transitions under test.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ppt-gated-test-'))
  const project = path.join(root, 'projects', 'demo_ppt169_20260101')
  fs.mkdirSync(path.join(project, 'svg_output'), { recursive: true })
  fs.mkdirSync(path.join(project, 'notes'), { recursive: true })
  fs.mkdirSync(path.join(project, 'validation'), { recursive: true })
  fs.mkdirSync(path.join(project, 'exports'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'settings.json'),
    JSON.stringify({
      engine_root: 'C:/fake/engine',
      python: 'C:/fake/python.exe',
      critic: { enabled: true, target: 'both', max_rounds: 2 },
    }, null, 2),
    'utf8',
  )
  fs.writeFileSync(
    path.join(root, 'projects.json'),
    JSON.stringify({ demo: { path: project, title: 'Demo deck', canvas: 'ppt169' } }, null, 2),
    'utf8',
  )
  return { root, project }
}

export function baseState(phase, overrides = {}) {
  return Object.assign({
    schema: 1,
    slug: 'demo',
    title: 'Demo deck',
    canvas: 'ppt169',
    language: 'zh',
    phase,
    gates: { gate1: 'pending', gate2: 'pending', gate3: 'pending' },
    pages: [],
    qa: {},
    critic: { svg: { rounds: 0, reports: [] }, pptx: { rounds: 0, reports: [] } },
    exports: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    resume_note: '',
  }, overrides)
}

export function writeState(project, state) {
  fs.writeFileSync(path.join(project, 'ppt.json'), JSON.stringify(state, null, 2), 'utf8')
}

export function readState(project) {
  return JSON.parse(fs.readFileSync(path.join(project, 'ppt.json'), 'utf8'))
}

/** Minimal Cordis context: tool registry, real-fs provider, no sandbox policy. */
export function makeContext() {
  const tools = {}
  const ctx = {
    get: () => undefined,
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        tools[tool.name] = tool
        return () => {}
      },
    },
    fs: {
      resolve: async (target) => target,
      readText: async (target) => fs.readFileSync(target, 'utf8'),
      stat: async (target) => fs.statSync(target),
      listDir: async (target) => fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({ name: entry.name })),
      writeText: async (target, content) => fs.writeFileSync(target, content, 'utf8'),
    },
    subprocess: {},
  }
  return {
    ctx,
    tools,
    async call(name, args = {}) {
      return JSON.parse(await tools[name].execute(args, {}))
    },
  }
}
