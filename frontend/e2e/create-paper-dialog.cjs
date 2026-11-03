const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5175'}/login`);
    await page.evaluate(async () => {
      const { createApp, h, reactive } = await import('/node_modules/.vite/deps/vue.js');
      const Dialog = (await import('/src/components/admin/CreatePaperDialog.vue')).default;
      window.paperFixture = reactive({ type: 'SAT', name: '', description: '', groupId: '', duration: 134, submitted: false });
      const host = document.createElement('div');
      document.body.appendChild(host);
      createApp({ render() {
        const form = window.paperFixture;
        return h(Dialog, {
          examType: form.type, name: form.name, description: form.description,
          groupId: form.groupId, duration: form.duration, groups: [{ id: 23, name: 'Practice' }],
          'onUpdate:name': value => { form.name = value; },
          'onUpdate:description': value => { form.description = value; },
          'onUpdate:groupId': value => { form.groupId = value; },
          'onUpdate:duration': value => { form.duration = value; },
          onSubmit: () => { form.submitted = true; },
        });
      } }).mount(host);
    });
    const modal = page.getByRole('dialog', { name: 'Create Paper' });
    await modal.waitFor();
    await modal.getByText('Start with a draft').waitFor();
    await modal.getByLabel('Paper Name').fill('  Example Paper  ');
    await modal.getByLabel('Description').fill('Example description');
    await modal.getByLabel('Folder').selectOption({ label: 'Practice' });
    await modal.getByLabel('Duration (minutes)').fill('90');
    await modal.getByRole('button', { name: 'Create and Edit' }).click();
    const form = await page.evaluate(() => ({ ...window.paperFixture }));
    assert.deepEqual(form, { type: 'SAT', name: 'Example Paper', description: 'Example description', groupId: 23, duration: 90, submitted: true });
    await page.evaluate(() => { window.paperFixture.type = 'PSAT'; });
    await modal.getByPlaceholder('e.g. PSAT Practice Test 1').waitFor();
    await page.evaluate(() => { window.paperFixture.type = 'SHSAT'; });
    await modal.getByText('Official structure included').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'dialog fits a narrow screen');
    assert.deepEqual(errors, []);
    console.log('Shared Create Paper dialog: SAT, PSAT, SHSAT, folder, duration and mobile layout passed');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
