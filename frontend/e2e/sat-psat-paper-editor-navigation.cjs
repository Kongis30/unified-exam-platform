const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const studentWrites = [];
  page.on('request', request => {
    if (request.url().includes('/api/student/sat-') && !['GET', 'HEAD'].includes(request.method())) {
      studentWrites.push(`${request.method()} ${request.url()}`);
    }
  });
  const originals = [];
  try {
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.endsWith('/login'));
    for (const code of ['SAT', 'PSAT']) {
      const structure = await page.evaluate(async code => {
        const papers = await (await fetch(`/api/admin/exam-types/${code}/papers`)).json();
        const paper = papers.find(row => row.status === 'READY' && row.questionCount > 1);
        if (!paper) throw new Error(`No ready ${code} paper with questions`);
        const detail = await (await fetch(`/api/admin/sat/papers/${paper.id}/editor/structure`)).json();
        const modules = detail.stages.flatMap(stage => stage.modules || []).flatMap(module => [module, ...(module.adaptiveOptions || [])]);
        const target = modules.find(module => (module.questions || []).length > 1) || modules.find(module => module.questions?.length);
        if (!target) throw new Error(`No ${code} module with questions`);
        return { paperId: paper.id, module: target, question: target.questions[1] || target.questions[0], number: target.questions.length > 1 ? 2 : 1 };
      }, code);
      const { paperId, module, question, number } = structure;
      await page.goto(`${baseUrl}/${code.toLowerCase()}/admin/papers/${paperId}/preview`);
      await page.locator('.answer-options').waitFor();
      assert.equal(await page.locator('.question-number-badge').textContent(), '1', `${code} ordinary preview opens without a question query`);
      const originalsItem = { paperId, questionId: question.questionId, content: question.content, moduleId: module.moduleId, subject: module.subjectCode === 2 ? 'Math' : 'RW', material: question.material };
      originals.push(originalsItem);
      const workspaceReturnTo = `/exam-types/${code}/admin?tab=papers`;
      const previewPath = `/${code.toLowerCase()}/admin/papers/${paperId}/preview`;
      const initialQuery = new URLSearchParams({ moduleId: module.moduleId, questionId: question.questionId, questionNumber: number, returnTo: workspaceReturnTo });
      await page.goto(`${baseUrl}${previewPath}?${initialQuery}`);
      await page.locator('.answer-options').waitFor();
      assert.equal(await page.locator('.question-number-badge').textContent(), String(number), `${code} preview restores the module question`);
      await page.getByRole('button', { name: 'Edit This Question', exact: true }).click();
      await page.waitForURL(url => url.pathname === `/${code.toLowerCase()}/admin/papers/${paperId}/edit` && url.searchParams.get('questionId') === String(question.questionId));
      await page.getByRole('heading', { name: `Question ${number}`, exact: true }).waitFor();
      const editor = page.locator('textarea[placeholder^="Enter question content"]');
      assert.equal(await editor.count(), 1, `${code} editor exposes the selected question`);
      await editor.fill(`${question.content} UNSAVED`);
      await page.getByRole('button', { name: `Back to Preview · Q${number}`, exact: true }).click();
      await page.getByText('Save your changes before opening the paper preview', { exact: true }).waitFor();
      assert.ok(page.url().includes('/edit'), `${code} unsaved changes cannot be lost by opening preview`);
      await editor.fill(question.content);
      const updated = `${question.content}\n\nPREVIEW_EDIT_${code}_${Date.now()}`;
      await editor.fill(updated);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('Question updated successfully', { exact: true }).waitFor();
      assert.ok(page.url().includes('/edit'), `${code} saving stays in the editor`);
      await page.getByRole('button', { name: `Back to Preview · Q${number}`, exact: true }).click();
      await page.waitForURL(url => url.pathname === previewPath && url.searchParams.get('moduleId') === String(module.moduleId));
      await page.getByText(`PREVIEW_EDIT_${code}_`, { exact: false }).waitFor();
      assert.equal(await page.locator('.question-number-badge').textContent(), String(number), `${code} returns to the same question`);
      await page.reload();
      await page.locator('.answer-options').waitFor();
      assert.equal(await page.locator('.question-number-badge').textContent(), String(number), `${code} preview reload retains the question`);
      await page.getByRole('button', { name: 'Edit This Question', exact: true }).click();
      await page.waitForURL(url => url.pathname.endsWith('/edit') && url.searchParams.get('questionId') === String(question.questionId));
      await page.reload();
      await page.getByRole('heading', { name: `Question ${number}`, exact: true }).waitFor();
      assert.equal(await page.locator('textarea[placeholder^="Enter question content"]').inputValue(), updated, `${code} editor reload retains the selected question`);
      await page.getByRole('button', { name: `Back to Preview · Q${number}`, exact: true }).click();
      await page.waitForURL(url => url.pathname === previewPath);
      await page.locator('.preview-module-select select').selectOption(String(module.moduleId));
      await page.getByRole('button', { name: 'Edit This Question', exact: true }).click();
      await page.waitForURL(url => url.pathname.endsWith('/edit'));
      await page.getByRole('button', { name: 'Papers', exact: true }).click();
      await page.waitForURL(url => [`/${code.toLowerCase()}/admin`, `/exam-types/${code}/admin`, `/${code.toLowerCase()}`, `/exam-types/${code}`].includes(url.pathname) && url.searchParams.get('tab') === 'papers');
    }
    assert.deepEqual(studentWrites, [], `preview writes no student attempts: ${studentWrites.join(', ')}`);
    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    console.log('SAT/PSAT preview-editor navigation passed.');
  } finally {
    try {
      for (const original of originals) {
        await page.evaluate(async original => {
          const csrf = await (await fetch('/api/auth/csrf')).json();
          const materialId = original.material?.materialId;
          if (materialId) {
            await fetch(`/api/admin/sat/papers/${original.paperId}/editor/materials/${materialId}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf.token },
              body: JSON.stringify({ title: original.material.materialName, materialType: original.material.materialType, content: original.material.content || '', fileUrl: original.material.fileUrl || '', source: original.material.source }),
            });
          }
          const detailResponse = await fetch(`/api/admin/sat/papers/${original.paperId}/editor/questions/${original.questionId}`);
          const detail = await detailResponse.json();
          const response = await fetch(`/api/admin/sat/papers/${original.paperId}/editor/questions/${original.questionId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf.token },
            body: JSON.stringify({ subject: original.subject, moduleId: original.moduleId, typeId: detail.typeId || 1, content: original.content, options: detail.options, correctAnswer: detail.correctAnswer, analysis: detail.analysis, difficulty: detail.difficulty, score: detail.score, materialId, tags: detail.tags || '' }),
          });
          if (!response.ok) throw new Error(`Restore question ${original.questionId}: ${response.status} ${await response.text()}`);
        }, original);
      }
    } finally {
      await browser.close();
    }
  }
}
main().catch(error => { console.error(error); process.exit(1); });
