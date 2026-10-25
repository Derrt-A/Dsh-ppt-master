# Changelog

All notable changes to this project are documented here.

## [0.1.0] - 2026-10-25

First public repository release.

### Added

- Eight `ppt_*` host tools (`ppt_new`, `ppt_spec`, `ppt_lock`, `ppt_qa`,
  `ppt_author`, `ppt_critic`, `ppt_export`, `ppt_status`) with a persisted
  `ppt.json` state machine, three user gates, dual-layer critic and resume.
- Portable configuration: `DSH_PPT_DATA`, `DSH_PPT_ENGINE`, `DSH_PPT_PYTHON`,
  `config.local.json`, and `node:path` throughout (no hard-coded Windows root).
- `scripts/setup.ps1` and `scripts/setup.sh` to install ppt-master v4.7.0,
  create the venv, run the engine integrity gate and write `settings.json`.
- Offline test suite covering tool registration, schema compilation, gate
  transitions, critic escalation and configuration diagnostics.
- GitHub Actions CI (Windows/Linux, Node 22/24).
- `docs/driver.md`, `docs/state-machine.md`, `docs/acceptance-checklist.md`,
  `docs/critic-pptx-prompt-template.md`.

### Changed

- `ppt_export` no longer has the dead `notesEnabled` branch; the export chain is
  always 7.1 → 7.2 → 7.3 → delivery check.
- Error tails now use real newlines instead of a literal `\n` sequence.

### Security

- No credentials are stored in the repository; `config.local.json` is ignored.
- The engine is downloaded at install time from its upstream MIT repository and
  verified with its own `attribution_guard.py`.
