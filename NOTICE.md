# Third-party notices

`dsh-ppt` is an independent DeepSeek Harness host plugin. It does not bundle
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

## DeepSeek Harness

- Project: **DeepSeek Harness (DSH)**
- Package used at runtime: `@deepseek-ai/dsh-tools` (MIT)
- Upstream: <https://github.com/deepseek-ai/deepseek-harness>

`dsh-ppt` imports `defineTool` from the host's own tool registry; it does not
vendor or redistribute DSH.
