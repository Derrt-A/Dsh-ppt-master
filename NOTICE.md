# Third-party notices

`dsh-ppt-gated` is an independent DeepSeek Harness host plugin. It does not bundle
the presentation engine it drives; the setup scripts download the engine from
its upstream repository at install time.

## ppt-master

- Project: **ppt-master**
- Author: Copyright (c) 2025-2026 Hugo He
- License: MIT
- Upstream: <https://github.com/hugohe3/ppt-master>
- Version used by this project: **v4.7.0** (pinned by `scripts/setup.ps1` and
  `scripts/setup.sh`; the plugin's tool surface was validated against it)
- Not affiliated with, sponsored by, or endorsed by the ppt-master author.

The engine ships its own `LICENSE`, `SPONSORS.md`, `SPONSORS_CN.md` and
`templates/**/THIRD_PARTY_NOTICES.md`. Its integrity gate
(`scripts/attribution_guard.py`) fails closed if those files are removed or
modified, so do not edit a downloaded engine tree. Redistribution of the engine
is governed by its own MIT license and third-party asset notices.

A verbatim copy of the upstream MIT license is kept at
[`docs/LICENSE.ppt-master`](docs/LICENSE.ppt-master) for the material in
`docs/driver.md`, which condenses the upstream documentation and is therefore a
derivative documentation work. The full engine source is **not** redistributed
by this repository.

## Trademarks and naming

“ppt-master”, “PPT Master” and the upstream project's visual identity belong to
their respective owner. They are used here only to describe the engine this
plugin drives (nominative use). The MIT license of the engine does not grant
trademark rights, and this repository does not claim any.

This project is unofficial. The repository name contains “ppt-master” only as a
description of the engine; it is not the official ppt-master distribution and
must not be presented as one. If you redistribute or rebrand this plugin, use a
distinctive name that cannot be confused with the upstream project.

## DeepSeek Harness

- Project: **DeepSeek Harness (DSH)**
- Package used at runtime: `@deepseek-ai/dsh-tools` (MIT)
- Upstream: <https://github.com/deepseek-ai/deepseek-harness>

`dsh-ppt-gated` imports `defineTool` from the host's own tool registry; it does not
vendor or redistribute DSH.
