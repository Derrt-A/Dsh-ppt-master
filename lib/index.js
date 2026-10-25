/**
 * dsh-ppt — durable Host half.
 *
 * Registers the eight `ppt_*` tools that drive the locally installed ppt-master
 * engine end-to-end for one presentation project at a time:
 *
 *   ppt_new     S1  source intake (attribution_guard → project init → import)
 *   ppt_spec    S3  design_spec validation + gate 1 (outline confirmation)
 *   ppt_lock    S4  spec_lock freeze + gate 2
 *   ppt_qa      S6  svg_quality_checker wrapper (first-page gate / final gate)
 *   ppt_author  S6/S7 page + speaker-notes registration
 *   ppt_critic  S8/S10 dual-layer critic verdict recording
 *   ppt_export  S9  export chain (7.1 notes split → 7.2 finalize → 7.3 pptx) + gate 3
 *   ppt_status  read-only state machine / resume entry point
 *
 * All per-project state lives in `ppt.json` under the data root below; the
 * engine itself (`ppt-workbench\tools\ppt-master`) is read-only and is never
 * modified. Python is always invoked through the venv recorded in
 * `settings.json`, so the tools behave identically on every host restart.
 *
 * This file is the durable counterpart of the dynamic Cordis plugin that was
 * originally validated in the 2026-09-05 pilot (see
 * `dsh-ppt-data\docs\acceptance-checklist.md`).
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root: this file lives in `<package>/lib`. */
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DOCS = path.join(PKG_ROOT, 'docs')

/**
 * Machine-local overrides live in `config.local.json` at the package root and
 * are git-ignored. Only `dataRoot` belongs here; the engine path and Python
 * interpreter are read from `<dataRoot>/settings.json` so one config file
 * describes one installation.
 */
function readLocalConfig() {
  try {
    const text = fsSync.readFileSync(path.join(PKG_ROOT, 'config.local.json'), 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text)
  } catch (e) {
    return {}
  }
}
const LOCAL = readLocalConfig()

/**
 * Data root precedence: `DSH_PPT_DATA` → `config.local.json#dataRoot` →
 * `$DSH_HOME/dsh-ppt`. It holds `settings.json`, `projects.json` and every
 * project workspace; the package itself stays read-only.
 */
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA = path.resolve(process.env.DSH_PPT_DATA || LOCAL.dataRoot || path.join(DSH_HOME, 'dsh-ppt'))
const SETTINGS_PATH = path.join(DATA, 'settings.json')
const PROJECTS_DIR = path.join(DATA, 'projects')
const INDEX_PATH = path.join(DATA, 'projects.json')

/** Hard dependencies: tool registry, filesystem provider, subprocess seam. */
const inject = ['tools', 'fs', 'subprocess']

/** Bundle row name (matches `package.json` name and `cordis.patch.yml`). */
const name = 'dsh-ppt'

