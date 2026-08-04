# Playwright UI tests

Submerge uses Playwright to exercise the real Electron application from an isolated test environment. The tests build the renderer first and redirect Electron application data away from normal Submerge data.

## Initial setup

Dependencies are installed through the normal project install. Install Playwright's managed Chromium runtime once per development machine:

```powershell
npm install
npm run test:ui:install
```

Electron tests use Submerge's installed Electron runtime. Chromium is available for future tests of standalone local web routes.

## Run the tests

From the repository root:

```powershell
npm run test:ui
```

To watch the application while a test runs:

```powershell
npm run test:ui:headed
```

To use Playwright's interactive test runner:

```powershell
npm run test:ui:open
```

The same test command is available in VS Code as **Tasks: Run Test Task** > **Test UI - Playwright**. With the Playwright Test extension installed, tests under `tests/e2e` also appear in VS Code's Testing view.

## Artifacts

Failures produce an HTML report and Playwright artifacts under `playwright-report` and `test-results`. These directories are intentionally ignored by Git. The Electron smoke test attaches a full-window screenshot and an interaction trace that Codex can inspect when diagnosing a failure.

## Safety

Electron launches with a dedicated `SUBMERGE_DATA_PARTITION` and disposable `APPDATA`/`LOCALAPPDATA` directories. Tests must not remove this isolation or use production credentials for mutations.
