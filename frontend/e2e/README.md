# SAT / PSAT end-to-end checks

For workspace navigation and cache regression checks, start the Vite development server and run:

```sh
node e2e/workspace-navigation-performance.cjs
node e2e/workspace-cache-view.cjs
node e2e/workspace-cache-safety.cjs
node e2e/workspace-cross-tab-session.cjs
```

These checks mock API responses and cover request reuse, targeted invalidation, expiry, refresh, scroll restoration and session isolation; they do not modify the database. Set `E2E_BASE_URL` if Vite is not running on port 5175.

For class details, student history and report loading, run:

```sh
node e2e/class-detail-lazy-loading.cjs
node e2e/student-detail-cache.cjs
node e2e/detail-request-races.cjs
node e2e/sat-report-loading.cjs
node e2e/shsat-report-loading.cjs
node e2e/shsat-attempt-materials.cjs
```

These mocked browser checks cover lazy loading and retries, class isolation, cache invalidation, late responses, report visibility, role-specific access and SHSAT attempt material formats.

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

To verify SHSAT Paper Management folder, Online/Offline, and combined name filters, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:paper-filters
```

This test uses the seeded `SHSAT CRASH COURSE` paper group and does not modify data.

To verify SHSAT student upcoming/available states and audience isolation, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:student-states
```

This test creates two temporary students and two SHSAT exam releases targeted only to one student. It checks the Upcoming card has no start action, the Available card can be started, the other student cannot see either release, and the student page fits a 390px viewport. It deletes the temporary releases and accounts during cleanup. Do not point it at production data.

To verify the SHSAT Unassigned Students bulk assignment flow, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:unassigned-bulk
```

This test creates temporary students and a class, verifies select-all, selection retention after refresh/cancel, batch assignment, the 800px scroll cap and 390px layout, then removes and verifies cleanup of all temporary data. Do not point it at production data.

To verify SHSAT exam eligibility when a targeted class changes membership, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:class-exam-eligibility
```

This test checks eligibility for existing and late-joining class members, confirms leaving the class does not revoke an already granted place, and starts the exam as that student. It saves desktop/390px student-workspace and exam screenshots, then removes the temporary release, class, students, and attempts. Do not point it at production data.

To verify SHSAT class-card ordering, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:class-order
```

This test moves temporary classes in the browser, checks the saved order after reload, restores the original order, and verifies no temporary classes remain. It saves desktop and 390px screenshots. Do not point it at production data.

To verify imported SHSAT paper scoring from the real student interface, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:imported-paper-full-exam
```

By default, this test publishes a temporary release from imported paper 244, answers all 100 questions through the student UI, verifies the answer types and raw/scaled report totals, and checks the full report PDF. Set `E2E_IMPORTED_PAPER_ID=248` to also run the flow against the authentic imported Graph Question in paper 248; because that source paper is a draft, the test creates and seals a temporary version, then deletes the cloned paper with the exam, class, and student. It saves report, PDF, and question screenshots under `/tmp`. Do not point it at production data.

To verify SHSAT monitor counters when one student has repeat attempts, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:monitor-retry-counters
```

This test submits two attempts from one student, starts a third, and checks that attempt counts and distinct-student counters match the independent SHSAT monitor. It saves 1440px and 390px screenshots and removes the temporary release and account. Do not point it at production data.

To verify the SHSAT native fullscreen browser flow, run:

```sh
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD=... npm run test:e2e:shsat:native-fullscreen
```

This test launches a headed Chromium window, enters real fullscreen from the section-selection gesture, and verifies the English warning, persisted violation count, and fullscreen recovery. By default it exits through the browser Fullscreen API. To verify a native Escape key manually, set `E2E_NATIVE_ESCAPE=manual`; press Escape in the fullscreen exam window, then press Enter in the terminal when prompted. To verify an actual tab switch manually, set `E2E_NATIVE_TAB_SWITCH=manual`; switch away and back to the exam window at the two prompts. Playwright key events do not count as OS-level key evidence. The test creates and removes a temporary student and release. Do not point it at production data.
