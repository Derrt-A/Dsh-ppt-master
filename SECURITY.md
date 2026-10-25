# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Security → Report a
vulnerability** (Security Advisories) on this repository. Do not open a public
issue for an exploitable problem.

## Secrets

This repository never stores credentials. The plugin reads the engine path and
Python interpreter from `<dataRoot>/settings.json`; optional image/TTS backends
read their API keys from the engine's `.env` file. Both files are ignored by
Git:

```text
config.local.json
settings.json
.env
.env.local
.env.*.local
*.pem
*.key
```

If you paste a personal access token into an issue, chat, or commit, revoke it
immediately. A token used to publish this repository must be treated as
disposable and revoked after the push.

## Local execution model

The plugin executes Python scripts from the engine directory recorded in
`settings.json`. Treat that directory as trusted code: install the engine from
its official repository at the pinned tag, run `attribution_guard.py`, and do
not point `DSH_PPT_ENGINE` at an untrusted checkout.
