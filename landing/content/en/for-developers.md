---
title: Tiza for developers · open source and self-hostable
description: Tiza is open source (AGPL-3.0), a modified version of openGym. Read the code, audit it, or run your own server.
nav_title: For developers
footer: tech
translation: /para-tecnicos/
cta: false
---

# For developers

Tiza is **open source**: a modified version of [openGym]({{upstream_url}}) by Duarte Santos, licensed under the AGPL-3.0. All the code that runs Tiza, including the service you use at {{domain}}, is published.

## What you can do with the code

- **Read and audit it**: what's stored, what's sent and where. [See the source code]({{source}}).
- **Run your own server**: two Docker containers and a data folder you own. The self-hosting guide is in the repository (docs/SELF_HOSTING.md).
- **Connect it to your tools**: there's a documented API and a read-only MCP server for AI assistants.

## How it's built

- A React and Vite frontend that works offline and installs as an app.
- A framework-free Node backend; data is JSON files with atomic writes.
- Sign-in with passkeys or a password.
- The progression engine is deterministic and covered by tests: the AI proposes the plan, but each day's weight is always worked out by that engine.

Rather have us run it for you? [Create your account](app) and you're done.
