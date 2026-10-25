# SAT / PSAT end-to-end checks

Start the local backend and Vite frontend, install the Playwright Chromium browser once with `npx playwright install chromium`, then run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:sat
```

Set `E2E_BASE_URL` when the frontend is not at `http://localhost:5175`; set `E2E_CHROMIUM_PATH` to use a locally installed Chrome executable. The test creates a temporary student, class, and SAT/PSAT formal exam releases, then removes them during cleanup. It checks the PSAT label and scoring identity, SAT/PSAT class trend aggregation and tooltip behavior, and mobile empty states for student scores and class trends. Do not point it at production data.

To verify the shared account management workflow, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:sat:accounts
```

This test creates and removes a temporary account. It covers editable default credentials, optional contact details, role changes, password reset and login, account status, search/filtering, and the five-second permanent-delete confirmation. Do not point it at production data.
