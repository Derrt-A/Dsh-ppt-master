# dsh-ppt-gated

> **非官方项目（Unofficial）**：本项目是独立的 DSH 社区插件，与 ppt-master 作者
> （Hugo He）及 DeepSeek 均无隶属、赞助或背书关系；“ppt-master”仅用于说明被驱动的引擎。

**DeepSeek Harness (DSH) 的持久化 PPT 生成插件**：把本地安装的开源引擎
[ppt-master](https://github.com/hugohe3/ppt-master) 封装成 8 个 `ppt_*` 模型工具，用一份
`ppt.json` 状态机把「摄源 → 大纲 → 冻结 → 逐页 SVG → 讲稿 → 双层 critic → 导出 → 交付验收」
串成一条带**三道人工门**、**可断点续跑**的流水线。

> 本项目只包含 DSH 侧插件、驱动文档和安装脚本；ppt-master 引擎在安装时从上游按版本拉取，
> 不随仓库分发。本项目与 ppt-master 作者无隶属关系，详见 [NOTICE.md](NOTICE.md)。

---

## 它解决什么问题

在 DSH 里直接让模型“写个 PPT”通常有三个问题：阶段之间没有硬门、进程重启后上下文丢失、
生成质量无人复核。`dsh-ppt-gated` 把流程固化成状态机：

```
ppt_new ──► spec_draft ──► [门1] ──► lock_draft ──► [门2] ──► author
                                                              │
        ┌─────────────────────────────────────────────────────┘
        ▼
   ppt_qa(first-page) ──► 逐页 SVG ──► ppt_qa(final) ──► notes
        │
        ▼
   critic_svg ──► export(7.1/7.2/7.3 + delivery_check) ──► critic_pptx ──► [门3] ──► done
```

- **三门制**：大纲确认（门1）、设计冻结（门2）、成品验收（门3）都必须由用户显式放行；
  工具不会替用户做决定，也不会跨门打包执行。
- **双层 critic**：SVG 层与 PPTX 层各自独立评审，报告必须真实落盘才允许登记 verdict；
  失败自动退回 `author`，超过 `critic.max_rounds` 则升级给用户仲裁，绝不静默交付。
- **持久化**：阶段、门、页清单、质量门结果、critic 轮次全部写在项目根 `ppt.json`，
  DSH 重启后用 `ppt_status` 即可续跑。
- **引擎只读**：所有 Python 调用都走数据区的 venv，引擎目录不被修改；首次建项目先跑
  `attribution_guard.py` 完整性门。

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| DeepSeek Harness | 带 `plugin` 命令与 Web profile（本仓库针对 `0.2.1-rc.2` 验证） | 宿主要能加载 Cordis host 插件 |
| Node.js | ≥ 22 | 插件运行时 |
| Python | ≥ 3.10（推荐 3.12） | 引擎与 venv |
| Git | 任意较新版本 | 安装脚本拉取引擎 |
| PowerPoint / WPS / LibreOffice | 可选 | 门3 的人工视觉验收 |

## 快速开始

### Windows（PowerShell 5.1+）

```powershell
git clone https://github.com/Derrt-A/dsh-ppt-gated.git C:\tools\dsh-ppt-gated
cd C:\tools\dsh-ppt-gated

# 1) 拉取并校验 ppt-master v4.7.0，创建 venv，写 settings.json
powershell -File scripts\setup.ps1

# 2) 挂到 DSH 的 web profile（link: 安装，改代码后重启即生效）
dsh plugin --profile web add link:C:\tools\dsh-ppt-gated

# 3) 重启 DSH Web，确认工具已注册
dsh web
```

### macOS / Linux

```bash
git clone https://github.com/Derrt-A/dsh-ppt-gated.git ~/tools/dsh-ppt-gated
cd ~/tools/dsh-ppt-gated

bash scripts/setup.sh
dsh plugin --profile web add link:$HOME/tools/dsh-ppt-gated
# 重启 dsh web
```

安装脚本做四件事：创建数据目录、`git clone --branch v4.7.0` 引擎、创建 venv 并安装
`requirements.txt`、运行 `attribution_guard.py` 后写入 `settings.json` 与
`config.local.json`。常用参数：

```powershell
powershell -File scripts\setup.ps1 -DataRoot D:\ppt-data      # 自定义数据区
powershell -File scripts\setup.ps1 -EnginePath C:\my\engine   # 复用已有引擎（跳过 clone）
powershell -File scripts\setup.ps1 -Python C:\py\python.exe   # 复用已有解释器（跳过 venv）
powershell -File scripts\setup.ps1 -SkipDeps                  # 只建 venv，不装 Python 依赖
```

> **包名提示**：npm 上另有一个独立项目叫 `dsh-ppt`。本项目的包名是
> `@derrt-a/dsh-ppt-gated`，未发布到 npm；请按上面的 `link:` 方式安装本仓库，
> 不要执行 `dsh plugin add dsh-ppt`（那会装到另一个项目）。

## 配置

数据根目录优先级：`DSH_PPT_DATA` 环境变量 → 包根 `config.local.json` 的 `dataRoot` →
`$DSH_HOME/dsh-ppt`（目录名保留 `dsh-ppt` 以兼容既有数据；`DSH_HOME` 默认 `~/.dsh`）。

| 变量 | 作用 |
|---|---|
| `DSH_PPT_DATA` | 覆盖数据根目录（settings、projects、导出物） |
| `DSH_PPT_ENGINE` | 覆盖引擎根目录（含 `SKILL.md`、`scripts/`、`templates/`） |
| `DSH_PPT_PYTHON` | 覆盖 Python 解释器（通常是数据区 venv） |
| `DSH_HOME` | DSH 主目录；未设 `DSH_PPT_DATA` 时决定默认数据根 |

`settings.json`（由安装脚本生成，可手工调整）：

```json
{
  "input_mode": "sources_only",
  "language": "zh",
  "canvas": "16:9",
  "image_backend": "none",
  "audio": false,
  "critic": { "enabled": true, "target": "both", "max_rounds": 2, "checklist": "four_dimensions" },
  "engine_root": "<dataRoot>\\engine\\ppt-master\\skills\\ppt-master",
  "python": "<dataRoot>\\.venv\\Scripts\\python.exe"
}
```

其中 `<dataRoot>` 默认为 `%DSH_HOME%\\dsh-ppt`；安装脚本会把实际绝对路径写入该文件。
Windows 的 venv 解释器在 `Scripts\\`，macOS/Linux 在 `bin/`。

数据区布局：

```
<dataRoot>/
├── settings.json          # 引擎/解释器/语言/critic 轮次
├── projects.json          # slug → 项目路径索引
├── projects/
│   └── <slug>_ppt169_YYYYMMDD/   # ppt.json、design_spec.md、spec_lock.md、
│                                 # svg_output/、notes/、validation/、exports/
├── output/                # 人工归档的成品
├── engine/ppt-master/     # setup 克隆的上游仓库（可删，settings 指回即可）
└── .venv/                 # 引擎 Python 依赖
```

## 八个工具

| 工具 | 阶段 | 作用 |
|---|---|---|
| `ppt_new` | S1 | 完整性门 → `project_manager.py init` → `import-sources`，建状态机 |
| `ppt_spec` | S3 / 门1 | 校验 `design_spec.md`（schema marker + I–X 节）→ 提交/放行/驳回门1 |
| `ppt_lock` | S4 / 门2 | 校验 `spec_lock.md` + `project_manager validate` → 冻结/放行/驳回门2 |
| `ppt_qa` | S6 | `svg_quality_checker.py`：首页门（P01 后）与终检（全部页后），0 error 才记 pass |
| `ppt_author` | S6/S7 | 登记页文件 → `pages_done`（要求终检 pass）→ `notes_done` |
| `ppt_critic` | S8/S10 | 登记 SVG/PPTX 层 critic 报告轮次与 verdict；fail 未超限退回 author |
| `ppt_export` | S9 / 门3 | 7.1 拆讲稿 → 7.2 finalize → 7.3 svg_to_pptx → delivery_check；放行/驳回门3 |
| `ppt_status` | — | 只读状态机（phase/gates/qa/critic/exports + 下一步提示），resume 入口 |

模型只负责写 `design_spec.md`、`spec_lock.md`、逐页 `svg_output/NN_name.svg` 与
`notes/total.md`；工具负责校验、跑引擎脚本、推进状态机和守住三道门。详细执行手册见
[docs/driver.md](docs/driver.md)，状态机 schema 见 [docs/state-machine.md](docs/state-machine.md)。

## 仓库结构

```
dsh-ppt-gated/
├── lib/index.js              # 唯一运行时文件：8 个工具 + 状态机
├── cordis.patch.yml          # DSH bundle 挂载点
├── docs/
│   ├── driver.md             # 十阶段驱动手册（给 agent 照做）
│   ├── state-machine.md      # phase/gates/ppt.json schema 与实测修正
│   ├── acceptance-checklist.md
│   └── critic-pptx-prompt-template.md
├── scripts/
│   ├── setup.ps1             # Windows 安装器
│   └── setup.sh              # macOS/Linux 安装器
├── test/                     # node:test，离线可跑
├── .github/workflows/ci.yml
├── LICENSE                   # MIT（本项目）
└── NOTICE.md                 # ppt-master / DSH 第三方声明
```

## 开发与测试

```bash
npm install          # 只为测试安装 @deepseek-ai/dsh-tools
npm test             # 离线：模块解析 + 8 工具注册 + schema 编译 + 状态机迁移
npm run test:smoke   # 只跑最小冒烟
```

测试不依赖引擎与 Python：`test/smoke.test.mjs` 用宿主自己的 `defineTool` 编译所有参数
schema；`test/state.test.mjs` 在临时数据区里验证 `ppt_status`、门1/门2 的放行与非法迁移；
`test/config.test.mjs` 验证 `DSH_PPT_DATA` 优先级、缺失 `settings.json` 的诊断和空数据区。

## 已知限制

- **Windows 优先验证**：路径处理已改为 `node:path`，但引擎脚本与 LibreOffice 渲染流程只在
  Windows 上实测过。
- **引擎版本锁定 v4.7.0**：工具按该版本的脚本 CLI 编写；升级引擎前请先跑
  `attribution_guard.py` 与一次小项目回归。
- **不是独立应用**：必须在 DSH 宿主内运行；仓库不包含 Web UI。
- **视觉终验仍需人工**：CI 只跑离线逻辑测试，PPTX 的实际渲染验收需要 PowerPoint/WPS/
  LibreOffice。
- **默认关闭图片与音频后端**：`image_backend=none`、`audio=false`；需要时在
  `settings.json` 中开启并配置对应 API key（引擎自带 `.env.example`）。

## 相关项目与差异

这个方向已有多个公开项目，形态并不相同；本项目与它们没有代码或授权关系：

| 项目 | 形态 | 与本案的关系 |
|---|---|---|
| [ppt-master](https://github.com/hugohe3/ppt-master) | 上游 AI 演示文稿引擎（MIT） | 本插件驱动的引擎，安装时按版本拉取，不随仓库分发 |
| [pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master) | 把 ppt-master 打包成 DSH skill provider（MIT） | 同赛道先例；本项目是 8 工具状态机，不是 skill 包装 |
| [SAXEM1997/dsh-ppt-master-wrapper](https://github.com/SAXEM1997/dsh-ppt-master-wrapper) | 逐字节 vendor 上游 + 3 个生命周期工具（MIT） | 采用“不 vendor、按版本下载”的相反取舍 |
| [STARDUSTLC666/dsh-ppt](https://github.com/STARDUSTLC666/dsh-ppt) | npm 上的完整 DSH 演示插件（MIT） | 独立引擎，生成 HTML/PPTX 工程；本项目的引擎是 ppt-master |
| [OMSociety/dsh-ppt-maker](https://github.com/OMSociety/dsh-ppt-maker) | 11 个 `ppt_*` 工具的 DSH 插件（MIT） | 纯 TS 引擎；本项目用 Python 引擎 + 三门制状态机 |
| [Presenton](https://github.com/presenton/presenton) / [PPTist](https://github.com/pipipi-pikachu/PPTist) | 开源 AI PPT 应用（Apache-2.0 / AGPL-3.0） | 相邻品类；本项目未使用其代码 |
| [Slidev](https://github.com/slidevjs/slidev) / [Marp](https://github.com/marp-team/marp) | Markdown 演示工具（MIT） | 面向开发者写幻灯片，不是 PPTX 状态机 |
| [python-pptx](https://github.com/scanny/python-pptx) / [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | PPTX 生成库（MIT） | 上游引擎的底层依赖类别 |

本项目的差异点：**持久化 8 工具状态机 + 三道人工门 + 双层 critic + 不 vendor 引擎 +
可离线测试**；价值在编排与质量门，而不是重写 SVG→DrawingML 转换器。

## 许可与第三方

本项目代码以 **MIT** 许可发布，见 [LICENSE](LICENSE)。它驱动的 ppt-master 引擎是
Copyright (c) 2025-2026 Hugo He 的 MIT 项目，安装时从
<https://github.com/hugohe3/ppt-master> 拉取，本仓库不分发其代码或模板资源；上游 MIT
全文另存于 [docs/LICENSE.ppt-master](docs/LICENSE.ppt-master)（`docs/driver.md` 是其文档的
衍生整理）。第三方声明、商标与“无隶属关系”说明见 [NOTICE.md](NOTICE.md)。