function apply(ctx) {
  async function readText(path) {
    const target = await ctx.fs.resolve(path)
    return ctx.fs.readText(target)
  }

  /**
   * The policy stamped onto every mutation: the calling session's standing
   * sandbox mode plus its workspace root, exactly as the built-in `write` tool
   * resolves it. Omitting it makes the provider treat the call as unsandboxed
   * and deny writes under the data root.
   * @param exec - tool execution context carrying the caller agent.
   * @returns the policy to pass to `fs.writeText`, or undefined when the
   *   composition has no sandbox-policy service.
   */
  function writePolicy(exec) {
    const policyService = ctx.get('sandboxPolicy')
    if (policyService === undefined) return undefined
    const session = exec && exec.agent ? exec.agent.session : undefined
    return policyService.resolve(session === undefined ? {} : { session })
  }

  async function writeText(path, content, exec) {
    const target = await ctx.fs.resolve(path)
    const signal = exec ? exec.signal : undefined
    await ctx.fs.writeText(target, content, undefined, signal, writePolicy(exec))
  }

  async function readJson(path) {
    return JSON.parse(await readText(path))
  }

  async function writeJson(path, obj, exec) {
    await writeText(path, JSON.stringify(obj, null, 2), exec)
  }

  async function exists(path) {
    try {
      const target = await ctx.fs.resolve(path)
      const info = await ctx.fs.stat(target)
      return info !== undefined
    } catch (e) {
      return false
    }
  }

  async function listDirNames(path) {
    const target = await ctx.fs.resolve(path)
    const entries = await ctx.fs.listDir(target)
    const names = []
    for (const e of entries) {
      try { names.push(e.name) } catch (err) { /* entry without a name */ }
    }
    return names
  }

  /**
   * Resolve the engine root and interpreter. Environment variables win over
   * `settings.json`, which lets a host override one installation without
   * rewriting the data root.
   * @returns `{ cfg, engineRoot, python }`.
   */
  async function engineConfig() {
    let cfg
    try {
      cfg = await readJson(SETTINGS_PATH)
    } catch (e) {
      throw new Error('cannot read ' + SETTINGS_PATH + ' — run scripts/setup.ps1 (or scripts/setup.sh) first')
    }
    const python = process.env.DSH_PPT_PYTHON || cfg.python
    const engineRoot = process.env.DSH_PPT_ENGINE || cfg.engine_root
    if (!python || !engineRoot) throw new Error('settings.json must define both "python" and "engine_root": ' + SETTINGS_PATH)
    return { cfg: cfg, engineRoot: engineRoot, python: python }
  }

  /**
   * Run one engine script with the interpreter recorded in settings.json.
   * @param scriptRel - script file name relative to `<engine>/scripts`.
   * @param argsArr - extra argv entries.
   * @param opts - `{ cwd }` override for the child working directory.
   * @returns `{ code, out, err }` — collected output is offset-based, so reads
   *   never consume one another.
   */
  async function runPython(scriptRel, argsArr, opts) {
    const cfg = await engineConfig()
    const scripts = path.join(cfg.engineRoot, 'scripts')
    const argv = [cfg.python]
    if (scriptRel) argv.push(path.join(scripts, scriptRel))
    for (const a of (argsArr || [])) argv.push(String(a))
    const cwd = (opts && opts.cwd) || scripts
    const handle = ctx.subprocess.spawn({
      argv: argv,
      cwd: cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 1048576, spill: { maxBytes: 16777216 } },
        stderr: { maxBytes: 1048576, spill: { maxBytes: 16777216 } },
      },
      graceMs: 5000,
      env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8:replace' },
    })
    const outcome = await handle.done
    let out = ''
    let err = ''
    try {
      const so = handle.collected.stdout
      if (so) out = so.readFrom(0).text
    } catch (e) { /* stdout not collected */ }
    try {
      const se = handle.collected.stderr
      if (se) err = se.readFrom(0).text
    } catch (e) { /* stderr not collected */ }
    const code = outcome.exitCode == null ? -1 : outcome.exitCode
    return { code: code, out: String(out || ''), err: String(err || '') }
  }

  /** Engine integrity gate — always the first engine call of a project. */
  async function integrityGate() {
    return runPython('attribution_guard.py', [], {})
  }

  function nowIso() {
    return new Date().toISOString()
  }

  async function findProject(slug) {
    let index = {}
    if (await exists(INDEX_PATH)) {
      try { index = await readJson(INDEX_PATH) } catch (e) { index = {} }
    }
    const rec = index[slug]
    if (!rec || !rec.path) return { found: false }
    if (!(await exists(path.join(rec.path, 'ppt.json')))) return { found: false }
    const state = await readJson(path.join(rec.path, 'ppt.json'))
    return { found: true, path: rec.path, state: state, index: index }
  }

  function slugOk(slug) {
    return /^[a-zA-Z0-9_-]{1,80}$/.test(slug)
  }

  /** Human-readable next step for one phase of the state machine. */
  function phaseMsg(phase) {
    const m = {
      spec_draft: '写 design_spec.md（依 driver.md §1 S3 + §4.1）后调 ppt_spec action=submit',
      gate1: '门1 待用户确认：把 spec 大纲呈给用户，同意后 ppt_spec action=approve，否则 action=reject',
      lock_draft: '写 spec_lock.md（依 driver.md §4.2）后调 ppt_lock action=submit',
      gate2: '门2 待用户确认：冻结确认，同意后 ppt_lock action=approve，否则 action=reject',
      author: '逐页写 svg_output/NN_name.svg（依 driver.md §3 硬规则）；P01 后先 ppt_qa stage=first-page；全部画完且 final 通过后 ppt_author action=pages_done',
      notes: '写 notes/total.md（依 driver.md §1 S7）后调 ppt_author action=notes_done',
      critic_svg: 'SVG 层 critic：派子代理依四维清单评审，报告落盘 validation/critic_svg_rN.md 后调 ppt_critic layer=svg',
      export: '调 ppt_export action=export 执行 7.1/7.2/7.3 导出链',
      critic_pptx: 'PPTX 层 critic：pptx_delivery_check 已自动跑，派子代理评成品，报告落盘后调 ppt_critic layer=pptx',
      gate3: '门3 待用户验收：渲染图呈给用户，通过后 ppt_export action=approve，否则 action=reject',
      done: '已交付。可拷贝到有 PowerPoint/WPS 的机器终验',
    }
    return m[phase] || ''
  }

  async function stateOut(slug, state, extra) {
    const base = {
      ok: true,
      slug: slug,
      phase: state.phase,
      gates: state.gates || {},
      pages: (state.pages || []).length,
      qa: state.qa || {},
      critic: state.critic || {},
      next: phaseMsg(state.phase),
    }
    for (const k in (extra || {})) base[k] = extra[k]
    return JSON.stringify(base, null, 2)
  }

  async function saveState(projectPath, state, exec) {
    state.updated_at = nowIso()
    await writeJson(path.join(projectPath, 'ppt.json'), state, exec)
  }

  /** §VII is optional (omitted when the deck has no chart/table rows). */
  function specSections(text) {
    const req = ['## I. Project Information', '## II. Canvas Specification', '## III. Visual Theme', '## IV. Typography System', '## V. Layout Principles', '## VI. Icon Usage Specification', '## VIII. Image Resource List', '## IX. Content Outline', '## X. Speaker Notes Requirements']
    const missing = req.filter(function (s) { return text.indexOf(s) < 0 })
    return { missing: missing }
  }

  /**
   * Register one model-visible tool. The registration belongs to this plugin's
   * fiber, so it disappears on unload; the body always answers with a JSON
   * string so a thrown error still reaches the model as a diagnostic.
   */
  const define = (toolName, description, parameters, execute) => {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: toolName,
      description: description,
      parameters: parameters,
      output: {
        schema: { type: 'string' },
        render(_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute(args, exec) {
        try {
          return await execute(args, exec)
        } catch (e) {
          return JSON.stringify({ ok: false, error: String(e && e.message || e) }, null, 2)
        }
      },
    })), 'dsh-ppt: tool ' + toolName)
  }

  // ---------- ppt_new ----------
  define('ppt_new', '建 dsh-ppt 项目（S1）：attribution_guard → project_manager init → import-sources，写 ppt.json 状态机。参数 slug 只用字母数字下划线；sources 为源文件绝对路径数组（md/docx/pdf/xlsx/pptx 等）。', {
    slug: { type: 'string', required: true, description: '项目名，字母数字下划线' },
    title: { type: 'string', required: true, description: '展示标题' },
    sources: { type: 'array', description: '源材料绝对路径数组' },
    canvas: { type: 'string', description: '16:9 或 4:3，默认 16:9' },
  }, async (args, exec) => {
    if (!slugOk(args.slug)) return JSON.stringify({ ok: false, error: 'slug 只允许字母数字下划线' })
    const g = await integrityGate()
    if (g.code !== 0) return JSON.stringify({ ok: false, step: 'attribution_guard', error: '完整性门禁失败 code=' + g.code + ' ' + g.err.slice(-500) }, null, 2)
    let index = {}
    if (await exists(INDEX_PATH)) { try { index = await readJson(INDEX_PATH) } catch (e) { index = {} } }
    if (index[args.slug]) return JSON.stringify({ ok: false, error: 'slug 已存在: ' + args.slug })
    const fmt = args.canvas === '4:3' ? 'ppt43' : 'ppt169'
    const r = await runPython('project_manager.py', ['init', args.slug, '--format', fmt, '--dir', PROJECTS_DIR])
    if (r.code !== 0) return JSON.stringify({ ok: false, step: 'init', error: r.err.slice(-600) || r.out.slice(-600) }, null, 2)
    const m = String(r.out).match(/\[OK\] Project initialized: (.+)/)
    if (!m) return JSON.stringify({ ok: false, step: 'init-parse', error: '未找到项目路径: ' + r.out.slice(-600) }, null, 2)
    const projectPath = m[1].trim()
    if (args.sources && args.sources.length) {
      const imp = await runPython('project_manager.py', ['import-sources', projectPath].concat(args.sources))
      if (imp.code !== 0) return JSON.stringify({ ok: false, step: 'import-sources', error: imp.err.slice(-600) || imp.out.slice(-600), projectPath: projectPath }, null, 2)
    }
    const now = nowIso()
    const state = {
      schema: 1,
      slug: args.slug,
      title: args.title,
      canvas: fmt,
      language: 'zh',
      phase: 'spec_draft',
      gates: { gate1: 'pending', gate2: 'pending', gate3: 'pending' },
      pages: [],
      qa: {},
      critic: { svg: { rounds: 0, reports: [] }, pptx: { rounds: 0, reports: [] } },
      exports: [],
      created_at: now,
      updated_at: now,
      resume_note: '',
    }
    await saveState(projectPath, state, exec)
    index[args.slug] = { path: projectPath, title: args.title, canvas: fmt, created_at: now }
    await writeJson(INDEX_PATH, index, exec)
    const s2 = await readJson(path.join(projectPath, 'ppt.json'))
    return stateOut(args.slug, s2, { projectPath: projectPath, driverDoc: path.join(PACKAGE_DOCS, 'driver.md') })
  })

  // ---------- ppt_spec ----------
  define('ppt_spec', 'S3/门1：submit=校验 design_spec.md（存在+marker+I–X 节标题，§VII 为可选节；validate 中仅 spec_lock 缺失类错误可容忍）进入 gate1；approve=用户已确认门1 进 lock_draft；reject=退回 spec_draft。design_spec.md 由主 agent 依 driver.md §4.1 先写好。', {
    slug: { type: 'string', required: true },
    action: { type: 'string', required: true, enum: ['submit', 'approve', 'reject'] },
  }, async (args, exec) => {
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在' })
    const st = p.state
    if (args.action === 'submit') {
      if (st.phase !== 'spec_draft') return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能 submit spec' })
      const specPath = path.join(p.path, 'design_spec.md')
      if (!(await exists(specPath))) return JSON.stringify({ ok: false, error: 'design_spec.md 不存在，先写它' })
      const text = await readText(specPath)
      if (text.indexOf('ppt-master-schema: design-spec/v1') < 0) return JSON.stringify({ ok: false, error: 'design_spec.md 缺 schema marker' })
      const sec = specSections(text)
      if (sec.missing.length) return JSON.stringify({ ok: false, error: 'design_spec.md 缺节: ' + sec.missing.join(', ') }, null, 2)
      if ((text.match(/#### Slide /g) || []).length === 0) return JSON.stringify({ ok: false, error: 'design_spec.md §IX 无 Slide 块' })
      const v = await runPython('project_manager.py', ['validate', p.path])
      if (v.code !== 0) {
        const onlyLockMissing = /missing spec_lock\.md/.test(v.out)
        if (!onlyLockMissing) return JSON.stringify({ ok: false, step: 'validate', error: (v.err + '\n' + v.out).slice(-800) }, null, 2)
      }
      st.phase = 'gate1'
      st.gates.gate1 = 'pending'
      st.resume_note = '门1：等用户确认 spec'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    if (args.action === 'approve') {
      if (st.phase !== 'gate1') return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能 approve 门1' })
      st.gates.gate1 = 'approved'
      st.phase = 'lock_draft'
      st.resume_note = ''
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    if (args.action === 'reject') {
      if (st.phase !== 'gate1') return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能 reject 门1' })
      st.gates.gate1 = 'rejected'
      st.phase = 'spec_draft'
      st.resume_note = '用户驳回门1，修订 design_spec.md 后重新 submit'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    return JSON.stringify({ ok: false, error: '未知 action' })
  })

  // ---------- ppt_lock ----------
  define('ppt_lock', 'S4/门2：submit=校验 spec_lock.md 存在+validate 进入 gate2；approve=冻结确认进 author；reject=退回 lock_draft。spec_lock.md 由主 agent 依 driver.md §4.2 先写好。', {
    slug: { type: 'string', required: true },
    action: { type: 'string', required: true, enum: ['submit', 'approve', 'reject'] },
  }, async (args, exec) => {
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在' })
    const st = p.state
    if (args.action === 'submit') {
      if (st.phase !== 'lock_draft') return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能 submit lock' })
      const lockPath = path.join(p.path, 'spec_lock.md')
      if (!(await exists(lockPath))) return JSON.stringify({ ok: false, error: 'spec_lock.md 不存在，先写它' })
      const head = await readText(lockPath)
      if (head.indexOf('ppt-master-schema: spec-lock/v1') < 0) return JSON.stringify({ ok: false, error: 'spec_lock.md 缺 schema marker' })
      const v = await runPython('project_manager.py', ['validate', p.path])
      if (v.code !== 0) return JSON.stringify({ ok: false, step: 'validate', error: (v.err + '\n' + v.out).slice(-800) }, null, 2)
      st.phase = 'gate2'
      st.gates.gate2 = 'pending'
      st.resume_note = '门2：等用户确认冻结'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    if (args.action === 'approve') {
      if (st.phase !== 'gate2') return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能 approve 门2' })
      st.gates.gate2 = 'approved'
      st.phase = 'author'
      st.resume_note = ''
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    if (args.action === 'reject') {
      if (st.phase !== 'gate2') return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能 reject 门2' })
      st.gates.gate2 = 'rejected'
      st.phase = 'lock_draft'
      st.resume_note = '用户驳回门2，修订 spec_lock.md 后重新 submit'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    return JSON.stringify({ ok: false, error: '未知 action' })
  })

  // ---------- ppt_qa ----------
  define('ppt_qa', 'S6 质量门封装：跑 svg_quality_checker（stage=first-page 首页门 / final 终检），0 error 记录到 ppt.json。first-page 用于 P01 后；final 用于全部页画完后（先于 notes）。', {
    slug: { type: 'string', required: true },
    stage: { type: 'string', required: true, enum: ['first-page', 'final'] },
  }, async (args, exec) => {
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在' })
    const st = p.state
    const allowed = ['author', 'notes', 'critic_svg', 'export', 'critic_pptx', 'gate3']
    if (allowed.indexOf(st.phase) < 0) return JSON.stringify({ ok: false, error: '当前阶段 ' + st.phase + ' 不能跑质量门' })
    const r = await runPython('svg_quality_checker.py', [p.path, '--stage', args.stage, '--json'])
    const tail = (r.out + '\n' + r.err).slice(-2000)
    const report = (args.stage === 'first-page')
      ? path.join(p.path, 'validation', 'svg_quality_first_page_report.json')
      : path.join(p.path, 'validation', 'svg_quality_report.json')
    st.qa = st.qa || {}
    st.qa[args.stage] = { pass: r.code === 0, at: nowIso(), report: report }
    await saveState(p.path, st, exec)
    if (r.code !== 0) {
      return JSON.stringify({ ok: false, step: 'svg_quality_checker ' + args.stage, summary: tail, report: report }, null, 2)
    }
    return stateOut(args.slug, st, { qa_pass: true, report: report })
  })

  // ---------- ppt_author ----------
  define('ppt_author', 'S6/S7 登记：action=page 登记一页（校验 svg_output/NN_name.svg 存在）；action=pages_done 要求 qa.final 已 pass 后进 notes；action=notes_done 校验 notes/total.md 后进 critic_svg。', {
    slug: { type: 'string', required: true },
    action: { type: 'string', required: true, enum: ['page', 'pages_done', 'notes_done'] },
    page: { type: 'string', description: 'action=page 时的页文件名，如 01_cover.svg' },
  }, async (args, exec) => {
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在' })
    const st = p.state
    if (args.action === 'page') {
      if (st.phase !== 'author') return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，只有 author 阶段可登记页' })
      if (!args.page || !/^\d{2}_.+\.svg$/.test(args.page)) return JSON.stringify({ ok: false, error: 'page 参数应为 NN_name.svg 格式' })
      const f = path.join(p.path, 'svg_output', args.page)
      if (!(await exists(f))) return JSON.stringify({ ok: false, error: '文件不存在: ' + f })
      const pages = st.pages || []
      if (!pages.some(function (x) { return x.file === args.page })) {
        pages.push({ file: args.page, at: nowIso() })
        st.pages = pages
        await saveState(p.path, st, exec)
      }
      return stateOut(args.slug, st)
    }
    if (args.action === 'pages_done') {
      if (st.phase !== 'author') return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，pages_done 需在 author' })
      if (!st.qa || !st.qa.final || !st.qa.final.pass) return JSON.stringify({ ok: false, error: '先跑 ppt_qa stage=final 并 0 error 才能 pages_done' })
      st.phase = 'notes'
      st.resume_note = '写 notes/total.md 后调 ppt_author action=notes_done'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    if (args.action === 'notes_done') {
      if (st.phase !== 'notes') return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，notes_done 需在 notes' })
      const total = path.join(p.path, 'notes', 'total.md')
      if (!(await exists(total))) return JSON.stringify({ ok: false, error: 'notes/total.md 不存在' })
      st.phase = 'critic_svg'
      st.resume_note = ''
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    return JSON.stringify({ ok: false, error: '未知 action' })
  })

  // ---------- ppt_critic ----------
  define('ppt_critic', 'S8/S10 critic 记录：layer=svg|pptx；先由主 agent 派子代理按四维清单评审并把报告写到 validation/critic_<layer>_r<N>.md，再调本工具登记轮次与 verdict（pass/fail/override）。fail 且未超限回 author 修订；超限或 override 进入下一关。', {
    slug: { type: 'string', required: true },
    layer: { type: 'string', required: true, enum: ['svg', 'pptx'] },
    verdict: { type: 'string', required: true, enum: ['pass', 'fail', 'override'] },
    round: { type: 'integer', required: true, description: '本轮号（从 1 起）' },
  }, async (args, exec) => {
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在' })
    const st = p.state
    const layerPhase = args.layer === 'svg' ? 'critic_svg' : 'critic_pptx'
    if (st.phase !== layerPhase) return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，' + args.layer + ' critic 需在 ' + layerPhase })
    const report = path.join(p.path, 'validation', 'critic_' + args.layer + '_r' + args.round + '.md')
    if (!(await exists(report))) return JSON.stringify({ ok: false, error: '报告不存在: ' + report + '（先让子代理评审并落盘）' })
    const cfg = await readJson(SETTINGS_PATH)
    const maxRounds = (cfg.critic && cfg.critic.max_rounds) || 2
    const slot = st.critic[args.layer]
    slot.rounds = Math.max(slot.rounds || 0, args.round)
    slot.last_report = report
    if (args.verdict === 'fail') {
      if (slot.rounds >= maxRounds) {
        st.resume_note = 'critic ' + args.layer + ' 已超 ' + maxRounds + ' 轮仍未过：请用户仲裁（override 放行或继续修订）'
        await saveState(p.path, st, exec)
        return JSON.stringify({ ok: false, escalated: true, layer: args.layer, rounds: slot.rounds, max_rounds: maxRounds, note: 'critic 超限未过，需用户仲裁：继续修订后重试 fail 前状态，或用户批准后调 ppt_critic verdict=override' }, null, 2)
      }
      st.phase = 'author'
      st.resume_note = 'critic ' + args.layer + ' r' + args.round + ' fail：修订 svg_output 页 → 重跑 ppt_qa final → 视情况重写 notes → 再回 critic'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st, { critic_fail: true, round: args.round, next_round: args.round + 1 })
    }
    // pass or override
    slot.verdict = args.verdict === 'override' ? 'override' : 'pass'
    if (args.layer === 'svg') {
      st.phase = 'export'
      st.resume_note = '调 ppt_export action=export'
    } else {
      st.phase = 'gate3'
      st.gates.gate3 = 'pending'
      st.resume_note = '门3：渲染成品呈用户验收'
    }
    await saveState(p.path, st, exec)
    return stateOut(args.slug, st, { critic_pass: true, report: report })
  })

  // ---------- ppt_export ----------
  define('ppt_export', 'S9/门3：action=export 串行跑 7.1 total_md_split → 7.2 finalize_svg → 7.3 svg_to_pptx → pptx_delivery_check，成功进 critic_pptx；action=approve=用户通过门3 进 done；action=reject=退回 author。', {
    slug: { type: 'string', required: true },
    action: { type: 'string', required: true, enum: ['export', 'approve', 'reject'] },
  }, async (args, exec) => {
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在' })
    const st = p.state
    if (args.action === 'export') {
      if (st.phase !== 'export') return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，export 需在 export 阶段' })
      const steps = []
      const s1 = await runPython('total_md_split.py', [p.path])
      steps.push({ step: '7.1 total_md_split', code: s1.code, tail: (s1.err + '\n' + s1.out).slice(-500) })
      if (s1.code !== 0) return JSON.stringify({ ok: false, steps: steps }, null, 2)
      const s2 = await runPython('finalize_svg.py', [p.path])
      steps.push({ step: '7.2 finalize_svg', code: s2.code, tail: (s2.err + '\n' + s2.out).slice(-500) })
      if (s2.code !== 0) return JSON.stringify({ ok: false, steps: steps }, null, 2)
      const s3 = await runPython('svg_to_pptx.py', [p.path])
      steps.push({ step: '7.3 svg_to_pptx', code: s3.code, tail: (s3.err + '\n' + s3.out).slice(-800) })
      if (s3.code !== 0) return JSON.stringify({ ok: false, steps: steps }, null, 2)
      const m = String(s3.out).match(/exports[\\/].*?\.pptx/)
      const reportM = String(s3.out).match(/\[REPORT\] (.+)/)
      const pptxPath = m ? path.resolve(p.path, m[0].trim().replace(/\\/g, path.sep)) : ''
      const reportPath = reportM ? reportM[1].trim() : ''
      const finalPath = pptxPath || (await latestExport(p.path))
      const s4 = await runPython('pptx_delivery_check.py', [finalPath])
      steps.push({ step: 'delivery_check', code: s4.code, tail: (s4.err + '\n' + s4.out).slice(-600) })
      st.exports = st.exports || []
      st.exports.push({ pptx: finalPath, report: reportPath, at: nowIso(), delivery: s4.code === 0 ? 'passed' : 'failed' })
      st.phase = 'critic_pptx'
      st.resume_note = '派子代理评 PPTX 成品，报告 validation/critic_pptx_r1.md 后调 ppt_critic layer=pptx'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st, { steps: steps, pptx: finalPath, report: reportPath })
    }
    if (args.action === 'approve') {
      if (st.phase !== 'gate3') return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，approve 需在 gate3' })
      st.gates.gate3 = 'approved'
      st.phase = 'done'
      st.resume_note = ''
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st, { delivered: true })
    }
    if (args.action === 'reject') {
      if (st.phase !== 'gate3') return JSON.stringify({ ok: false, error: 'phase=' + st.phase + '，reject 需在 gate3' })
      st.gates.gate3 = 'rejected'
      st.phase = 'author'
      st.resume_note = '用户门3 驳回：修订后重跑 qa/notes/critic/export'
      await saveState(p.path, st, exec)
      return stateOut(args.slug, st)
    }
    return JSON.stringify({ ok: false, error: '未知 action' })
  })

  async function latestExport(projectPath) {
    try {
      const names = await listDirNames(path.join(projectPath, 'exports'))
      const pptx = names.filter(function (n) { return /\.pptx$/i.test(n) }).sort().pop()
      return pptx ? path.join(projectPath, 'exports', pptx) : ''
    } catch (e) {
      return ''
    }
  }

  // ---------- ppt_status ----------
  define('ppt_status', '只读：给 slug 输出项目状态机（phase/gates/qa/critic/exports + 下一步提示）；不给 slug 列出全部项目。resume 续跑入口。', {
    slug: { type: 'string', description: '可选；缺省列出所有项目' },
  }, async (args) => {
    if (!args.slug) {
      let index = {}
      if (await exists(INDEX_PATH)) { try { index = await readJson(INDEX_PATH) } catch (e) { index = {} } }
      const out = { ok: true, projects: [] }
      for (const k in index) {
        const rec = index[k]
        let phase = '?'
        try {
          const st = await readJson(path.join(rec.path, 'ppt.json'))
          phase = st.phase
        } catch (e) { /* missing/corrupt state reads as unknown */ }
        out.projects.push({ slug: k, path: rec.path, title: rec.title || '', phase: phase })
      }
      return JSON.stringify(out, null, 2)
    }
    const p = await findProject(args.slug)
    if (!p.found) return JSON.stringify({ ok: false, error: '项目不存在: ' + args.slug })
    return stateOut(args.slug, p.state, { projectPath: p.path })
  })
}

export { apply, inject, name }
