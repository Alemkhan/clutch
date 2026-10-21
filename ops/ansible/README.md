# Clutch production release

This playbook deploys the current clean `main` commit from a Linux or WSL control host. Native
Windows Ansible is unsupported. Run it from the repository root, with Node matching `.nvmrc`,
npm dependencies installed, Ansible, and Wrangler's existing Cloudflare authentication:

```sh
ANSIBLE_CONFIG=ops/ansible/ansible.cfg \
ansible-playbook -i ops/ansible/inventory.ini ops/ansible/release.yml \
  -e release_confirm_production=true -e release_confirm_ci=true
```

`release_confirm_production=true` is mandatory. The playbook checks that tracked files and the
index are clean, the branch is `main`, refreshes `origin/main`, and requires `HEAD` to match
it. Untracked files are allowed. `release_confirm_ci=true` is a separate manual
acknowledgement that GitHub Actions passed for that exact commit; the playbook does not query
GitHub.
It reads the allowlisted public settings from root `release.env`; values are never printed by
the loader task. Secret values are not supported by this file loader or managed by Ansible.
Set up `TELEGRAM_BOT_TOKEN` and `SESSION_SIGNING_SECRET` separately with Wrangler before the
first Worker deploy.

The playbook runs `npm test`, `npm run content:check`, local smoke, production preflight,
regenerates the ignored Worker config, lists remote D1 migrations, deploys Worker, waits for
health and readiness, builds the web app with production Vite variables and an empty env
directory, publishes Pages using Direct Upload, and runs remote read-only smoke.

By default, migration application is disabled. If Wrangler does not report `No migrations to
apply`, the playbook stops before deployment. To explicitly apply the pending migrations, use:

```sh
ANSIBLE_CONFIG=ops/ansible/ansible.cfg \
ansible-playbook -i ops/ansible/inventory.ini ops/ansible/release.yml \
  -e release_confirm_production=true -e release_confirm_ci=true \
  -e release_apply_migrations=true
```

Set `-e release_npm_ci=true` to run `npm ci` before checks. Every invocation writes a local
ignored report to `ops/ansible/evidence/`; the report does not update `docs/RELEASE.md`.

Automation stops after remote smoke. Complete these release gates manually:

- Confirm GitHub Actions CI passed on the released commit.
- Verify BotFather's Menu Button/Main Mini App points to production Pages and the production
  bot has the expected token.
- Walk through the release on a real phone in Telegram using `docs/TESTING.md`.
- Record the actual Worker deployment/version ID and Pages URL in `docs/RELEASE.md` evidence;
  inspect logs/metrics during the initial release window.

Do not use this playbook to set secrets or roll back. Database rollback is not automated.
