# Submerge agent guidance

## UI verification

- Playwright is configured for UI testing in this repository. For UI changes, add or update the relevant test under `tests/e2e` when practical and run `npm run test:ui` before completing the task.
- Use Playwright to launch and interact with the real Electron application when the behavior depends on Electron APIs. Use its managed Chromium runtime for standalone local web routes.
- Inspect generated screenshots and traces when diagnosing failures or visually verifying a change. Playwright artifacts are written to `test-results/playwright` and `playwright-report`; these directories are disposable and ignored by Git.
- Preserve the test harness's isolated application-data configuration. Never point automated tests at normal Submerge user data.
- Never hardcode or commit login credentials. Authenticated UI tests must use locally supplied environment variables and a staging or otherwise explicitly isolated account.
