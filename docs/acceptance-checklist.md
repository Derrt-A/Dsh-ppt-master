# dsh-ppt MVP pilot 验收记录（占位主题：无人机物流配送）

> 验收标准来自设计确认（Q12/Q17/Q23）。✅ 全部通过，MVP 验收完成。
> 本文件是 2026-09-05 在作者机器上的历史验收记录；路径已改写为数据区占位符。

## 项目信息
- slug: `drone_logistics_pilot`
- 源材料: `_pilot_sources/drone-logistics.md`（sources_only）
- 引擎: ppt-master v4.7.0，原地引用（未改动引擎任何文件）
- 数据区: `<数据根>`（默认 `$DSH_HOME/dsh-ppt`）
- 项目路径: `<数据根>/projects/drone_logistics_pilot_ppt169_20260905`
- 完成日期: 2026-09-05

## 验收五条

### ① 三门制：门1/门2/门3 均由用户实际放行
- [x] 门1（大纲 + design_spec 确认）：用户放行 —— ppt.json `gates.gate1=approved`
- [x] 门2（spec_lock 冻结确认）：用户放行 —— ppt.json `gates.gate2=approved`
- [x] 门3（成品交付确认）：用户放行 —— ppt.json `gates.gate3=approved`，phase=done

### ② S6 质量门 0 errors
- [x] first-page 首页门 0 errors（P01 后，修复 1 blocking bounds 溢出）
- [x] final 终检 0 errors（修复 display:56 未声明 → 补 spec/lock 角色；多次修订后复跑均 0 errors）

### ③ critic ≥1 轮执行且最终报告无 critical
- [x] SVG 层：r1 pass（0 critical，11 minor 非阻塞）→ 修订后 r2 fail（断行根因：引擎低估 YaHei 拉丁进深）→ r3 pass（0 critical，中文数词闭合）
- [x] PPTX 层：r1 fail（1 critical：P03 航距标签渲染断行孤字）→ 修订重导后 r2 pass（0 critical，实测 P03/P06 断行消除）
- [x] 无「轮次耗尽仍 critical 却静默交付」：fail 均真实返工，未超 2 轮上限即闭合

### ④ 交付检查 0 critical（OPC + delivery_check 双过）
- [x] 导出链 7.1 total_md_split / 7.2 finalize_svg / 7.3 svg_to_pptx 全 code 0（两版均通过）
- [x] postflight `status=passed-with-warnings quality_gate=passed slides=10`（0 error/0 blocking）
- [x] `pptx_delivery_check.py` 退出 0：errors=[]、advisories=[]（两版均验证）
- [x] 成品归档：`<数据根>/output/drone_logistics_pilot_20260905_080945.pptx`（52,984 B）

### ⑤ 视觉验收（三载体融合）
- [x] 载体 A：LibreOffice 无头渲染 PDF + 10 页 PNG（`output\gate3_v2\`），用户门3 验收通过
- [ ] 载体 B：svg_editor 预览 —— 未用（PPT 页数以渲染图验收，注明跳过）
- [ ] 载体 C：用户拷贝到有 PowerPoint/WPS 的机器终验 —— 用户自行决定（成品路径已提供）

## 附：resume 验证
- [x] `ppt_status` 多次断点读取（critic_svg/export/gate3 各阶段）均准确反映状态机

## 过程记录（供复盘）
- 工具链：dppt-2 动态插件 5 个 package（pkg-5 终版运行）；8 工具承载 10 阶段 + 三门制 + 双层 critic + resume
- 环境：Python 3.12.10（winget 用户级 + 写入用户 PATH）；dsh-ppt-data\.venv 装两套 requirements
- 驱动文档：`docs\driver.md`（子代理勘探引擎产出 607 行）；`docs\state-machine.md`（含实现期实测修正）；`docs\critic-pptx-prompt-template.md`
- S1→门1→门2 一次通过；S6 两轮质量门修复（bounds 溢出、display:56 未申报）；S7 notes 10/10；S8 svg critic r1 pass
- S9 导出 v1 → S10 pptx critic r1 fail（**真抓出缺陷**：P03 混排标签导出断行）→ 返工 2 轮：
  - 轮1 改单 run 文本 → svg r2 fail（揭示更深根因：引擎字符模型低估 YaHei 拉丁进深 1.07–1.13×，缩放无效）
  - 轮2 改 CJK 中文数词 + tspan 两行（引擎模型对 CJK 与实测一致）→ svg r3 pass、重导、pptx r2 pass
- 关键经验：critic 独立性有效（r1 抓出真缺陷）；引擎 Latin 宽字符（m/数字/符号）在 56px+ 单行场景必断行 → 用 CJK 表述规避（已记入 state-machine.md §5）
- 遗留：0 blocking；minor 均非阻塞（P10 注释对比度、页脚规范等记录于各 critic 报告，可选后续修订轮处理）
