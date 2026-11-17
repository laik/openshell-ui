# Contributing

Thanks for considering a contribution! This file covers the local setup, the
checks we expect to pass, and the conventions the codebase follows.

## Setup

```bash
git clone https://github.com/laik/openshell-ui.git
cd openshell-ui
npm install
npm run dev          # bridge :8787 + Vite :5273 (local mode)
```

Requirements: Node.js ≥ 22.6 (the bridge runs TypeScript natively), and an
`openshell` CLI on `PATH` with a reachable gateway for anything beyond UI work.
For the OIDC path, bring up the IAM lab (Keycloak + OpenLDAP) — see
[docs/DEMO.md](docs/DEMO.md).

## Checks before opening a PR

```bash
npm run typecheck    # tsc --noEmit, strict
npm run build        # tsc -b && vite build
npm run test:sweep   # functional regression against a LIVE bridge + gateway
```

`scripts/sweep.mjs` exercises every bridge route and the terminal WebSocket
against a real gateway. It creates and deletes a disposable sandbox named
`ui-sweep`; point it elsewhere with `SWEEP_BRIDGE` / `SWEEP_GATEWAY`. Do not run
it against a gateway whose sandboxes you cannot afford to churn.

CI (`.github/workflows/ci.yml`) runs typecheck + build on Node 22 and 24.

## Conventions

- **Bridge (`server/`)**: plain Node, no build step. Every CLI invocation goes
  through `runCli`/`runJson` in `cli.ts`; never spawn `openshell` ad hoc. User
  input that becomes a CLI argument must pass the existing validators
  (`safeName`, `policyToken`, `endpointSpec`, …) — values may not look like
  flags or contain whitespace/shell metacharacters.
- **Routes**: register specific paths *before* generic `:param` routes (the
  router matches in order; `settings` once got swallowed by `:action`).
- **CLI quirks are documented in code**: e.g. `template create` prints text even
  with `-o json`; `policy update` forbids `--add-endpoint` together with
  `--add-allow` (the bridge splits it into two sequential updates); `--dry-run`
  and `--wait` are mutually exclusive.
- **Frontend (`src/`)**: React 19 + MUI v9. Shared surfaces live in
  `components/ui.tsx` (`Panel`, `SectionLabel`, `PageHeader`, `CodeBlock`, …);
  use them instead of new one-off styles. Typography and colors come from
  `theme.ts` tokens — no hardcoded hex in pages. Monospace (`MONO`) is for
  identifiers/commands only; prose uses the sans stack.
- **Forms**: align with the 12-column `Grid`, `fullWidth` fields inside cells;
  show the exact `openshell` command a dialog will run, pinned at its bottom.
- **Errors**: operator-facing failures surface as toasts outside dialogs;
  dry-run previews and command output stay inside.
- **Auth**: keep both modes working. `local` must stay login-free; `oidc` guards
  every API route and the terminal socket, with admin-only mutations listed in
  `server/auth.ts#isAdminOnly`. Add new mutating routes to that list when they
  are destructive.

## Commit / PR style

- Small, focused commits; imperative subject ("fix policy route ordering").
- PRs: what changed, why, and how you verified (sweep output or screenshots).
- Screenshots for UI changes go in `docs/screenshots/` and are referenced from
  the README or docs/DEMO.md.

## License

By contributing you agree your contributions are licensed under the MIT
license (see [LICENSE](LICENSE)).
