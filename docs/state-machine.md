# dsh-ppt 状态机与 ppt.json schema

> 实现文件：`lib/index.js`。所有迁移都是显式的；非法迁移返回 `{ ok: false, error }`，不会静默改状态。

## 1. 阶段枚举（phase）

工具只推进合法迁移，非法迁移直接报错。`phase` 取值：

| phase | 含义 | 进入工具 | 门 |
|---|---|---|---|
| `spec_draft` | S3 大纲 + design_spec 草稿（`ppt_new` 建项目后即处于此阶段） | `ppt_new` / `ppt_spec`(reject) | — |
| `gate1` | ⛔ 门1：大纲 + spec 确认 | `ppt_spec`(submit) | 用户 |
| `lock_draft` | S4 spec_lock 生成中 | `ppt_spec`(approve) | — |
| `gate2` | ⛔ 门2：冻结确认 | `ppt_lock`(submit) | 用户 |
| `author` | S6 逐页 SVG 创作 + 页级质量门 | `ppt_lock`(approve) / `ppt_critic`(fail) | — |
| `notes` | S7 演讲备注 | `ppt_author`(pages_done) | — |
| `critic_svg` | S8 SVG 层 critic（子代理） | `ppt_author`(notes_done) | — |
| `export` | S9 导出（7.1/7.2/7.3 + delivery_check） | `ppt_critic`(svg pass/override) | — |
| `critic_pptx` | S10 PPTX 层 critic（子代理） | `ppt_export`(export) | — |
| `gate3` | ⛔ 门3 最终验收 | `ppt_critic`(pptx pass/override) | 用户 |
| `done` | 完成 | `ppt_export`(approve) | — |

critic fail 的去向：`critic_svg` / `critic_pptx` fail → `author`（修 SVG 后重跑
`ppt_qa final`、必要时重写 notes）；轮次达到 `critic.max_rounds`（默认 2）仍 fail 时，
工具返回 `escalated: true`，状态停在当前阶段，由用户决定继续修订或 `verdict=override`
放行——不会静默交付。

## 2. ppt.json（项目根，随阶段更新）

```jsonc
{
  "schema": 1,
  "slug": "yuedong_qingchun",
  "title": "跃动青春，健康同行",
  "phase": "author",           // 上表枚举
  "canvas": "ppt169",
  "language": "zh",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "resume_note": "断点说明（agent 续跑提示）",
  "gates": { "gate1": "approved", "gate2": "pending", "gate3": "pending" },
  "pages": [                   // ppt_author action=page 逐页登记
    { "file": "01_cover.svg", "at": "ISO8601" }
  ],
  "qa": {                      // 每个质量门最近一次结果
    "first-page": { "pass": true, "at": "ISO8601", "report": ".../validation/svg_quality_first_page_report.json" },
    "final":      { "pass": false, "at": "ISO8601", "report": ".../validation/svg_quality_report.json" }
  },
  "critic": {
    "svg":  { "rounds": 1, "last_report": ".../validation/critic_svg_r1.md", "verdict": "pass" },
    "pptx": { "rounds": 0, "last_report": null, "verdict": null }
  },
  "exports": [
    { "pptx": ".../exports/xxx.pptx", "report": ".../validation/xxx.report.json", "at": "ISO8601", "delivery": "passed" }
  ]
}
```

## 3. 工具族契约（8 个）

| 工具 | 关键参数 | 迁移 | 作用 |
|---|---|---|---|
| `ppt_new` | slug, title, sources[], canvas? | → spec_draft | attribution_guard → `project_manager init` → `import-sources`，写索引与状态机 |
| `ppt_spec` | action: submit\|approve\|reject | spec_draft→gate1→lock_draft/spec_draft | submit 校验 design_spec（marker + I–X，§VII 可选）与 engine validate；approve/reject 记录门1 |
| `ppt_lock` | action: submit\|approve\|reject | lock_draft→gate2→author/lock_draft | 校验 spec_lock + `project_manager validate`；approve/reject 记录门2 |
| `ppt_author` | action: page\|pages_done\|notes_done, page? | author→notes→critic_svg | 登记 `svg_output/NN_name.svg`；pages_done 要求 `qa.final.pass`；notes_done 要求 `notes/total.md` |
| `ppt_qa` | stage: first-page\|final | author 及之后可重复 | 封装 `svg_quality_checker.py`，0 error 才记 pass |
| `ppt_critic` | layer: svg\|pptx, round, verdict: pass\|fail\|override | critic_svg/pptx → export/gate3/author | 校验报告已落盘后记录轮次与裁决；fail 超限返回 escalated |
| `ppt_export` | action: export\|approve\|reject | export→critic_pptx→gate3/done | 串行跑 7.1/7.2/7.3 + delivery_check；approve/reject 记录门3 |
| `ppt_status` | slug? | 只读 | 读 projects.json/ppt.json，输出阶段、门、QA、critic、exports 与下一步 |

## 4. 硬约束

- attribution_guard：`ppt_new` 在 init 前先跑；引擎脚本自身也内置 `require_skill_integrity`（双重保险）。
- 质量门 0 errors 是 `pages_done` / critic / export 的前置。
- critic 报告必须真实落盘（`validation/critic_<layer>_r<round>.md`）才可记录 verdict。
- 所有脚本经 `settings.json` 的 `python`（venv）调用；子进程注入 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8:replace`。
- `ppt.json` / `projects.json` 的写入使用调用会话的 standing sandbox 策略，与内置 `write` 工具同源。

## 5. 实现期实测修正（2026-09-05 pilot 记录）

1. `project_manager.py validate` 需要 design_spec + spec_lock **同时存在**才全绿：spec submit 阶段 validate 报的"missing spec_lock.md"类错误应容忍（ppt_spec 已实现该宽容）。
2. spec_lock `## icons` 必须含 `inventory` 键（填 `none`）。
3. 字号纪律是 **deck 级**计数：未申报字号（如 display 56）全 deck 超过 2 次即 blocking，报在每一相关页上 —— 修法是回 spec+lock 声明角色（design_spec §IV Font Size Hierarchy 加行 + spec_lock typography 加锚点），不是逐页改字号。
4. SVG 顶层：所有页面装饰（整幅竖条/时间线等）必须是 root primitive 并带 `data-pptx-role="background"|"decoration"`，否则 advisory（不 blocking）。
5. `data-pptx-bounds` 容器越界是 blocking 级错误（文本溢出组容器垂直 >0% 即 error）；容器要按字形实际范围放足余量。
6. notes/total.md 格式：`# <NN>_<name>` 每页一节 + `---` 分隔；`total_md_split.py` 严格按 SVG 文件一对一拆分（dry-run 10/10 通过）。
7. 引擎硬顺序（driver.md §1）：P01 首页门通过后才能画 P02；全部页画完立刻跑 final 终检（先于写 notes）；critic 改页必须重跑终检并同步重写 notes。
8. 质量报告只读所需字段：blocking=1 时看 `categories.blocking.issues[].message`（含具体坐标与容器）；advisory 不阻塞不强制改。
