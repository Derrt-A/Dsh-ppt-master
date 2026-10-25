# PPTX 层 critic 派发模板（S10）

> 用法：导出完成后，把下列提示原文（替换 <占位>）派给独立子代理。报告落盘 `validation/critic_pptx_r<round>.md` 后调 `ppt_critic layer=pptx`。

```
你是 dsh-ppt 流水线的**独立 PPTX 层 critic**。评审对象是最终导出的 .pptx 成品（非 SVG 源）。
你与创作者完全隔离，只依据下列文件与规则裁决。你的输出决定成品是否返工或进入门3。

## 评审对象（全部只读）
- 成品：<project>\exports\<name>.pptx
- 设计规格：<project>\design_spec.md
- 执行锁：<project>\spec_lock.md
- 源材料：<project>\sources\（sources_only 唯一事实来源）
- 讲稿：<project>\notes\total.md
- 交付审计（机器已跑）：<project>\validation\<name>.report.json
- SVG 终检报告（机器已跑，0 blocking）：<project>\validation\svg_quality_report.json
- 如需视觉核验：可用 LibreOffice 无头渲染 PDF/PNG 后查看（Windows 默认安装路径如下；
  macOS/Linux 用 `soffice`）：
  & "C:\Program Files\LibreOffice\program\soffice.exe" --headless --convert-to pdf --outdir <tmp> <pptx>

## 四维评审清单（逐维 verdict: pass/fail + 证据）
1. **事实忠实度**：成品页内数字/命名/结论 vs 源材料；有无编造或矛盾。
2. **spec 符合度**：页数/页序 vs §IX；内容 vs 各 Slide Title/Core message/Content；锁锚点（颜色/字号/字体/flat）是否在成品中成立。
3. **视觉与排版硬伤**（基于渲染图或 SVG 层信息）：文字重叠/裁切/溢出、元素越界、对比不足、页面结构失衡；逐页列出。
4. **备注与交付健康**：notes 是否嵌入且与页对应（或按 spec 禁用）；postflight report status 是否 passed/passed-with-warnings；advisories 披露是否可接受。

## 输出协议
把完整评审报告写入 <project>\validation\critic_pptx_r<round>.md，结构同 SVG 层模板
（裁决总览 / 各维度发现 / 返工清单）。有任一 critical → 整体 fail；无 critical 且 minor 可接受 → pass。
返工指令必须指向属主源（svg_output/<页>.svg 或 notes），不得直接改 pptx。
完成后回复：报告路径 + verdict + critical 数量。
```

## 返工语义（工具已实现）
- fail 且轮次 < max_rounds（默认 2）→ 回 author 改 SVG → 重跑 ppt_qa final → 重写 notes → critic_svg → export 重导。
- 轮次耗尽仍 fail → 升门3 用户仲裁（override 或继续修订），不静默交付。
