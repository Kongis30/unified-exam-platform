# SAT / PSAT end-to-end checks

Start the local backend and Vite frontend, install the Playwright Chromium browser once with `npx playwright install chromium`, then run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:sat
```

Set `E2E_BASE_URL` when the frontend is not at `http://localhost:5175`; set `E2E_CHROMIUM_PATH` to use a locally installed Chrome executable. The test creates a temporary student and two formal exam releases, then deletes them during cleanup. Do not point it at production data.
