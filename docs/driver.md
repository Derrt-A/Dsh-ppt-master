# ppt-master 引擎驱动文档（Default Generate · 无模板纯矢量场景）

> **来源与许可**：本文档是依据 [ppt-master](https://github.com/hugohe3/ppt-master)
> v4.7.0 的官方文档与实测行为整理的**非官方衍生文档**（引擎 MIT，
> Copyright (c) 2025-2026 Hugo He），不是 ppt-master 官方发行物。引擎本身不随本仓库分发，
> 由安装脚本从上游拉取；本文档与 ppt-master 作者无隶属或背书关系。
>
> 本文档是把本地安装的 ppt-master 引擎（Generate PPTX 路由、默认流程、free design、
> 纯矢量、无图片无音频场景）的**执行知识**压缩成的驱动手册，供另一个 agent 在
> DSH 环境里逐阶段驱动该引擎产出 PPTX。文档可直接照做：所有命令给出完整参数模板。
> 本文档只读引擎，不修改引擎任何文件。

## 0. 固定路径与占位符

| 占位符 | 取值来源 | 说明 |
|---|---|---|
| `{SKILL_DIR}` | `settings.json` 的 `engine_root`（或 `DSH_PPT_ENGINE`） | 引擎根目录（= skill 包根，含 `SKILL.md`/`workflows/`/`scripts/`/`references/`/`templates/`） |
| `{VENV_PY}` | `settings.json` 的 `python`（或 `DSH_PPT_PYTHON`） | 安装脚本创建的 venv 解释器；已装 python-pptx/XlsxWriter/skia-pathops/uharfbuzz/PyMuPDF/mammoth/openpyxl/Pillow/edge-tts/Flask 等 |
| `{PROJECTS_BASE}` | `<数据根>/projects`（`DSH_PPT_DATA`） | 驱动工作区；不要用引擎仓库内 `projects/` |
| `{PROJECT_PATH}` | 由 `init` 打印出的项目绝对路径，形如 `{PROJECTS_BASE}\<name>_ppt169_<YYYYMMDD>` | 每个命令都传这个绝对路径 |

> 数据根优先级：`DSH_PPT_DATA` → 包根 `config.local.json#dataRoot` → `$DSH_HOME/dsh-ppt`。
> 运行 `scripts/setup.ps1`（或 `setup.sh`）后，`{SKILL_DIR}` 和 `{VENV_PY}` 的实际值可直接从
> `<数据根>/settings.json` 读取。

- 场景默认（settings.json）：`input_mode=sources_only`、`language=zh`、`canvas=16:9`(=ppt169)、
  `image_backend=none`、`audio=false`。即：无模板（free design / `pptx_structure.mode: flat`）、
  不生成不搜索图片、不做旁白音频。
- 命令模板按 PowerShell 可执行形式书写（DSH 的 pwsh 工具）。若驱动 shell 是 bash/cmd，
  只需把 `& {VENV_PY} "..."` 换成 `"{VENV_PY}" ...` 或 `python3 ...`。
- 引擎文档中的 `python3 ${SKILL_DIR}/scripts/xxx.py` 等价于
  `& {VENV_PY} "{SKILL_DIR}\scripts\xxx.py"`（Windows 无 `python3` 时用 `python`，见 §6）。

---

# §0 全局纪律（先读，违反任何一条都应停下）

1. **attribution_guard 必须最先跑**。每个驱动会话（或每次重新打开引擎）在操作前
   先在 SKILL 目录下执行一次完整性门：
   ```powershell
   & {VENV_PY} "{SKILL_DIR}\scripts\attribution_guard.py"
   ```
   退出码 0 = 通过；退出码 78（stderr 打印 “PPT Master skill integrity check failed…”）=
   失败。**任何非零立即停止整条流程**：不得“检查/修复/绕过”该门；官方发行文件缺失或被改动
   （LICENSE、SPONSORS.md/CN、SKILL.md frontmatter、脚本内嵌门调用）都会触发。也禁止为了
   “通过校验”去改动这些文件。绝大多数官方脚本 import 时还会执行第二重身份门，失败退出 78。
2. **任何脚本非零退出 = 该阶段失败，立即停止串行推进**。修复产生问题的“属主工件”
   （owning source artifact），然后从失败的那一步重跑；不要“继续也能凑合”，不要静默降级
   （failure-recovery.md：`Forbidden — silent downgrade`）。
3. **阻塞门（⛔ BLOCKING）语义**：门未关闭不得越过做下一阶段的事，也不得替用户做决定。
   门关闭 = 显式确认（用户回复/授权），或该门的确定性通过条件（退出码 0 + 成功判据）成立。
   引擎确认类门（Stage 1/Stage 2）**只能由用户确认**，除非用户显式委托给 agent。
4. **串行执行、不跨门打包**：Step 7 的命令一条一条跑（7.1→7.2→7.3），严禁合并进一条 shell
   命令；非阻塞步骤完成可自动进入下一步。
5. **路径一律用绝对路径**：`{SKILL_DIR}`/`{PROJECT_PATH}`/`{PROJECTS_BASE}` 全写全；
   绝不从当前工作目录推导项目路径。`project_manager.py` 缺省 base 是 `cwd\projects`，
   不要依赖它；`init` 一律显式 `--dir "{PROJECTS_BASE}"`。
6. **SVG 页面必须由主 agent 亲手逐页写**（不得派生子 agent 画页、不得用 Python/Node/shell
   脚本批量生成 `svg_output/`）。`preset_shape_svg.py`/`shape_boolean_svg.py` 只允许输出
   片段并人工粘贴，绝不替 agent 选型或写页。
7. **质量检查器输出不许过滤**：`svg_quality_checker.py` 的调用不能接 `tail/head/grep` 管道；
   每次失败都基于“一次完整输出”做一轮合并修复再复跑，禁止单条修复之间反复跑 checker。
8. **报告文件只在需要时读**：成功的 checker/导出运行只以退出码与终端摘要为准（防爆上下文）；
   失败排查才读对应 JSON 报告里需要的字段（如 `validation/svg_quality_report.json` 的
   `categories.blocking.issues`）。`confirm_ui/result.json` 正常流程只读一次。
9. **每 5 页重锚定**（Default 专属）：P05/P10/… 之后且后面还有页时，完整重读一次
   `spec_lock.md`（引擎规定，非可选）。
10. **角色切换纪律**：换角色前读对应 `references/<role>.md` 并输出
    `## [Role Switch: <Role>]` 块（SKILL.md 通信规则）。
11. **页设计闭包**：某页要出现在成品上的每个可见元素都必须存在于该页 `svg_output/*.svg`
    或由其显式引用；`design_spec.md`/`spec_lock.md`/模板只指导创作，不在导出时补内容。
12. **恢复点语义**：失败后从失败属主步骤恢复，不重开规划（详见
    `workflows\governance\failure-recovery.md` §3 Resume Pointers）。

---

# §1 状态机阶段速查表

引擎真实步骤与本文阶段映射：Default Generate 的 **Step 1 源处理 / Step 2 建项目 /
Step 3 模板候选 / Step 4 Strategist(两段确认+design_spec+spec_lock) / Step 5 图片(条件) /
Step 6 Executor(逐页 SVG+首页门+终检+notes) / Step 7 后处理导出(7.1 拆 notes·7.2 finalize·7.3 export)**。

> ⚠️ 引擎的两条**硬性内部顺序**（与本文 S6–S8 标签略有交错，执行时以引擎顺序为准）：
> ① **终检（final SVG quality gate）必须先于写 speaker notes**——它在最后一张页画完后立刻跑，
> 0 error 才算通过；② P01 首页门必须在画 P02 之前跑且通过。③ S8 的 critic 若改动 SVG，
> 必须重跑终检；notes 已生成则同步重写 `notes/total.md` 并重拆。

| 阶段 | 一句话 | 关键脚本 | 产物 | 过关判据 |
|---|---|---|---|---|
| S1 源材料摄取 | 转 MD + 建项目 + 导入源 | source_to_md / project_manager init / import-sources | `sources/`、项目目录、`validation/workflow.log` | 命令 0；有可用内容 |
| S2 调研（条件） | 只补事实缺口 | （agent web/fetch 为主，web_to_md 兜底）+ import-sources | `{PROJECTS_BASE}/<slug>.md/.facts.json`（再导入 `sources/`） | 两文件齐全一致，schema 正确 |
| S3 Strategist + design_spec（门1） | 两段确认(chat 或 UI) + 写 I–X | confirm_ui/server(仅UI) / project_manager validate | `design_spec.md`（项目根） | validate=0、无占位符、确认值全落盘 |
| S4 spec_lock（门2） | 从 design_spec 投影锁 | project_manager validate | `spec_lock.md` | 锁与 spec 一致；validate=0 |
| S5 图片（跳过） | 无 §VIII 行 → 整段跳过 | （无） | — | 无 Pending/Failed 资源行；SVG 无图 |
| S6 Executor 逐页 SVG | P01→首页门→连续画完→**终检** | svg_editor/server(后台)、svg_quality_checker(first-page/final)、preset/shape_boolean 片段 | `svg_output/<NN>_<name>.svg` | 首页门 0 error；终检 0 error |
| S7 notes（条件） | 终检通过后按最终页写讲稿 | （无；全 agent 写作） | `notes/total.md` | 覆盖全部页、纯散文 |
| S8 SVG critic | LLM 复核/可选视觉自检；有改动则重检 | svg_quality_checker final（复跑） | 更新 `svg_output/`、（可能）`notes/` | 终检报告 0 error 且与当前页匹配 |
| S9 导出 | 7.1 拆 notes → 7.2 finalize → 7.3 export | total_md_split / finalize_svg / svg_to_pptx | `svg_final/`、`exports/*.pptx`、`validation/*.report.json` | 各步 0；报告 status passed / passed-with-warnings |
| S10 PPTX critic → 门3 | 读后检报告+独立审计+（可选）修订循环 | pptx_delivery_check（只读审计）；修订时重跑 S9 | 终版 PPTX | 三要素齐备+审计 0+修订收敛 |

以下各小节 = 每阶段“要做的事 / 要读的文件 / 命令模板 / 产物 / 质量门判定”。

## S1 源材料摄取（引擎 generate-pptx.md Step 1–2）

**要做的事**：把所有非 Markdown 源材料转成标准 Markdown（事实通道），评估材料充分性，建项目目录，把源导入 `sources/`。

**要读的引擎文件**：`workflows/generate-pptx.md`（Step 1–2 全文）；当源含 PDF/Office/PPTX/网页时加读 `scripts/docs/conversion.md`。

**命令模板（按源类型）**：
```powershell
# PDF / DOCX / XLSX(XLSM) / PPTX / EPUB / HTML / LaTeX / RST / web URL，可多个、可目录
& {VENV_PY} "{SKILL_DIR}\scripts\source_to_md.py" "<文件或URL或目录>" ...
# 多个输入/目录时建议指定输出目录（其余情况默认 md 写在源旁边并生成 *.conversion_profile.json）
& {VENV_PY} "{SKILL_DIR}\scripts\source_to_md.py" "<目录>" -o "<md输出目录>"
# CSV/TSV/Markdown：直接读，无需转换
```
```powershell
# 建项目（名字只能是一个目录组件；日期后缀自动加；路径以打印为准）
& {VENV_PY} "{SKILL_DIR}\scripts\project_manager.py" init <project_name> --format ppt169 --dir "{PROJECTS_BASE}"
# 导入源（传 Step1 的原文路径；若 Step1 用 -o 写到别处，原文与 md 输出路径都传）
& {VENV_PY} "{SKILL_DIR}\scripts\project_manager.py" import-sources "{PROJECT_PATH}" "<源1>" "<源2>" ...
```
- PPTX 源：`import-sources` 会自动跑标准 intake（等价于 `pptx_intake.py <src> -o <project>/analysis`），
  生成 `analysis/source_profile.json`（多 deck 唯一索引）+ 每 deck `<stem>.identity.json` /
  `<stem>.slide_library.json`。这些是**事实参考**（画布/表格/图表/SmartArt 摘要），不是复刻约束。
- 用户直接给文本 → 不需要 import；内容已在会话上下文。
- 用户给了位图 → 该图片视为 `user / Existing` 资源，仍需 `analyze_images.py`（见 S5）；
  纯矢量场景 images/ 保持为空，**不**跑 analyze_images。

**产物**：`{PROJECT_PATH}\`（含 `sources/ svg_output/ svg_final/ images/ icons/ notes/ templates/
live_preview/ analysis/ validation/ exports/` 与 `README.md`）、`{PROJECT_PATH}\validation\workflow.log`。

**质量门**：① `source_to_md` 退出码 0（多输入时 `[Done] Success: N/M`，任一失败整体非 0）；② `init`
退出码 0 且打印 `[OK] Project initialized: <path>`（记下该路径为 `{PROJECT_PATH}`）；③ `import-sources`
退出码 0（打印 `[OK] Imported sources into: …`）；若打印 `[ERROR] No usable sources imported`（exit 1）
→ 停，检查输入。④ 充分性检查：材料足以支撑目标即进 S2（若材料完整且无外部事实缺口，**跳过 S2**）。

## S2 调研（条件；纯源材料充分时整体跳过）

**触发**：topic-only 输入；或转换阅读后仍缺少目标所需的外部可验证事实。
**不做**：不选/不下载/不生成图片；不替 Strategist 做规划决策。

**要读的引擎文件**：`workflows/stages/topic-research.md`。

**要做的事**：能派隔离研究 worker 就派一个；无则主 agent 自查。只补缺口（Sufficiency test：
缺一个事实就可能导致编造/遗漏/无支撑）。写完两个工件并校验后走导入。
```powershell
# 主 agent 兜底抓网页（只有 worker 无 web 工具时才用）
& {VENV_PY} "{SKILL_DIR}\scripts\source_to_md\web_to_md.py" "<URL>"
# 之后把研究对导入项目
& {VENV_PY} "{SKILL_DIR}\scripts\project_manager.py" import-sources "{PROJECT_PATH}" "{PROJECTS_BASE}\<slug>.md" "{PROJECTS_BASE}\<slug>.facts.json"
```

**产物**：`{PROJECTS_BASE}\<slug>.md`（须含 `## Research Brief`、正文按缺口组织、末尾 `## Sources`）
与 `<slug>.facts.json`（schema `ppt-master.fact-provenance.v1`，事实 ID 唯一递增，外部主张才收录）。

**质量门**：两文件都存在、JSON 可解析且 schema 正确、Markdown 与 JSON 一致；否则退回研究 worker 修复。
本场景 material 完整（sources_only）时此阶段=跳过，无产物。

## S3 Strategist / design_spec —— 门1（引擎 Step 3–4）

**要读的引擎文件（依触发）**：`references/strategist.md`（必读角色核心）；
无模板场景**不读** `strategist-template.md`；无图片场景**不读** `strategist-image.md` 及
`image-*/modes*/visual-styles*` 索引族（纯矢量自由设计：除非真用了 preset mode/style）。
`scripts/docs/confirm_ui.md`（走 UI 分支时）；写 spec 前必读 `templates/design_spec_reference.md`。

**要做的事（顺序）**：
1. 模板候选准备（Step 3，静默）：注册候选来自 4 个 `*_index.json`；free design 场景默认
   `default_mode=free_design`、候选为空——无需生成 `template_options.json`，更不读任何模板内容。
2. 沟通契约 + 模板/自由设计**同屏一次确认**（Stage 1）；自由设计=`free_design`（无根 workspace）。
3. Stage 1 关闭后再给完整解决方案与生产机制确认（Stage 2：generation_mode / refine_spec /
   Speaker Notes / Custom Animations / Narration Audio / 图片路径 `none`）。
4. 消费一次最终确认值 → 通读 `templates/design_spec_reference.md` → 一次写完整 I–X
   `{PROJECT_PATH}\design_spec.md`（无占位符、无 scaffold 补丁）。
5. 逐字段审计（Gate 1）→ 若 §I `refine_spec: enabled` 则在 chat 里可修订直到显式批准。
6. `analyze_images` 只在用户给了图片时先跑；本场景不跑。
7. 跑项目校验（见下）。

**确认渠道**：DSH 场景推荐 **chat 分支**（把“通信契约 + free_design”一次呈给用户等一个明确回复；
不回=停。禁用 magic keyword 判定；**只有用户本人或显式委托**才能确认）。若驱动会话默认走 UI 分支：
```powershell
& {VENV_PY} "{SKILL_DIR}\scripts\confirm_ui\server.py" "{PROJECT_PATH}" --daemon
& {VENV_PY} "{SKILL_DIR}\scripts\confirm_ui\server.py" "{PROJECT_PATH}" --wait-only --wait-stage stage1
# Stage1 通过后（free_design 无需装模板；不得手写 template_handoff.json）：
& {VENV_PY} "{SKILL_DIR}\scripts\confirm_ui\server.py" "{PROJECT_PATH}" --complete-template-selection
& {VENV_PY} "{SKILL_DIR}\scripts\confirm_ui\server.py" "{PROJECT_PATH}" --wait-only   # 等 Stage2 final+confirmed
& {VENV_PY} "{SKILL_DIR}\scripts\confirm_ui\server.py" "{PROJECT_PATH}" --shutdown     # 收尾必须释放
```
（Stage1 的 wait 退出 0 只是“继续”信号，不是完成；`stage:final + status:confirmed` 才关闭确认流。）

**命令模板（Gate 1 校验）**：
```powershell
& {VENV_PY} "{SKILL_DIR}\scripts\project_manager.py" validate "{PROJECT_PATH}"
```

**产物**：`{PROJECT_PATH}\design_spec.md`（结构见 §4）。

**质量门（门1 判定）**：validate 退出码 0（无 `[ERROR]` 项；schema 校验=结构，不证明语义保真）；
I–X 齐全有序、每页有 `Audience move`、无 `[fill…]` 残留；逐字段与保留的最终确认值一致；§IX 页数=§I Page Count。
失败 → 从保留的确认状态修 `design_spec.md`（不要重开 result.json），再写锁（S4）。

## S4 spec_lock —— 门2（引擎 Step 4 收尾）

**要读的引擎文件**：`templates/spec_lock_reference.md`（+ 需要时 `templates/schemas/spec_lock.schema.json`）。

**要做的事**：读取已审计的 design_spec + 当前页/项目上下文 → 一次写完整 `spec_lock.md`
（marker 首行 `<!-- ppt-master-schema: spec-lock/v1 -->`）。只投影跨页锚点/路由，不复制页面局部装饰。
Flat/free-design 锁必须：`canvas`、`communication`（新锁含 primary_language BCP-47，禁 `und`/无 script 的 zh）、
`mode`、`visual_style`、`colors`、`typography`（显式 `font_family`+`title_family`+`body_family` 与字号锚点）、
`icons`、`page_rhythm`（每页 P<NN>）、`pptx_structure: mode: flat`、`forbidden` 常量块。
**不得写** `pptx_masters/pptx_layouts/page_pptx_layouts/page_layouts`（structured 专属）、不写 legacy `page_charts`。

**命令模板**：
```powershell
& {VENV_PY} "{SKILL_DIR}\scripts\project_manager.py" validate "{PROJECT_PATH}"
```

**产物**：`{PROJECT_PATH}\spec_lock.md`。

**质量门（门2 判定）**：锁的锚点/路由与 Design Spec 一致（Spec 是唯一上游；不重开 result.json）；
validate=0；无非法枚举/畸形页键/缺失条件字段。门2 失败 → 只重写失配的锁行（不动 design_spec）。
锁写好后进入执行态：Executor 在有效上下文内常驻完整 spec+lock。

## S5 图片（本场景=跳过；条件是硬规则）

**触发条件**（任一才执行，来自 `design_spec.md §VIII`）：资源行 `Acquire Via` ∈ {ai, web, slice}，
或有 `Derived from <canonical>; treatment=…` 待物化行；用户给了图需要 analyze_images。
**纯矢量场景**：§VIII 无数据行（表仍在，仅表头）、§I `AI Image Acquisition Path: not applicable`、
§I 图片源 `none` → **本阶段无脚本、无产物，直接继续**；Spec/锁里也不许出现 image_prompts/image_queries 之类侧车。

**若意外出现图片资源**：`analyze_images.py` → `analysis\image_analysis.csv` 是唯一权威事实视图
（每次 images/ 变化后重跑；空目录会得到只有表头的 CSV，请以“无图”处理，勿用陈旧 CSV）。

**质量门**：每个资源行必须到终端态（Generated/Needs-Manual…）；SVG 里不许出现锁中没有的 `<image>` 引用（见 §3 规则 14）。本场景恒过。

## S6 Executor 逐页 SVG（引擎 Step 6 主体 + 终检第一次执行）

**前置**：`design_spec.md` 与 `spec_lock.md` 都存在；无效上下文先整读两者一次。
**要读的引擎文件（一次批量加载）**：
`references/executor-base.md`、`shared-standards-core.md`、`svg-effects.md`（§6.1 必用）、
`native-shape-authoring.md`、`semantic-svg.md`、`modes/_index.md`、`visual-styles/_index.md`，
以及锁定的 1 个 mode + 1 个 visual_style 详情文件（custom 则读其 `*_references`；novel custom 不读文件）。
无图片→不读 executor-image/executor-web-image/image-layout-*；无公式/无超链接/无图表则相应分支不读。

**要做的事**：
1. 首个 SVG 前：输出设计参数确认（画布/正文字号/主色/字体方案）+ 启动 live preview。
2. 启动浏览器预览（**必须**，后台长驻，勿等退出、勿等确认）：
   ```powershell
   & {VENV_PY} "{SKILL_DIR}\scripts\svg_editor\server.py" "{PROJECT_PATH}" --live --daemon
   ```
   URL 从输出或 `{PROJECT_PATH}\live_preview\lock.json` 读（默认首个空闲端口自 5050 起；
   `--port N` 强绑）。启动失败 → 报告失败继续生成（failure-recovery 允许）。
3. 逐页手写 `{PROJECT_PATH}\svg_output\<NN>_<name>.svg`（命名见 §3 规则；**不许子 agent 画页**）。
4. **首页门**：P01 完成后、画 P02 前，运行
   ```powershell
   & {VENV_PY} "{SKILL_DIR}\scripts\svg_quality_checker.py" "{PROJECT_PATH}" --stage first-page --json
   ```
   一次未过滤运行 → 审完整个 issue 集 → 合并修复 → 复跑验证 → 直到退出码 0。
   通过后输出一行 `gate-signal: method=… | page-local=… | not-exercised=…`，再连续画完其余页
   （P02 到末页之间不再调用 checker）。
5. 常用辅助片段（人工选择后插入页面，禁止批量/重定向）：
   ```powershell
   # 预置形状：查/描述/渲染（只输出 stdout 片段）
   & {VENV_PY} "{SKILL_DIR}\scripts\preset_shape_svg.py" list --search arrow
   & {VENV_PY} "{SKILL_DIR}\scripts\preset_shape_svg.py" render rightArrow --id p03-growth-arrow --frame 160 210 320 112 --fill "#2563EB" --stroke none --adjust "adj1=val 50000"
   # 布尔/合并形状：交/差/并等（来源只读，结果路径输出到 stdout）
   & {VENV_PY} "{SKILL_DIR}\scripts\shape_boolean_svg.py" render "<slide.svg>" --operation intersect --source circle --source card --id overlap
   ```
6. **终检（第一次）**——最后一张页画完即跑（引擎要求：**先于 S7 notes**）：
   ```powershell
   & {VENV_PY} "{SKILL_DIR}\scripts\svg_quality_checker.py" "{PROJECT_PATH}" --stage final --json
   ```
   判据与循环同首页门（一次完整输出→合并修复→复跑；成功只看退出码与摘要；
   warnings 全部 advisory、不强制改）。报告落在 `validation\svg_quality_report.json`（勿常规 cat）。

**产物**：`svg_output\<NN>_<name>.svg`（每页一个）、`validation/svg_quality_first_page_report.json`、
`validation/svg_quality_report.json`。

**质量门**：首页门 0 error；末页后终检 0 error；§IX 页序 1:1 覆盖。**0 error 的终检报告是 S9 导出的硬前置**。

## S7 notes（条件；仅当 §I Speaker Notes = enabled）

**前置**：S6 终检 0 error。**要读**：`references/executor-notes.md`。
**要做的事**：按最终页序把每页的每个信息承载组（direct-root `<g id>`）语义编成讲稿，
一次写入 `{PROJECT_PATH}\notes\total.md`：
- 每页一个 `# <NN>_<page_title>` 标题 + 页间 `---`；纯散文（TTS 逐字朗读，禁止列表/舞台标记/时长行）。
- 以 SVG 为准（页面可见状态），禁止从大纲或 core message 单写；禁止补页码/装饰/页脚等非信息内容。
- §I 若 disabled（用户显式关或本项目设 audio=false 但未关 notes 时默认仍 enabled）：不加载该分支、
  不生成/不要求 `notes/total.md`，S9 导出用 `--no-notes`。

**产物**：`notes\total.md`。**质量门**：段落数=发布页数、每页覆盖其信息组。此阶段无脚本。

## S8 SVG critic（终检再验证 + 可选视觉自检；可迭代）

**要做的事**：critic 按上层 checklist（settings `critic.checklist=four_dimensions`、
`max_rounds=2`、`target=both`）逐页复核 `svg_output/` 与 `design_spec/spec_lock` 的吻合度。
每次修改页面后必须串行复跑：
```powershell
& {VENV_PY} "{SKILL_DIR}\scripts\svg_quality_checker.py" "{PROJECT_PATH}" --stage final --json
```
- 若页被改且 Speaker Notes enabled → 重写 `notes/total.md`（S7）后再进 S9（7.1 会重拆）。
- 只有用户显式说“跑一下视觉自检/视觉回看”等才触发 `workflows/stages/visual-review.md`；
  有数据图表页才触发 `workflows/stages/verify-charts.md`；二者都不是默认步骤。

**质量门**：`svg_quality_report.json` 与当前 `svg_output/` 指纹匹配且 0 blocking error；
**注意**：svg_to_pptx 会校验报告与当前源页指纹一致，改动页后不重检 → 导出被拒。

## S9 导出（引擎 Step 7；命令严格一条一条跑）

**前置**：S6/S8 的终检报告存在、可读、final、0 blocking 且与当前页匹配。

```powershell
# 7.1 拆讲稿 —— 仅当 Speaker Notes enabled；disabled 则跳过此条
& {VENV_PY} "{SKILL_DIR}\scripts\total_md_split.py" "{PROJECT_PATH}"
# 7.2 生成自包含预览（必跑；写 svg_final/，不是导出源）
& {VENV_PY} "{SKILL_DIR}\scripts\finalize_svg.py" "{PROJECT_PATH}"
# 7.3 导出原生 PPTX —— notes enabled 用默认；disabled 追加 --no-notes
& {VENV_PY} "{SKILL_DIR}\scripts\svg_to_pptx.py" "{PROJECT_PATH}"
#           或（notes disabled）:
& {VENV_PY} "{SKILL_DIR}\scripts\svg_to_pptx.py" "{PROJECT_PATH}" --no-notes
```

**判据（逐条成功后进下一条）**：
- 7.1：enabled 时 `notes\` 下每页一个 md 且全覆盖（disabled 时无 7.1、无 notes 产物要求）。
- 7.2：`{PROJECT_PATH}\svg_final\` 每发布页一个自包含预览 SVG；退出 0。
- 7.3：退出 0 且出现 `exports\<project_name>_<timestamp>.pptx`、
  `validation\<project_name>_<timestamp>.report.json`（status ∈ {passed, passed-with-warnings}）、
  stdout 有 `[POSTFLIGHT]` 回执（status/quality_gate/Slide 数/警告计数/路径）。缺 PPTX 或 report failed ≠ 成功。
  导出器要求 spec_lock.md 存在、theme contract（colors+typography）在锁中、canvas.viewBox 在锁中；
  报告不匹配/缺失/陈旧会非零退出并给出应跑的命令。

**失败修复**：7.1/7.2/7.3 各自失败 → 修属主工件重跑该子步（不回规划）；导出前永远基于 `svg_output/`。

## S10 PPTX critic —— 门3

**要做的事**：对最终 PPTX 做发布前审计与可选的修订循环（critic 上限 2 轮）：
1. 三要素齐全：① `exports\*.pptx` 存在；② 对应 `validation\*.report.json` `status` ∈
   {passed, passed-with-warnings}（warnings 披露即可）；③ 终检报告匹配。
2. 独立只读交付审计（**只读、不改文件**）：
   ```powershell
   & {VENV_PY} "{SKILL_DIR}\scripts\pptx_delivery_check.py" "<exports下的pptx绝对路径>"
   ```
   stdout 输出整份 JSON 审计；`status: failed` → 退出码 1（不通过）；`passed` / `passed-with-advisories`
   → 退出码 0（advisories 不阻塞，如实记录）。OPC 部件/关系/超链接完整性由导出器与
   `pptx_opc_validation.py`（模块，无 CLI）内嵌校验，不必单独跑。
3. 若 critic 要求修订：修改属主源 = 对应 `svg_output/` 页 → 重跑 S8 终检 → S9 的 7.2/7.3
   （notes 若受影响则 7.1 重拆）；不要重开 planning。修订收敛或 2 轮封顶后交付。

**质量门（门3 判定）**：以上审计全部通过（delivery exit 0，postflight passed/passed-with-warnings），
critic 无未决 blocking，向用户报告 `exports\*.pptx` 绝对路径。若 §I Narration Audio enabled 才接
`workflows/stages/generate-audio.md`（本场景 audio=false，跳过）。

---

# §2 脚本命令手册（签名 / 参数 / 成功与失败判定）

> 统一记法：下面把 `& {VENV_PY} "{SKILL_DIR}\scripts\<脚本>.py"` 写成 `{PY} <脚本> …`。
> 判“成功”一律先看退出码（0），再看 stdout 特征与产物。

| 脚本 | 签名与关键参数 | 成功/失败判定 |
|---|---|---|
| `attribution_guard.py` | `{PY} attribution_guard.py`（无参，从任意 cwd 跑均可） | 0=完整；78=失败（stderr 一条固定错误）。**最先跑，非零即停** |
| `source_to_md.py` | `{PY} source_to_md.py <file_or_url_or_dir>... [-t auto\|pdf\|doc\|excel\|pptx\|web\|markdown\|text] [-o <out\|outdir>] [--json] [--no-images\|--images …]` | 0=全部成功（stdout `OUTPUT: <path>`；stderr `[OK] Saved Markdown to:`；`[Done] Success: N/M`）；1=有输入失败（列出 `[Failed inputs]`）；2=参数错。每个成功输入旁写 `<stem>.md` + `<stem>.conversion_profile.json` |
| `project_manager.py init` | `{PY} project_manager.py init <name> --format ppt169 [--dir <base>] [--quick-generate]` | 0=成功并打印 `[OK] Project initialized: <path>`；非 0=失败（格式非法/重名等）。建 `<base>\<name>_<format>_<YYYYMMDD>\` + 子目录，写 `validation\workflow.log` |
| `project_manager.py import-sources` | `{PY} project_manager.py import-sources <project_path> <src...> [--copy\|--move]` | 0=至少一条可用导入（`[OK] Imported sources into: …` 并列出 Archived/Normalized/Analysis 等）；1=`[ERROR] No usable sources imported`。PPTX 源内部自动再跑 pptx_intake |
| `project_manager.py validate` | `{PY} project_manager.py validate <project_path>` | 0=结构有效（含 warnings 也 0；打印 `[OK] Project structure …`）；1=无效（打印 `[ERROR]` 列表）。校验 design_spec/spec_lock 的 I–X/占位符/schema/enum/页键/主题契约缺失项 |
| `project_manager.py info / page-context / page-context-report / scaffold-spec / scaffold-lock` | 如 `… page-context <project> P07 [--record-usage]` | 0=成功（page-context stdout 即该页投影，非零立即停）；scaffold 仅供手动便利，非常规流程 |
| `pptx_intake.py` | `{PY} pptx_intake.py <deck.pptx> -o <analysis_dir>`（一般由 import-sources 自动调用） | 0=写出 `<stem>.identity.json`/`<stem>.slide_library.json`/`source_profile.json`；非 0=失败 |
| `svg_quality_checker.py` | `{PY} svg_quality_checker.py <project> --stage first-page\|final [--json] [--json-output <p>] [--format <fmt>] [--quick-generate\|--template-mode]` | 0=0 error；1=有 error；warnings 不影响退出。stdout `[SUMMARY]` + `[OK]/[WARN]/[ERROR]` 计数 + `Provenance categories`（blocking=introduced=…）。JSON：first-page→`validation\svg_quality_first_page_report.json`；final→`validation\svg_quality_report.json`。**禁止过滤输出、禁止改在 svg_final/ 上跑** |
| `svg_editor\server.py` | `{PY} svg_editor\server.py <project> --live --daemon [--port N]` | 长驻进程（后台 job）；从输出或 `live_preview\lock.json` 读 URL；勿等退出。启动失败可继续生成并报告 |
| `confirm_ui\server.py` | `{PY} confirm_ui\server.py <project> [--daemon\|--wait-only [--wait-stage stage1]\|--complete-template-selection\|--shutdown]` | wait 退出 0=“继续”信号；自由设计场景不写 template_handoff；收尾必 `--shutdown`。仅 UI 分支用 |
| `total_md_split.py` | `{PY} total_md_split.py <project> [-o <dir>] [-q]` | 0=拆完（`[OK] SVG files and notes have one-to-one correspondence` + `[Done] Notes splitting complete`）；1=缺页/不匹配/找不到 SVG 或 total.md。仅 notes enabled 时跑 |
| `finalize_svg.py` | `{PY} finalize_svg.py <project> [--only embed-icons align-images flatten-text] [--no-compress] [--max-dimension 2560] [--image-scale 2.0] [-q]` | 0=成功（写 `svg_final\` 自包含预览）；1=失败（`[ERROR]`）。EMF/WMF 自动跳过内嵌、原样保留 |
| `svg_to_pptx.py` | `{PY} svg_to_pptx.py <project> [--no-notes\|--with-notes] [-o <out>] [-s output\|final] [--transition <eff>] [--animation/-a …] [--image-sizing cap\|display …] [--quick-generate]` | 0=导出+postflight 成功（stdout `[POSTFLIGHT] …` + `[REPORT] <path>`；产物 `exports\<name>_<ts>.pptx`、`validation\<name>_<ts>.report.json`）；1=任意前置失败（缺 spec_lock/终检报告不匹配/结构契约错/缺 theme 字段/转换错）。`-s final` 仅诊断；release 源固定 `svg_output/` |
| `pptx_delivery_check.py` | `{PY} pptx_delivery_check.py <finished.pptx>` | stdout 整份 JSON 审计；`status: failed`→exit 1；`passed`/`passed-with-advisories`→exit 0。只读，不改 pptx |
| `pptx_opc_validation.py` | **模块，无 CLI**：`verify_internal_relationships`/`verify_hyperlink_relationships` 等被 svg_to_pptx builder 与 delivery_check 内嵌调用 | 无独立退出码；问题以列表返回、由调用方聚合 |
| `notes_to_audio.py`（本场景不跑） | `{PY} notes_to_audio.py <project> [--provider edge\|elevenlabs\|minimax\|qwen\|cosyvoice] [--voice …] …` | 0=每页 `[OK] <path>` + `[Done] Generated N/M …` + `[REPORT] Narration manifest: <path>`；1=失败（stderr `error:`）。归 generate-audio 阶段 |
| `batch_validate.py` | `{PY} batch_validate.py <dirs...> [--all] [--export [--output f]]` | 0=全部有效；1=有项目 error；2=仅 warnings；报告 `[REPORT] Validation report exported:`。批量审计用，非主流程 |
| `workflow_log.py` | `{PY} workflow_log.py <project> "<一条关键审计说明>"` | 0=`[OK] Workflow event appended: <log>`；1=失败。用于记录重要的交接/返工原因（选择性，非权威） |
| `analyze_images.py` | `{PY} analyze_images.py <project>\images` | 0=写出 `analysis\image_analysis.csv`（权威再生视图）；图片变化后重跑。纯矢量场景不跑 |
| `web_to_md.py` | `{PY} source_to_md\web_to_md.py <URL>`（S2 兜底抓取） | 成功=产出可用 Markdown；正文出现 `[Failed URLs]:` 视为不可用 |

---

# §3 SVG 页面创作规则要点（纯矢量 flat 场景的 20 条硬规则）

> 权威出处：`references/shared-standards-core.md`、`references/semantic-svg.md`、
> `references/canvas-formats.md`；质量检查器 `scripts/svg_quality/checker.py` 按此 fail-closed。
> “Required/Forbidden”不可谈判；warnings 一律 advisory。

1. **画布/viewBox**：`ppt169` 的规范画布是 `1280×720`，根 `<svg viewBox="0 0 1280 720">`；
   全 deck 每页同一声明，且必须与 `spec_lock.md canvas.viewBox` 精确一致；根 `<svg>` 禁止 transform；
   可选 width/height 不覆盖 viewBox。0 0 W H、正整数像素、W/H 在约 96–5376 px 之间。
2. **XML 严格合法**：排版符号（— – © ® → · NBSP、全角标点、emoji）写**原始 Unicode**；
   禁止 HTML 命名实体（`&mdash; &copy; &rarr; &nbsp;`…）；XML 保留字符只能写 `&amp; &lt; &gt; &quot; &apos;`
   （如 `R&amp;D`）。一个字符违规=整文件非法、导出中止。
3. **全局禁用（穷尽黑名单）**：`mask`、`<style>`、`class`、外部 CSS、`<foreignObject>`、`textPath`、
   `@font-face`、`<animate*>`/`<set>`、`<script>`/事件属性、`<iframe>`。
4. **内联属性白名单**：style 里只允许 paint/line（fill、stroke、stroke-width、stroke-dasharray、
   stroke-linecap/join、fill/stroke-opacity、vector-effect）、text（font-family、font-size、
   font-weight、font-style、text-anchor、letter-spacing、text-decoration）、alpha/定义画（opacity、
   stop-*/flood-*）、几何属性（见 5）与 shape-rendering（仅预览）。`!important`、混合模式、isolation、
   backdrop-filter 及其它未知属性 → 检查报错。`filter/clip-path/marker-*` 必须是直接属性
   `url(#id)`，不进 style。
5. **几何语法**：新写 SVG 一律有限无单位小数（`x="120"`、`stroke-width="2"`）；`px` 后缀可读但收
   recommendation warning；禁止 pt/pc/in/cm/mm/q/em/rem/%、表达式、科学计数、`+` 号、非有限值。
   style 里的几何只支持 `<rect>/<circle>/<ellipse>/<image>/<svg>/<use>`，值为 `120px` 形式；
   文本坐标、路径 d、多边形 points 仍在属性里。
6. **颜色**：常规实色用大写六位 `#RRGGBB`；fill/stroke 可用小写 `none` 或精确本地 `url(#id)`；
   其它色写法先读 svg-effects 再写（兼容写法只是 warning 不报错）。
7. **字号/字重/对齐**：`font-size` 有限正无单位 px；`font-weight` ∈ {normal,bold,100…900}；
   `font-style` ∈ {normal,italic}；`text-anchor` ∈ {start,middle,end} 且**不允许写在 `<tspan>`**；
   `font-family` 非空。可继承文本声明只允许在 `<svg>/<g>/<text>/<tspan>`。
8. **段落=一个 text 框架**：每段一个 `<text>`，多行用“首行直接文本 + 后续 positioned `<tspan>`，
   重复父 x、正相对 dy（全 tspan 形式可从 `dy="0"` 起）”；禁止用多个兄弟 `<text>` 拼一段；
   行距用相对 dy（1.2–1.3×标题 / 1.4–1.6×正文 / 1.6–2.0×疏排），不写 CSS line-height（无映射）。
9. **分组强制**：每个逻辑 Slide-local 单元包一个**描述性、页内唯一**的顶层 `<g id="…">`
   （卡片、流程步、列表项、图标+文字、页头/页脚、装饰簇各一组）；每个可见顶层 `<g>` 必须带
   root 坐标 `data-pptx-bounds="x y width height"`（给足区域，不重叠、不按字形收紧）。禁止：
   全页一个大 `<g>`、大量裸矩形/文字堆、每图标一行一组、匿名顶层组。无任何顶层组时 primitive
   兜底仅限 ≤8 个可见元素。
10. **flat 语义**：free-design 页 = `pptx_structure.mode: flat`。根 `<svg>` 恰好一个
    `data-pptx-page-role`（cover/toc/section/content/ending 之一）；**不写** `data-pptx-master*`、
    `data-pptx-layout*`、`data-pptx-layer`、`data-pptx-placeholder`、结构类 `data-pptx-bounds` 插槽。
    整页背景/满幅装饰可作 root primitive，给稳定 `id` + `data-pptx-role="background"|"decoration"`；
    不得仅为消 advisory 而套 `<g>`。
11. **data-pptx-role 最小化**：只加给包/页码/动画行为未被专门元数据表达的**结构页框对象**
    （background/decoration/header/footer/logo/watermark/chrome/page-number），并带唯一 `id`；
    普通标题/正文/卡片/KPI/图/表/图标/图片一律不加。
12. **字号纪律**：结构性文本只可用锁内命名字号锚点或 ±2px 带内值；核心主张 ≥ body 级；
    未声明 display 尺寸全 deck ≤2 次（第 3 次即回上游命名角色）；最多两位小数、无单位。
13. **字体**：锁中 `<role>_family` → `title_family`/`body_family` → 兼容 `font_family` 按角色取用；
    必须解析为目标机已装/批准的西文与东亚字体（CJK 常用 Microsoft YaHei 等）；
    无 @font-face、无嵌入；PPTX 每脚本只写一个 face。
14. **图片引用（flat 场景=无）**：若锁里有 `images` 行，SVG 只能引用 `images\` 下该行所指文件，
    `<image href>` 指向真实文件；禁止臆造文件名/路径引用；裁剪用 meet/slice/none 由导出前终检
    校验像素供给与裁切比；`finalize_svg.py` 负责 base64 内嵌与对齐。EMF/WMF 源资产：finalize 跳过、
    导出以 `image/x-emf|wmf` 原生嵌入——**禁止转 PNG**（浏览器预览空白属预期）。
15. **图标占位**：`<use data-icon="<lib>/<name>" … fill="#HEX">`，名字=项目本地精确文件名（大小写敏感）；
   必须给 `fill`，禁止只 stroke / fill="none"；stroke 库 tabler-outline 才允许
    `stroke-width ∈ {1.5,2,3}` 且须与锁 `icons.stroke_width` 一致；项目 `icons/` 缺该文件 → 回上游
   准备，不得去全局库自取。最终由 finalize 的 embed-icons 内嵌。
16. **静态同文档 `<use>`**：`href="#id"`（xlink 兼容；两者同存必须同值）；目标 ∈ symbol/g/use/
   基础几何/text/image；symbol 须有正 viewBox 且 use 带正 width/height；禁止 slice/refX/refY、
   外部/环引用、重复 id、64 实例/1 万实例上限。`<use>` 与子树不得携带结构元数据。
17. **clip-path 仅限 `<image>`**：defs 里一个 clipPath、恰好一个受支持图形子元素（circle/ellipse/
    rect(rx)/path/polygon）、无 clip-rule/fill-rule；其它元素上想裁切 → 直接画目标几何。
18. **marker 箭头**：只有 5 类映射（triangle/stealth/arrow/diamond/oval），`orient="auto[-start-reverse]"`
   带 defs `<marker>`，路径用逐顶点 M/L（闭合箭头 Z、开箭头不闭合）；颜色与父线条一致；
   其它 marker 形状无映射 → 阻断导出。
19. **可编辑文本帧/原生对象**：需要混合格式或多行文本时，保持一个 text 框架为一个 PowerPoint
    文本框（默认保留换行，`--reflow-text` 才可合并行）；普通图形直接导出为可编辑原生形状；
    需要 Office 预置/布尔时才用 preset_shape_svg/shape_boolean_svg 片段（规则见 §1 S6），
    手写 `<path>` 兜底永远是最后选择。
20. **质量门语义**：`svg_quality_checker` 在 `svg_output/` 上跑（不要在 finalize 之后跑，会掩盖违规）；
   终检要求 exit 0；warning 不强制修改；report 里 blocking=release 失败、introduced=新/变更 advisory、
   inherited/source-import=信息。导出前必须存在与当前源页指纹匹配的 passing final report。

---

# §4 design_spec.md / spec_lock.md 结构要点与锁定规则

## 4.1 design_spec.md（`{PROJECT_PATH}\design_spec.md`，人类可读英文标题）

- 首非空行固定：`<!-- ppt-master-schema: design-spec/v1 -->`，第二行 `# <项目名> - Design Spec`。
- 固定 I–X 章节（角度括号是作者记号，成品里要解析成最终值，不写示例/占位符）：
  - **§I Project Information**：表行含 Canvas Format、Page Count（=§IX 页数）、Primary Language
    （BCP-47）、Target Audience、Communication Intent、Desired Audience Outcome、Core Message / Ask、
    Delivery Context、Artifact Afterlife、Reading Mode、Content Strategy、Design Style、
    AI Image Acquisition Path（无图=not applicable）、Generation Mode(continuous)、Spec Refinement、
    **Speaker Notes / Custom Animations / Narration Audio 三行**（值+来源：显式指令→Stage2 值→
    工作流默认 enabled/disabled/disabled；Audio enabled 会抬升 Notes 依赖，且写明 provenance）、
    Created Date。**模板场景**才在 §I 表后加一行 `- **Template Application**: …`；free design 省略。
  - **§II Canvas Specification**：Format/Dimensions/viewBox（`0 0 1280 720`）/Margins/Content Area。
  - **§III Visual Theme**：`### Theme Style`（Mode/Visual style/Theme/Tone）+ `### Color Scheme`
    （Role/HEX/Purpose：Background、Secondary background、Primary、Accent、Secondary accent、Body text）。
    有 ai 行才加 `### AI Image Strategy`——本场景不加。
  - **§IV Typography System**：`### Font Plan` 表（Role / Character(Reference) / Primary /
    English if non-English / Fallback tail）+ Title/Body stack 行；`### Font Size Hierarchy`
    （Purpose/Anchor Size：Body、Title、Subtitle、Annotation…）。
  - **§V Layout Principles**：Page Structure（Header/Content/Footer 规则）+ Spacing Specification
    （Safe margin/Content block gap/Icon-text gap）。
  - **§VI Icon Usage Specification**：Primary bundled library（chunk-filled/tabler-filled/
    tabler-outline/phosphor-duotone，或 none；简单图标仅作 brand 用途时另记）+ 用途表；仅 stroke 库
    加 Stroke Width。
  - **§VII Visualization Reference List**：仅当真实引用 chart/table 目录项才写（纯矢量无 → **省略整节**）。
  - **§VIII Image Resource List**：**总是保留表头**，无行也保留；行字段 Filename/Dimensions/Ratio/
    Purpose/Type/Layout pattern/Crop Policy(adaptive|no-crop)/Acquire Via(ai|web|user|placeholder|slice)/
    Status/Reference/text_policy/page_role。
  - **§IX Content Outline**：`### Part N:` 分区 + 每页 `#### Slide NN - <name>`；块含
    `Audience move`（必填）、Layout（描述关系/层次/区域，不写死 x/y/w/h）、Title、Core message、
    Content（完整页内文案层次）、可选 Mathematical content / Visualization / Images /
    Native shape suggestion / Motion suggestion（§IX 是页内容与语义权威，页序=§I 页数=执行队列）。
  - **§X Speaker Notes Requirements**：enabled 时写 Generation/Filename/Content/Total duration/
    Notes style/Presentation purpose；disabled 时只留 `- **Generation**: disabled` 一行。
- 命名/语言：标题与字段名保留英文；内容值可用用户语言。
- 条件行：`Template Application`、`AI Image Strategy`、§VII 只有真触发才写；不要空占位。

## 4.2 spec_lock.md（`{PROJECT_PATH}\spec_lock.md`，机器锚点）

- 首非空行固定：`<!-- ppt-master-schema: spec-lock/v1 -->`，`# Execution Lock`。
- **硬规则**：锁里只允许 `##` 章节 + `- key: value` 数据行（`## forbidden` 的列表项是字面规则）；
  不抄指南段落。
- 基础节（必写键）：
  | 节 | 键 | 备注 |
  |---|---|---|
  | canvas | viewBox、format | format=显示名（PPT 16:9）；viewBox=精确几何 |
  | communication | primary_language、audience、objective、core_message | 新锁 BCP-47，禁 `und`/无 script 的 zh |
  | mode | mode | preset 或 custom（custom 加 mode_behavior） |
  | visual_style | visual_style | 同上（custom 加 visual_style_behavior） |
  | colors | 稳定语义色 | 只放核心身份/常用角色；本场景无 image_rendering |
  | typography | font_family、body、title（+新锁 title_family/body_family 与各角色 `*_family`/字号锚点） | 字号=无单位 px 锚点；角色带 ±2px 执行带 |
  | icons | library、inventory | 无 bundled 选 none；stroke 库条件加 stroke_width |
  | page_rhythm | 每页一行 `P<NN>: anchor\|dense\|breathing` | 两位以上数字 |
  | pptx_structure | mode | **flat**（free design） |
  | forbidden | 固定黑名单列表 | mask/style/class/外 CSS/foreignObject/textPath/@font-face/animate*/script/iframe + HTML 实体禁令 |
- flat 专属：**省略** pptx_masters/pptx_layouts/page_pptx_layouts/page_layouts；不写 legacy page_charts；
  images 节（本场景无）、page_visualizations（无图表）也不写。
- 锁定规则（谁决定、谁能动）：
  - 锁是 `design_spec.md`+当前上下文的投影；**正常锁定不重开 result.json**；Gate 2 失败只重写失配锁行。
  - Executor 使用锁内锚点：色=语义角色、字号=锚点或 ±2px 带内值、字体按 `<role>_family` 链解析；
    页内装饰色/一次性投影可用上下文自取，无需加锁行；**不得为消 checker 对比而扩锁**。
  - 某个上下文色成为“常驻语义角色”，或未申报 display 尺寸第 3 次出现 → 回 Strategist 命名角色并
    重读/校验受影响的 plan 片段。
  - 结构性文本超出锚带 → 立即回上游；本场景无图片/图表/结构映射，锁的 images/page_visualizations
    相关规则不触发。
- 校验：`project_manager.py validate` 读 schema 报占位符/大小写/未知节/非法枚举/畸形页键/缺条件；
  结构有效 ≠ 语义保真（语义由 Gate1/Gate2 内部审计负责）。

---

# §5 导出与交付检查

- **输出命名**：`exports\<project_name>_<timestamp>.pptx`，其中 `<project_name>` = init 时的项目名
  （从目录名解析，剥掉 `_ppt169_YYYYMMDD` 后缀），`<timestamp>` = `%Y%m%d_%H%M%S`
  （例 `exports\demo_ppt169_20260101.pptx` → 产出 `demo_20260101_093000.pptx`）。
- **伴随报告**：`validation\<同名stem>.report.json`（schema `ppt-master.pptx-postflight-report.v1`，
  `status` ∈ passed / passed-with-warnings / failed；含 quality_gate、Slide 数、警告分类、deck_motion 交接
  字段）；启用 `--conversion-trace` 时另有 `<stem>.trace.json`。
- **通过标准**：
  1. `svg_to_pptx.py` 退出 0 + 两个产物存在 + `[POSTFLIGHT]` 回执显示 `status` 非 failed；
  2. 前置终检报告与当前 `svg_output/` 指纹匹配（缺失/陈旧/非 final/blocking → 非零退出并提示命令）；
  3. 独立审计 `pptx_delivery_check.py <pptx>` 退出 0（passed 或 passed-with-advisories；advisories
     记录不阻塞——字体可移植性、隐藏页、外链媒体等按事实披露）。
- **OPC/关系校验**：导出器发布前在临时包上做 read-back gate（部件名册/content-type/rels/超链接/
  Master-Layout 一致性等），实现位于 `pptx_opc_validation.py`（**模块**，被 svg_to_pptx builder 与
  pptx_delivery_check import，无独立 CLI）；生成流程无需单独“跑 OPC 脚本”。
- **发布规则**：release 导出只读 `svg_output/`（`-s final` 是诊断覆盖）；`svg_final/` 仅作自包含预览，
  可当 SVG 图片手动插入 PowerPoint，**不支持**手动 Convert-to-Shape 契约。
- **notes 开关**：default（非 quick）流程 notes 默认嵌入；Speaker Notes disabled 时必须显式
  `--no-notes`（防 notes/ 旧文件被嵌入）。
- **motion/transition**：无 animations.json 且未启用 Custom Animations 时保留导出默认
  （fade 翻页、逐元素 none），不必加参数；有 deck 级请求再按 `references/animations.md` 追加 flag。
- **audio=false**：不跑 generate-audio/notes_to_audio/sound_sync；导出命名不带 `_narrated` 后缀。

---

# §6 已知 Windows 注意事项

1. **python3 → python 映射**：引擎文档写 `python3 ...`；Windows 无 `python3` 命令时用
   `python`。本驱动统一用 venv 绝对解释器 `{VENV_PY}`（=settings.json `python` 键）。
   不要用系统其它 Python 跑引擎脚本。
2. **编码**：控制台/代码页可能非 UTF-8。官方脚本 import 时经 `console_encoding.configure_utf8_stdio()`
   自行把 stdout/stderr 重配为 UTF-8（errors=replace），并自动把命令包写入 `validation\workflow.log`；
   项目管理内嵌子进程还会注入 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8:replace`。保险做法是驱动进程
   也设置：
   ```powershell
   $env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8:replace'
   ```
   中文项目名/路径、含中文的源文件在 UTF-8 stdio 下正常；若出现乱码报错先查这两项，不要用 chcp 反复试。
3. **路径**：一律绝对路径；PowerShell 下路径含空格/中文时用单引号包裹并通过 `& ` 调用解释器：
   ```powershell
   & '{VENV_PY}' '{SKILL_DIR}\scripts\source_to_md.py' '...'
   ```
   不要在引擎目录树（`{SKILL_DIR}`）内建项目；项目统一放
   `{PROJECTS_BASE}`。项目目录名必须保持 `_<format>_<YYYYMMDD>` 后缀（校验器解析并要求日期后缀），
   不要手工改名/挪动。
4. **路径大小写与反斜杠**：脚本内部按 POSIX 化处理，Windows 反斜杠可照常；命令行传参用反斜杠
   绝对路径即可。不要把 `\` 写在双引号里丢给 bash 风格工具。
5. **不要修改引擎**：attribution/身份门对 SKILL.md frontmatter、LICENSE 摘要、SPONSORS 文件、
   指定脚本内的门调用做逐字节校验（换行归一化后哈希）。编辑任何引擎文件都会让 `attribution_guard`
   （及绝大多数脚本 import）退出 78——本文档只读引擎，驱动 agent 亦不得改引擎或“修门绕门”。
6. **后台/长驻进程**：live preview（svg_editor）在 DSH 里放后台 job 跑，勿等待退出、勿轮询；
   结束时按需 `job_kill`。`confirm_ui/server.py` 用 `--daemon`/`--shutdown` 生命周期管理。
7. **非零退出处理**：Windows 下进程被强杀会表现为 `[exit code: 1]`（无信号标记），把它当“中断”而非
   “命令失败”分析；attribution 失败码 78；其余引擎失败码多为 1。任何非零都先读 stderr 的
   `[ERROR]`/`error:` 行再决定修哪个属主工件。
8. **只在需要时读 JSON 报告**：win 终端可能截断长输出——截断时去读本次运行写下的报告 JSON 的
   指定字段，不要为“发现下一个问题”反复跑 checker。

---

# 附：关键不确定点清单（如实记录）

1. **确认门渠道**：引擎默认 Confirm UI 分支需要真人点页面；DSH 无人值守驱动时若会话未显式声明
   “chat 确认/委托”，Stage 1/2 确认门如何处理由上层会话策略决定。本文按 chat 分支/显式委托推荐，
   并把 UI 分支命令也写全（见 S3），但“谁的回复算确认”不由引擎定义。
2. **critic 层（S8/S10）**：`settings.json` 里 `critic.enabled/checklist/max_rounds` 是 DSH 上层
   配置；引擎本身没有 “SVG critic / PPTX critic” 阶段——本文把它们定义为引擎检查器之上的复核层，
   “four_dimensions” 具体检查项来自上层 prompt，本文只给出引擎侧可判定的重跑/判据命令。
3. **engine 内部顺序 vs 本文阶段标签**：终检（final SVG quality gate）在引擎里位于 notes 之前
   （Step 6 内），而用户给定的速查标签把 S8 SVG critic 放在 S7 notes 之后；本文已在 §1 显式声明
   硬性顺序（终检先于 notes；critic 改页后重检+重写 notes），执行时以引擎顺序为准。
4. **导出名称中的 project_name**：由目录名解析剥离 `_ppt169_<YYYYMMDD>` 得到；若 init 传的名字带
   连字符/下划线可能影响解析（如 `-` 结尾），实测以 `parse_project_name` 为准；建议 init 名字只用
   字母数字与下划线。
5. **spec_lock 颜色锚点漂移**：checker 对 spec_lock 之外的“额外颜色/字族”记 informational，
   只有“未申报 display 字号第 3 次出现/非法锚点值/结构性字号越带”等才 blocking（见 checker
   `_check_spec_lock_alignment` 注释语义）——若上层要求“只用锁内颜色”，那是额外纪律，非引擎强约束。
6. **attribution 门与本机安装**：引擎树含 `__pycache__` 且版本号 4.7.0、日期“Last updated 2026-07-11”
   表明是较新发行；若驱动中发现 guard 失败，首先怀疑是否有人改过引擎文件或换过发行，而不是修门。
7. **PPTX 之外的可见性**：`pptx_delivery_check` 的 advisory（字体可移植性、隐藏页、外链媒体）不影响
   退出码；是否“接受交付”取决于上层 critic 尺度，引擎侧只保证 failed=阻断。
8. **svg_to_pptx 前置 theme 契约**：flat release 导出要求锁里有 colors 与 typography
   （font_family/title_family/body_family 或兼容旧字段）以及 canvas.viewBox；若锁缺任一字段导出会
   非零拒绝——写锁时务必带全（见 §4.2）。
