const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const scoringProfileCode = process.env.E2E_SHSAT_SCORING_PROFILE || 'SHSAT_2026_100';
const expectedScale = scoringProfileCode === 'SHSAT_LEGACY_114'
  ? { ela: 54, math: 90, composite: 144 }
  : { ela: 62, math: 98, composite: 160 };
if (!adminUsername || !adminPassword) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const otherStudentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const otherStudent = await otherStudentContext.newPage();
  const pageErrors = [];
  [admin, student, otherStudent].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const username = `shsat_equation_${stamp}`;
  const otherUsername = `shsat_equation_other_${stamp}`;
  const password = `Equation${stamp}!`;
  const title = `Equation Grade ${suffix}`;
  let userId;
  let otherUserId;
  let classId;
  let paperId;
  let examId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Equation Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const otherUser = await api(admin, '/api/admin/users', 'POST', {
      username: otherUsername, password, realName: `Other Equation Student ${suffix}`,
      roleCode: 'STUDENT', email: null, phone: null,
    });
    otherUserId = Number(otherUser.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Equation ${suffix}`, description: 'Temporary equation grading report test', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `EQUATION_GRADE_${stamp}`, title, description: 'Equation notation parity scoring test',
      groupId: null, defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/scoring-profile`, 'PATCH', { scoringProfileCode });
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', {
      sections: [
        makeChoicePart(),
        {
          sectionCode: 'MATH', sectionKind: 'PART', title: 'Mathematics', sortOrder: 1,
          instructions: null, settings: {}, questions: [],
          children: [{
            sectionCode: 'MATH_EQUATIONS', sectionKind: 'SUBTYPE', title: 'Equations', sortOrder: 0,
            instructions: null, settings: {}, children: [],
            questions: [{
              questionTypeCode: 'EQUATION_EDITOR', payloadSchemaVersion: 1,
              stem: 'Solve the inequality: 8x + 35 ≤ 95.',
              render: { questionConfig: {
                normalization: { ignoreWhitespace: true, normalizeOperators: true, caseInsensitive: true },
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_ALGEBRA', skillCode: 'MATH_ALGEBRA_INEQUALITIES' },
              }, validationRules: {} },
              answerKey: { acceptedAnswers: [{ value: '8x+35\\le95' }] }, grading: {},
              explanation: 'Subtract 35 and divide by 8.', categoryId: null, sortOrder: 0,
              displayNumber: 58, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'GRAPH_QUESTION', payloadSchemaVersion: 1,
              stem: 'Plot the point (2, 3).',
              render: { questionConfig: {
                graphMode: 'point_graph', showCandidatePoints: false,
                graph: { xMin: -5, xMax: 5, xStep: 1, yMin: -5, yMax: 5, yStep: 1 },
                interaction: { snapToGrid: true },
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_GEOMETRY', skillCode: 'MATH_GEOMETRY_TRIANGLES_CIRCLES' },
              }, validationRules: {} },
              answerKey: { points: [{ x: 2, y: 3 }] }, grading: {}, explanation: 'The point is (2, 3).',
              categoryId: null, sortOrder: 1, displayNumber: 59, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'TABLE_GRID', payloadSchemaVersion: 1,
              stem: 'Select the correct value for the item.',
              render: { questionConfig: {
                selectionMode: 'single',
                rows: [{ id: 'item-1', label: 'Item 1' }],
                columns: [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }],
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_STATISTICS', skillCode: 'MATH_STATISTICS_DESCRIPTIVE' },
              }, validationRules: {} },
              answerKey: { answers: { 'item-1': 'yes' } }, grading: {}, explanation: 'Yes is correct.',
              categoryId: null, sortOrder: 2, displayNumber: 60, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'DRAG_AND_DROP', payloadSchemaVersion: 1,
              stem: 'Sort each number by parity.',
              render: { questionConfig: {
                mode: 'target_sort',
                choices: [
                  { id: 'one', text: '1' }, { id: 'two', text: '2' },
                  { id: 'three', text: '3' }, { id: 'four', text: '4' },
                ],
                targets: [{ id: 'odd', label: 'Odd numbers' }, { id: 'even', label: 'Even numbers' }],
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_ALGEBRA', skillCode: 'MATH_ALGEBRA_INEQUALITIES' },
              }, validationRules: {} },
              answerKey: { placements: { odd: ['one', 'three'], even: ['two', 'four'] } },
              grading: {}, explanation: 'Odd numbers belong in the odd group.',
              categoryId: null, sortOrder: 3, displayNumber: 61, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'SOLUTION_SET', payloadSchemaVersion: 1,
              stem: 'Graph the solution x ≥ 9.',
              render: { questionConfig: {
                mode: 'number_line_ray',
                instruction: 'Choose the ray and set its endpoint.',
                numberLine: { min: -5, max: 10, step: 1, labelStep: 1, showArrows: true },
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_ALGEBRA', skillCode: 'MATH_ALGEBRA_INEQUALITIES' },
              }, validationRules: {} },
              answerKey: { solution: { type: 'ray', endpoint: 9, endpointIncluded: true, direction: 'right' } },
              grading: {}, explanation: 'The closed ray starts at 9 and points right.',
              categoryId: null, sortOrder: 4, displayNumber: 62, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'FILL_IN_BLANK', payloadSchemaVersion: 1,
              stem: 'Enter the value of 2 + 2.',
              render: { questionConfig: {
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_ARITHMETIC', skillCode: 'MATH_ARITHMETIC_NUMBER_PROPERTIES' },
              }, validationRules: {} },
              answerKey: { answers: ['4'] }, grading: {}, explanation: '2 + 2 = 4.',
              categoryId: null, sortOrder: 5, displayNumber: 63, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'HOT_TEXT', payloadSchemaVersion: 1,
              stem: 'Select the phrase that describes the river direction.',
              render: { questionConfig: {
                contentParts: [
                  { type: 'text', text: 'The river ' },
                  { type: 'segment', id: 'river-direction', text: 'flows west' },
                  { type: 'text', text: ' through the valley.' },
                ],
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_GEOMETRY', skillCode: 'MATH_GEOMETRY_TRIANGLES_CIRCLES' },
              }, validationRules: {} },
              answerKey: { selectedSegmentIds: ['river-direction'] }, grading: {}, explanation: 'The passage says it flows west.',
              categoryId: null, sortOrder: 6, displayNumber: 64, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
              stem: 'This question should be answered incorrectly.',
              render: { options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Other answer' }], questionConfig: {
                shsatSkillTag: { subjectCode: 'MATH', domainCode: 'MATH_ALGEBRA', skillCode: 'MATH_ALGEBRA_INEQUALITIES' },
              }, validationRules: {} },
              answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
              sortOrder: 7, displayNumber: 65, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
              stem: 'This question should remain unanswered.',
              render: { options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Other answer' }], questionConfig: {}, validationRules: {} },
              answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
              sortOrder: 8, displayNumber: 66, maxPoints: 1, scoringSectionCode: 'MATH',
            }],
          }],
        },
      ],
    });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');
    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary equation notation parity scoring test',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 1_200, attemptLimit: 3, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: title });
    await card.getByRole('button', { name: /Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const startResponse = await startRequest;
    assert.equal(startResponse.status(), 200);
    const started = await startResponse.json();
    const attemptId = Number(started.id || started.attemptId);
    assert.equal(await apiStatus(student, `/api/student/attempts/${attemptId}/report`), 409,
      'a report is not available while the student attempt is still in progress');
    await login(otherStudent, otherUsername, password);
    assert.equal(await apiStatus(otherStudent, `/api/student/attempts/${attemptId}`), 404,
      'another student cannot read this attempt by guessing its ID');
    assert.equal(await apiStatus(otherStudent, `/api/student/attempts/${attemptId}/report`), 404,
      'another student cannot read this report by guessing its ID');
    const attempt = await api(student, `/api/student/attempts/${attemptId}`);
    assert.deepEqual([...new Set((attempt.items || attempt.questions || []).map(item => item.questionTypeCode))].sort(), [
      'DRAG_AND_DROP', 'EQUATION_EDITOR', 'FILL_IN_BLANK', 'GRAPH_QUESTION', 'HOT_TEXT',
      'INLINE_CHOICE', 'MULTIPLE_CHOICE', 'MULTI_SELECT', 'MULTI_SELECT_FIXED',
      'SOLUTION_SET', 'TABLE_GRID',
    ], 'the exam fixture includes all eleven non-Hot-Spot SHSAT question types');
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    await student.getByText('Choose the correct language answer.', { exact: true }).waitFor();
    await student.waitForTimeout(1_100);
    await student.locator('.choice-answer__option').first().click();
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await student.getByText('Select all values equal to four.', { exact: true }).waitFor();
    const multiSelectItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'MULTI_SELECT');
    assert.ok(multiSelectItem, 'the multi-select item is included in the active student attempt');
    const multiSelectItemId = Number(multiSelectItem.paperItemId || multiSelectItem.id);
    const multiSelectSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${multiSelectItemId}`)
      && response.request().method() === 'PUT');
    await student.locator('.choice-answer__option').nth(0).click();
    await student.locator('.choice-answer__option').nth(2).click();
    assert.equal(await student.locator('.choice-answer__option input[type="checkbox"]:checked').count(), 2,
      'the multi-select answer can select more than one correct choice');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await multiSelectSave).status(), 200, 'the multi-select answer saves before navigating');
    await student.getByText('Select exactly two factors of ten.', { exact: true }).waitFor();
    const fixedMultiSelectItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'MULTI_SELECT_FIXED');
    assert.ok(fixedMultiSelectItem, 'the fixed multi-select item is included in the active student attempt');
    const fixedMultiSelectItemId = Number(fixedMultiSelectItem.paperItemId || fixedMultiSelectItem.id);
    const fixedMultiSelectSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${fixedMultiSelectItemId}`)
      && response.request().method() === 'PUT');
    await student.locator('.choice-answer__option').nth(1).click();
    await student.locator('.choice-answer__option').nth(3).click();
    assert.equal(await student.locator('.choice-answer__option input[type="checkbox"]:checked').count(), 2,
      'the fixed multi-select enforces its configured number of choices');
    assert.equal(await student.locator('.choice-answer__option input[type="checkbox"]').nth(0).isDisabled(), true,
      'the fixed multi-select disables additional options after its selection limit is reached');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await fixedMultiSelectSave).status(), 200, 'the fixed multi-select answer saves before navigating');
    await student.locator('.inline-choice-answer').waitFor();
    const inlineChoiceItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'INLINE_CHOICE');
    assert.ok(inlineChoiceItem, 'the inline-choice item is included in the active student attempt');
    const inlineChoiceItemId = Number(inlineChoiceItem.paperItemId || inlineChoiceItem.id);
    const inlineChoiceSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${inlineChoiceItemId}`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Result' }).click();
    await student.getByRole('option', { name: '42' }).click();
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
    assert.equal((await inlineChoiceSave).status(), 200, 'the inline-choice answer saves when submitting the ELA section');
    await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
    await student.locator('.exam-transition-card__button').click();
    await student.getByText('Solve the inequality: 8x + 35 ≤ 95.', { exact: true }).waitFor();
    await student.waitForTimeout(1_100);

    const mathItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'EQUATION_EDITOR');
    assert.ok(mathItem, 'the Math equation item is included in the active student attempt');
    const paperItemId = Number(mathItem.paperItemId || mathItem.id);
    await student.locator('math-field').evaluate(field => {
      field.value = '8*x + 35 \\le 95';
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: field.value }));
    });
    const answerSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${paperItemId}`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await answerSave).status(), 200, 'the MathLive equation answer saves before moving to the next question');
    await student.getByText('Plot the point (2, 3).', { exact: true }).waitFor();
    await student.waitForTimeout(1_100);
    const graphItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'GRAPH_QUESTION');
    assert.ok(graphItem, 'the point graph item is included in the active student attempt');
    const graphItemId = Number(graphItem.paperItemId || graphItem.id);
    const graphSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${graphItemId}`)
      && response.request().method() === 'PUT');
    const plot = await student.locator('.graph-plot__svg').boundingBox();
    assert.ok(plot, 'the coordinate graph is rendered for the student');
    await student.locator('.graph-plot__svg').click({
      position: { x: plot.width * (474 / 680), y: plot.height * (112 / 420) },
    });
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await graphSave).status(), 200, 'the plotted point is saved before moving to the table grid');
    await student.getByText('Select the correct value for the item.', { exact: true }).waitFor();
    await student.waitForTimeout(1_100);
    const tableItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'TABLE_GRID');
    assert.ok(tableItem, 'the table grid item is included in the active student attempt');
    const correctTableCell = student.locator('.table-grid-answer__cell').filter({ has: student.getByRole('radio', { name: 'Item 1: Yes' }) });
    await correctTableCell.locator('label.table-grid-answer__choice').click();
    assert.equal(await student.getByRole('radio', { name: 'Item 1: Yes' }).isChecked(), true,
      'the visible table-grid choice records the selected answer');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await student.getByText('Sort each number by parity.', { exact: true }).waitFor();
    await student.waitForTimeout(1_100);
    const dragItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'DRAG_AND_DROP');
    assert.ok(dragItem, 'the drag-and-drop question is included in the student attempt');
    const dragItemId = Number(dragItem.paperItemId || dragItem.id);
    const sortTargets = student.locator('.drag-answer__target');
    const oddTarget = sortTargets.filter({ hasText: 'Odd numbers' });
    const evenTarget = sortTargets.filter({ hasText: 'Even numbers' });
    for (const [choice, target] of [['1', oddTarget], ['3', oddTarget], ['2', evenTarget]]) {
      await student.locator('.drag-answer__choice').filter({ hasText: choice }).click();
      await target.click();
    }
    await student.locator('.drag-answer__choice').filter({ hasText: '4' }).click();
    await evenTarget.click();
    const dragPlacements = await sortTargets.evaluateAll(targets => targets.map(target => ({
      label: target.querySelector('.drag-answer__target-label')?.textContent.trim(),
      values: [...target.querySelectorAll('.drag-answer__placed-choice')].map(button => button.textContent.trim()),
    })));
    assert.deepEqual(dragPlacements, [
      { label: 'Odd numbers', values: ['1', '3'] }, { label: 'Even numbers', values: ['2', '4'] },
    ], 'the drag-and-drop UI shows each answer in its configured target');
    const dragSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${dragItemId}`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await dragSave).status(), 200, 'moving to the next question persists the drag-and-drop placements');
    await student.getByText('Graph the solution x ≥ 9.', { exact: true }).waitFor();
    const solutionItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'SOLUTION_SET');
    assert.ok(solutionItem, 'the solution-set item is included in the student attempt');
    const solutionItemId = Number(solutionItem.paperItemId || solutionItem.id);
    const solutionSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${solutionItemId}`)
      && response.request().method() === 'PUT');
    await student.locator('.solution-answer__ray-button').filter({ hasText: 'Closed right ray' }).click();
    const endpointTick = student.locator('.solution-line__tick').filter({ hasText: /^9$/ }).locator('.solution-line__hit');
    await endpointTick.click();
    await student.getByText('Current answer: x ≥ 9', { exact: true }).waitFor();
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await solutionSave).status(), 200, 'moving to the next question persists the solution-set answer');
    await student.getByText('Enter the value of 2 + 2.', { exact: true }).waitFor();
    const fillBlankItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'FILL_IN_BLANK');
    assert.ok(fillBlankItem, 'the fill-in-the-blank item is included in the student attempt');
    const fillBlankItemId = Number(fillBlankItem.paperItemId || fillBlankItem.id);
    const fillBlankSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${fillBlankItemId}`)
      && response.request().method() === 'PUT');
    await student.locator('.fill-blank-input').fill('4');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await fillBlankSave).status(), 200, 'moving to the Hot Text item persists the fill-in-the-blank answer');
    await student.getByText('Select the phrase that describes the river direction.', { exact: true }).waitFor();
    const hotTextItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'HOT_TEXT');
    assert.ok(hotTextItem, 'the Hot Text question is included in the student attempt');
    const hotTextSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${hotTextItem.paperItemId || hotTextItem.id}`)
      && response.request().method() === 'PUT');
    await student.locator('.hot-text-answer__segment').getByText('flows west', { exact: true }).click();
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await hotTextSave).status(), 200, 'moving to the wrong-answer item persists the selected Hot Text segment');
    await student.getByText('This question should be answered incorrectly.', { exact: true }).waitFor();
    await student.locator('.choice-answer__option').nth(1).click();
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await student.getByText('This question should remain unanswered.', { exact: true }).waitFor();
    const unansweredItem = (attempt.items || attempt.questions || []).find(item => Number(item.displayNumber) === 66);
    assert.ok(unansweredItem, 'the final multiple-choice item is present in the attempt and remains unanswered');
    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Anyway', exact: true }).click();
    await student.getByRole('dialog').getByText('You will not be able to change answers after submission.').waitFor();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();

    const result = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    assert.equal(result.studentName, `Equation Student ${suffix}`);
    assert.equal(result.examTitle, title);
    assert.equal(result.paperName, title);
    assert.ok(result.submittedAt, 'the submitted report includes its submission timestamp');
    assert.equal(result.totalScore, 11, `eleven correct responses receive credit while wrong and blank responses do not; report=${JSON.stringify(result)}`);
    assert.equal(result.totalMaxScore, 13, 'the raw score maximum includes the wrong and unanswered questions');
    assert.equal(result.correctCount, 11);
    assert.equal(result.wrongCount, 1);
    assert.equal(result.unansweredCount, 1);
    assert.equal(result.questionCount, 13);
    assert.equal(result.answeredCount, 12);
    assert.equal(Number(result.completionRate), 92.31);
    assert.equal(Number(result.accuracy), 91.67, 'accuracy is calculated from answered questions only');
    assert.equal(result.scoringMode, 'SHSAT_SCALE_TABLE', 'the submitted SHSAT attempt uses its frozen scoring table');
    assert.equal(result.elaScaledScore, expectedScale.ela, 'the ELA raw score converts using the selected independent SHSAT table');
    assert.equal(result.mathScaledScore, expectedScale.math, 'the Math raw score converts using the selected independent SHSAT table');
    assert.equal(result.compositeScore, expectedScale.composite, 'the composite score is the sum of the two scaled sections');
    assert.equal(result.compositeMaxScore, 720, 'the composite score retains its 720-point maximum');
    assert.deepEqual(result.questions.map(question => [question.partCode, question.correct]), [
      ['ELA', true], ['ELA', true], ['ELA', true], ['ELA', true],
      ['MATH', true], ['MATH', true], ['MATH', true], ['MATH', true], ['MATH', true], ['MATH', true], ['MATH', true], ['MATH', false], ['MATH', null],
    ]);
    assert.ok(result.questions.reduce((total, question) => total + Number(question.timeSpent || 0), 0) > 0,
      'the report uses time recorded while the student is answering');
    const classScores = await api(admin, `/api/admin/reports/exams/${examId}/classes/${classId}`);
    const studentScore = classScores.find(row => Number(row.studentId) === userId);
    assert.ok(studentScore, 'the class score report includes the student who completed the exam');
    assert.equal(studentScore.compositeScore, expectedScale.composite, 'class results use the same scaled composite as the attempt report');
    assert.equal(studentScore.elaScaledScore, expectedScale.ela);
    assert.equal(studentScore.mathScaledScore, expectedScale.math);
    const classTrend = await api(admin, `/api/admin/classes/${classId}/score-trend?examTypeCodes=SHSAT`);
    const classTrendPoint = classTrend.find(row => Number(row.examId) === examId);
    assert.ok(classTrendPoint, 'the completed SHSAT exam appears in the class trend data');
    assert.equal(Number(classTrendPoint.averageRawScore), 11,
      'class trend raw score agrees with the completed attempt report');
    assert.equal(Number(classTrendPoint.averageScaledScore), expectedScale.composite,
      `class trend scaled score agrees with the completed attempt report: ${JSON.stringify(classTrendPoint)}`);
    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}`);
    await admin.getByRole('heading', { name: `Equation ${suffix}`, exact: true }).waitFor();
    const classScoreChart = admin.locator('.class-score-chart');
    await classScoreChart.waitFor();
    assert.equal(await classScoreChart.locator('.class-score-chart__value').textContent(), String(expectedScale.composite),
      'class trend chart displays the report composite in scaled mode');
    await classScoreChart.locator('.class-score-chart__point').hover();
    const classScoreTooltip = admin.locator('.class-score-chart__tooltip');
    await classScoreTooltip.waitFor();
    assert.match(await classScoreTooltip.innerText(), new RegExp(`${title}.*${expectedScale.composite}`, 's'));
    await admin.locator('#class-score-metric').selectOption('raw');
    assert.equal(await classScoreChart.locator('.class-score-chart__value').textContent(), '11',
      'class trend chart switches to the raw score from the same report');
    await admin.screenshot({ path: `/tmp/shsat-class-score-trend-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const classTrendMobile = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(classTrendMobile.page <= classTrendMobile.viewport, 'the scored SHSAT class trend fits a 390px viewport');
    await admin.locator('.class-score-chart-wrap').scrollIntoViewIfNeeded();
    await admin.screenshot({ path: `/tmp/shsat-class-score-trend-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    const studentHistory = await api(admin, `/api/admin/reports/students/${userId}/attempts`);
    assert.equal(studentHistory[0].compositeScore, expectedScale.composite, 'student history uses the same scaled composite');
    const studentReport = await api(student, `/api/student/attempts/${attemptId}/report`);
    assert.equal(studentReport.studentName, `Equation Student ${suffix}`);
    assert.equal(studentReport.examTitle, title);
    assert.equal(studentReport.paperName, title);
    assert.equal(studentReport.submittedAt, result.submittedAt,
      'student and administrator report entries agree on the submitted time');
    assert.equal(studentReport.scoreVisible, true, 'SHSAT scores are visible after submission by default, as in the independent system');
    assert.equal(studentReport.compositeScore, expectedScale.composite, 'the student report exposes the same scaled composite');
    assert.equal(studentReport.answersVisible, false, 'correct answers remain hidden until the release closes');
    assert.equal(studentReport.questions.length, 13, 'allowed review retains correct, wrong, and unanswered question details');
    assert.equal(studentReport.correctCount, null, 'correct and wrong counts stay hidden until answers are released');
    assert.equal(studentReport.wrongCount, null);
    assert.equal(studentReport.unansweredCount, 1);
    assert.equal(Number(studentReport.completionRate), 92.31);
    assert.equal(studentReport.accuracy, null, 'answer accuracy stays hidden until answers are released');
    for (const question of studentReport.questions) {
      for (const hiddenField of ['correctAnswer', 'correctAnswerData', 'correct', 'knowledgeBreakdown']) {
        assert.equal(Object.hasOwn(question, hiddenField), false,
          `hidden answer policy removes ${hiddenField} from question ${question.questionNumber}`);
      }
    }
    assert.deepEqual(studentReport.knowledgeBreakdown, [], 'hidden answer policy removes skill-level answer data from the student report payload');
    await student.getByText('Raw Total', { exact: true }).waitFor();
    assert.equal(await student.locator('.summary-field').filter({ hasText: 'Raw Total' }).locator('.summary-field__value').textContent(), '11 / 13');
    assert.equal(await student.locator('.summary-field').filter({ hasText: 'Composite Score' }).locator('.summary-field__value').textContent(), `${expectedScale.composite} / 720`);
    await student.locator('.knowledge-card').getByText('Skill-level results will be available after the exam closes.', { exact: true }).waitFor();
    assert.equal(await student.locator('.knowledge-score-item').count(), 0,
      'the student report does not show misleading skill accuracy before answer details are visible');
    await student.screenshot({ path: `/tmp/shsat-equation-report-${stamp}.png` });
    await student.evaluate(() => {
      window.__shsatPrintRequested = false;
      window.print = () => { window.__shsatPrintRequested = true; };
    });
    await student.getByRole('button', { name: 'Print Report', exact: true }).click();
    assert.equal(await student.evaluate(() => window.__shsatPrintRequested), true,
      'Print Report opens the browser print flow');
    const reportPdf = await student.pdf({ format: 'Letter', printBackground: true });
    assert.ok(reportPdf.subarray(0, 5).toString() === '%PDF-', 'the report produces a valid PDF document');
    assert.ok(reportPdf.byteLength > 10_000, `the report PDF contains rendered content (${reportPdf.byteLength} bytes)`);
    const reportPdfPath = `/tmp/shsat-equation-report-${stamp}.pdf`;
    await fs.writeFile(reportPdfPath, reportPdf);
    await student.emulateMedia({ media: 'screen' });

    for (let attemptNumber = 2; attemptNumber <= 3; attemptNumber += 1) {
      const retake = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
      const retakeId = Number(retake.id || retake.attemptId);
      const submitted = await api(student, `/api/student/attempts/${retakeId}/submit`, 'POST');
      assert.ok(['SUBMITTED', 'COMPLETED'].includes(submitted.status), `student detail sample retake ${attemptNumber} submits`);
    }

    await api(admin, `/api/admin/exams/${examId}/close`, 'POST');
    const revealedStudentReport = await api(student, `/api/student/attempts/${attemptId}/report`);
    assert.equal(revealedStudentReport.answersVisible, true,
      'the student report reveals answer details after the exam closes when review is allowed');
    assert.equal(revealedStudentReport.correctCount, 11);
    assert.equal(revealedStudentReport.wrongCount, 1);
    assert.equal(revealedStudentReport.unansweredCount, 1);
    assert.equal(Number(revealedStudentReport.completionRate), 92.31);
    assert.equal(Number(revealedStudentReport.accuracy), 91.67);
    assert.ok(revealedStudentReport.questions.every(question => Object.hasOwn(question, 'correctAnswerData')),
      'the closed-exam report includes correct-answer data for every question');
    await student.reload();
    await student.getByText('Result Summary', { exact: true }).waitFor();
    await student.locator('.knowledge-card .knowledge-score-item').first().waitFor();
    assert.equal(await student.locator('.knowledge-card').getByText('Skill-level results will be available after the exam closes.', { exact: true }).count(), 0,
      'closing the exam reveals the student skill-level results');
    await student.getByText('1 question does not have a knowledge tag yet.', { exact: true }).waitFor();
    const revealedAnswerHeader = student.locator('.question-table thead').getByText('Correct Answer', { exact: true }).first();
    await revealedAnswerHeader.waitFor();
    await revealedAnswerHeader.scrollIntoViewIfNeeded();
    await student.screenshot({ path: `/tmp/shsat-student-report-answers-visible-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const dragMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dragMobileSize.page <= dragMobileSize.viewport, 'the drag-and-drop report fits a 390px viewport');
    await student.locator('.question-table tbody tr').last().scrollIntoViewIfNeeded();
    await student.screenshot({ path: `/tmp/shsat-drag-and-drop-report-mobile-${stamp}.png` });

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}/students/${userId}?studentName=${encodeURIComponent(`Equation Student ${suffix}`)}&studentNumber=${encodeURIComponent(username)}&className=${encodeURIComponent(`Equation ${suffix}`)}`);
    await admin.getByRole('heading', { name: `Equation Student ${suffix}`, exact: true }).waitFor();
    const historyRow = admin.locator('.history-table tbody tr').filter({ hasText: title });
    const originalScoredHistoryRow = historyRow.filter({ hasText: '11 / 13' });
    await originalScoredHistoryRow.waitFor();
    await originalScoredHistoryRow.getByText(`${expectedScale.composite} / 720`, { exact: true }).waitFor();
    await originalScoredHistoryRow.getByRole('button', { name: /View report/i }).click();
    await admin.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
    const reportPage = admin.locator('.attempt-report');
    await reportPage.getByRole('heading', { name: 'Knowledge and Skills', exact: true }).waitFor();
    const knowledgeSkills = await reportPage.locator('.knowledge-score-item__header strong').allTextContents();
    assert.ok(knowledgeSkills.includes('Main Idea'), 'the report groups tagged ELA questions under their skill');
    assert.ok(knowledgeSkills.includes('Inequalities'), 'the report groups tagged Math questions under their skill');
    assert.ok(knowledgeSkills.includes('Triangles and Circles'), 'the report retains the second Math domain');
    assert.ok(knowledgeSkills.includes('Descriptive Statistics'), 'the report retains the third Math domain');
    assert.ok(knowledgeSkills.includes('Number Properties'), 'valid arithmetic tags remain in the SHSAT skill taxonomy');
    assert.equal(await reportPage.locator('.knowledge-score-item').count(), 5,
      'only the five valid tagged SHSAT skill areas appear in the report');
    const expectedSkillResults = {
      'Main Idea': ['100%', 'Multiple Choice, Multi Select, Fixed Multi Select, Inline Choice · 4 questions, 4 correct', '0 wrong, 0 unanswered', 'Q1, Q2, Q3, Q4'],
      'Inequalities': ['75%', 'Equation Editor, Drag and Drop, Solution Set, Multiple Choice · 4 questions, 3 correct', '1 wrong, 0 unanswered', 'Q58, Q61, Q62, Q65'],
      'Number Properties': ['100%', 'Fill in the Blank · 1 question, 1 correct', '0 wrong, 0 unanswered', 'Q63'],
      'Triangles and Circles': ['100%', 'Point Graph, Hot Text · 2 questions, 2 correct', '0 wrong, 0 unanswered', 'Q59, Q64'],
      'Descriptive Statistics': ['100%', 'Table Grid · 1 question, 1 correct', '0 wrong, 0 unanswered', 'Q60'],
    };
    const actualSkillResults = await reportPage.locator('.knowledge-score-item').evaluateAll(cards => Object.fromEntries(cards.map(card => {
      const text = selector => card.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim();
      return [text('.knowledge-score-item__header strong'), [
        text('.knowledge-score-item__header span'),
        text('.knowledge-score-item__detail'),
        card.querySelector('.knowledge-score-item__footer span')?.textContent.trim(),
        card.querySelectorAll('.knowledge-score-item__footer span')[1]?.textContent.trim(),
      ]];
    })));
    assert.deepEqual(actualSkillResults, expectedSkillResults,
      'each skill area shows the correct percent, question count, outcomes and question numbers');
    await reportPage.getByText('1 question does not have a knowledge tag yet.', { exact: true }).waitFor();
    assert.deepEqual(await reportPage.locator('.knowledge-score-subject > h3').allTextContents(), ['Reading and Writing', 'Math'],
      'SHSAT skill hierarchy separates ELA and Math and does not introduce SAT domains');
    const reportFilters = (await reportPage.locator('.review-filter').allTextContents())
      .map(label => label.replace(/\s+/g, ' ').trim());
    assert.deepEqual(reportFilters, ['All Questions13', 'Needs Review2', 'Unanswered1', 'Answered12'],
      'Needs Review includes wrong and unanswered items while dedicated filters preserve separate counts');
    const questionReviewFilters = reportPage.locator('.review-toolbar');
    const questionReviewList = reportPage.locator('.question-set-list');
    await questionReviewFilters.getByRole('button', { name: /^Unanswered/ }).click();
    assert.equal(await questionReviewList.locator('.question-table > tbody > tr').count(), 1,
      'the Unanswered filter shows only the unanswered question');
    await questionReviewList.locator('.question-table__question').getByRole('button', { name: 'Question 66', exact: true }).waitFor();
    await questionReviewList.locator('.question-table > tbody').getByText('Not answered', { exact: true }).waitFor();
    await questionReviewFilters.getByRole('button', { name: /^Answered/ }).click();
    assert.equal(await questionReviewList.locator('.question-table > tbody > tr').count(), 12,
      'the Answered filter shows all twelve submitted responses, including the wrong answer');
    await questionReviewFilters.getByRole('button', { name: /^Needs Review/ }).click();
    assert.equal(await questionReviewList.locator('.question-table > tbody > tr').count(), 2,
      'Needs Review contains one incorrect and one unanswered response');
    await questionReviewFilters.getByRole('button', { name: /^All Questions/ }).click();
    const reportQuestionLabels = (await reportPage.locator('.question-table__question .question-link').allTextContents())
      .map(label => label.trim());
    assert.equal(new Set(reportQuestionLabels).size, 13,
      `the administrator report displays each of the thirteen exam questions once: ${reportQuestionLabels.join(', ')}`);
    const reportTypeLabels = [...new Set(await reportPage.locator('.question-table .type-pill').allTextContents())].sort();
    assert.deepEqual(reportTypeLabels, [
      'Drag and Drop', 'Equation Editor', 'Fill in the Blank', 'Fixed Multi Select',
      'Hot Text', 'Inline Choice', 'Multi Select', 'Multiple Choice', 'Point Graph', 'Solution Set', 'Table Grid',
    ], 'question review renders each of the eleven SHSAT answer types in the submitted report');
    const reportOutcomes = await reportPage.locator('.question-table tbody tr').evaluateAll(rows => Object.fromEntries(rows.map(row => {
      const questionNumber = row.querySelector('.question-link')?.textContent.match(/\d+/)?.[0];
      return [questionNumber, row.querySelector('.result-pill')?.textContent.trim()];
    })));
    assert.equal(reportOutcomes['1'], 'Correct');
    assert.equal(reportOutcomes['65'], 'Needs Review');
    assert.equal(reportOutcomes['66'], 'Unanswered');
    const totalTimeText = await reportPage.locator('.time-analysis-card').filter({ hasText: 'Total Time' }).locator('strong').textContent();
    const totalTime = totalTimeText?.match(/(\d+)\s*min\s*(\d+)\s*sec/i);
    assert.ok(totalTime && Number(totalTime[1]) * 60 + Number(totalTime[2]) > 0,
      `the report displays the nonzero time recorded during the attempt: ${totalTimeText}`);
    for (const [label, expectedAnswered] of [['ELA Time', 4], ['Math Time', 8]]) {
      const sectionTimeCard = reportPage.locator('.time-analysis-card').filter({ hasText: label });
      const sectionSecondsText = await sectionTimeCard.locator('strong').textContent();
      const sectionSeconds = sectionSecondsText?.match(/(\d+)\s*min\s*(\d+)\s*sec/i);
      assert.ok(sectionSeconds && Number(sectionSeconds[1]) * 60 + Number(sectionSeconds[2]) > 0,
        `${label} shows positive recorded time: ${sectionSecondsText}`);
      assert.match(await sectionTimeCard.locator('span').textContent(), new RegExp(`^${expectedAnswered} answered · avg `),
        `${label} reports the number of answered questions and per-answer average`);
    }
    assert.notEqual(await reportPage.locator('.analysis-muted').filter({ hasText: 'Average across all questions' }).textContent(),
      'Average across all questions: -.',
      'the report calculates an average across all exam questions when timing data exists');
    const adminReportPath = `/student/attempts/${attemptId}/report`;
    const reportEndpoint = `**/api/admin/reports/attempts/${attemptId}/result`;
    await admin.route(reportEndpoint, route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'The report could not be loaded. Please try again.' }),
    }), { times: 1 });
    await admin.getByRole('button', { name: 'Refresh report' }).click();
    await admin.getByRole('heading', { name: 'Unable to Load Report', exact: true }).waitFor();
    await admin.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-admin-report-error-${stamp}.png` });
    await admin.getByRole('button', { name: 'Retry', exact: true }).click();
    await admin.getByText('Result Summary', { exact: true }).waitFor();
    await admin.unroute(reportEndpoint);
    const monitorUrl = admin.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/exams/${examId}/monitor`
      && url.searchParams.get('attemptId') === String(attemptId));
    await admin.getByRole('button', { name: 'Monitor', exact: true }).click();
    await monitorUrl;
    await admin.locator('.monitor-back-button').click();
    await admin.waitForURL(url => url.pathname === adminReportPath);
    await admin.getByText('Result Summary', { exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-admin-report-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const adminReportMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(adminReportMobileSize.page <= adminReportMobileSize.viewport, 'the administrator report fits a 390px viewport');
    await reportPage.locator('.knowledge-card').scrollIntoViewIfNeeded();
    await admin.screenshot({ path: `/tmp/shsat-admin-report-mobile-${stamp}.png` });
    await admin.getByRole('button', { name: 'Back to Student Detail', exact: true }).click();
    await admin.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/classes/${classId}/students/${userId}`);
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByRole('button', { name: 'Scaled', exact: true }).click();
    await admin.locator('.score-chart canvas').waitFor();
    await admin.waitForTimeout(500);
    await admin.screenshot({ path: `/tmp/shsat-scaled-student-detail-${stamp}.png`, fullPage: true });

    const reconciledHistory = await api(admin, `/api/admin/reports/students/${userId}/attempts`);
    assert.equal(reconciledHistory.length, 3, 'student history API contains all three completed attempts');
    const scoredRows = reconciledHistory.filter(row => row.compositeScore !== null && row.compositeScore !== undefined);
    const expectedDisplayedScores = scoredRows.map(row => Number(row.compositeScore));
    const expectedAverage = Math.round(expectedDisplayedScores.reduce((sum, score) => sum + score, 0) / expectedDisplayedScores.length);
    const expectedHighest = Math.max(...expectedDisplayedScores);
    const refreshHistoryResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/reports/students/${userId}/attempts`));
    await admin.getByRole('button', { name: 'Refresh history' }).click();
    assert.equal((await refreshHistoryResponse).status(), 200, 'student detail refresh reloads the history API');
    const historyRows = admin.locator('.history-table tbody tr');
    await historyRows.nth(2).waitFor();
    const summaryValues = await admin.locator('.summary-grid dd').allTextContents();
    assert.deepEqual(summaryValues.map(value => value.trim()), ['3', '3', String(expectedAverage), String(expectedHighest)],
      'attempt counts, average, and highest score reconcile with the completed-attempt API records');

    const readScoreColumn = async (label) => historyRows.evaluateAll((rows, targetLabel) => rows.map(row => {
      const cell = [...row.querySelectorAll('td')].find(item => item.dataset.label === targetLabel);
      return cell?.querySelector('strong')?.textContent.trim() || '';
    }), label);
    const rawSort = admin.getByRole('button', { name: /Raw Score/ });
    await rawSort.click();
    const rawDescending = (await readScoreColumn('Raw score')).map(value => Number(value.split('/')[0].trim()));
    assert.deepEqual(rawDescending, [...rawDescending].sort((left, right) => right - left),
      'Raw Score sorts completed attempts from highest to lowest');
    await rawSort.click();
    const rawAscending = (await readScoreColumn('Raw score')).map(value => Number(value.split('/')[0].trim()));
    assert.deepEqual(rawAscending, [...rawAscending].sort((left, right) => left - right),
      'Raw Score toggles to lowest-to-highest order');
    const scaledSort = admin.getByRole('button', { name: /Scaled Score/ });
    await scaledSort.click();
    const scaledDescending = (await readScoreColumn('Scaled score')).map(value => Number(value.split('/')[0].trim()));
    assert.deepEqual(scaledDescending, [...scaledDescending].sort((left, right) => right - left),
      'Scaled Score sorts completed attempts from highest to lowest');
    await scaledSort.click();
    const scaledAscending = (await readScoreColumn('Scaled score')).map(value => Number(value.split('/')[0].trim()));
    assert.deepEqual(scaledAscending, [...scaledAscending].sort((left, right) => left - right),
      'Scaled Score toggles to lowest-to-highest order');

    const historyEndpoint = `**/api/admin/reports/students/${userId}/attempts`;
    await admin.route(historyEndpoint, async route => {
      const response = await route.fetch();
      const records = await response.json();
      records.push({
        ...records[0], attemptId: 999_999_999, attemptNumber: 99, scoringMode: 'RAW_ONLY',
        compositeScore: null, totalScaledScore: null, elaScaledScore: null, mathScaledScore: null,
        section1ScaledScore: null, section2ScaledScore: null,
        submittedAt: new Date(Date.now() + 60_000).toISOString(),
      });
      await route.fulfill({ response, json: records });
    }, { times: 1 });
    const rawOnlyRefresh = admin.waitForResponse(response => response.url().endsWith(`/api/admin/reports/students/${userId}/attempts`));
    await admin.getByRole('button', { name: 'Refresh history' }).click();
    assert.equal((await rawOnlyRefresh).status(), 200, 'the raw-only legacy sample loads with student history');
    const rawOnlyRow = admin.locator('.history-table tbody tr').filter({ hasText: 'Attempt #99' });
    await rawOnlyRow.waitFor();
    assert.equal((await rawOnlyRow.locator('[data-label="Scaled score"]').innerText()).trim(), '—',
      'a source result without a scoring table displays a dash instead of an invented scaled score');
    await admin.unroute(historyEndpoint);

    await admin.route(historyEndpoint, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        ...reconciledHistory[0], attemptId: 999_999_998, attemptNumber: 1, status: 'IN_PROGRESS',
        scoringMode: 'RAW_ONLY', rawTotalScore: null, totalScore: null, compositeScore: null,
        totalScaledScore: null, elaScaledScore: null, mathScaledScore: null,
        section1ScaledScore: null, section2ScaledScore: null, submittedAt: null,
      }]),
    }), { times: 1 });
    const inProgressHistory = admin.waitForResponse(response => response.url().endsWith(`/api/admin/reports/students/${userId}/attempts`));
    await admin.getByRole('button', { name: 'Refresh history' }).click();
    assert.equal((await inProgressHistory).status(), 200);
    await admin.getByRole('heading', { name: 'Score Statistics', exact: true }).waitFor();
    assert.deepEqual((await admin.locator('.summary-grid dd').allTextContents()).map(value => value.trim()), ['1', '0', '-', '-'],
      'a student with no completed attempts sees dashes instead of NaN statistics');
    await admin.unroute(historyEndpoint);
    const restoreHistory = admin.waitForResponse(response => response.url().endsWith(`/api/admin/reports/students/${userId}/attempts`));
    await admin.getByRole('button', { name: 'Refresh history' }).click();
    assert.equal((await restoreHistory).status(), 200, 'history returns to persisted records after the no-score state check');
    await admin.locator('.history-table tbody tr').nth(2).waitFor();

    await admin.route(historyEndpoint, route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Student history is temporarily unavailable.' }),
    }), { times: 1 });
    await admin.getByRole('button', { name: 'Refresh history' }).click();
    await admin.getByRole('heading', { name: 'Unable to Load History', exact: true }).waitFor();
    await admin.getByRole('button', { name: 'Retry', exact: true }).click();
    await admin.getByRole('heading', { name: 'Score Statistics', exact: true }).waitFor();
    await admin.locator('.history-table tbody tr').nth(2).waitFor();
    await admin.unroute(historyEndpoint);
    await admin.screenshot({ path: `/tmp/shsat-scaled-student-detail-${stamp}.png`, fullPage: true });

    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.waitForTimeout(500);
    const studentDetailMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(studentDetailMobileSize.page <= studentDetailMobileSize.viewport, 'the scaled student detail fits a 390px viewport');
    await admin.locator('.score-chart').scrollIntoViewIfNeeded();
    await admin.locator('.score-chart canvas').waitFor();
    await admin.waitForTimeout(300);
    const mobileChartMetrics = await admin.locator('.score-chart canvas').evaluate(canvas => {
      const bounds = canvas.getBoundingClientRect();
      return { width: canvas.width, height: canvas.height, visibleWidth: bounds.width, visibleHeight: bounds.height };
    });
    assert.ok(mobileChartMetrics.width > 0 && mobileChartMetrics.height > 0
      && mobileChartMetrics.visibleWidth > 0 && mobileChartMetrics.visibleHeight > 0,
    `the scaled trend chart remains rendered at mobile width: ${JSON.stringify(mobileChartMetrics)}`);
    const mobileHistoryWidth = await admin.locator('.history-table-wrap').evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    assert.ok(mobileHistoryWidth.scroll <= mobileHistoryWidth.client + 1,
      'the score history uses a readable mobile layout without horizontal scrolling');
    assert.ok(await originalScoredHistoryRow.getByRole('button', { name: /View report/i }).isVisible(),
      'the report action remains visible in the mobile score history');
    await admin.evaluate(() => window.scrollTo(0, 0));
    await admin.screenshot({ path: `/tmp/shsat-scaled-student-detail-mobile-${stamp}.png`, fullPage: true });
    await admin.getByRole('button', { name: 'Back to Class Detail', exact: true }).click();
    await admin.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/classes/${classId}`);

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the equation result report fits a 390px viewport');
    const mobileQuestionTableSizes = await student.locator('.question-table-wrap').evaluateAll(elements => elements.map(element => {
      element.scrollLeft = 0;
      return { client: element.clientWidth, scroll: element.scrollWidth };
    }));
    assert.ok(mobileQuestionTableSizes.every(size => size.scroll <= size.client + 1),
      `the responsive question review fits without horizontal scrolling on a 390px viewport: ${JSON.stringify(mobileQuestionTableSizes)}`);
    await student.locator('.question-table tbody tr').first().scrollIntoViewIfNeeded();
    await student.screenshot({ path: `/tmp/shsat-student-report-answers-visible-mobile-${stamp}.png` });
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.screenshot({ path: `/tmp/shsat-equation-report-mobile-${stamp}.png` });
    await student.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
    await student.waitForURL(url => url.pathname === '/student/systems/SHSAT');
    assert.deepEqual(pageErrors, [], 'the student exam and report have no browser errors');

    console.log(JSON.stringify({
      result: 'PASS', scoringProfileCode, totalScore: result.totalScore, compositeScore: result.compositeScore,
      questionResults: result.questions.map(question => [question.partCode, question.correct]),
      mobileSize, dragMobileSize, adminReportMobileSize, studentDetailMobileSize, mobileChartMetrics, pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-equation-report-${stamp}.png`, `/tmp/shsat-equation-report-mobile-${stamp}.png`,
        `/tmp/shsat-drag-and-drop-report-mobile-${stamp}.png`,
        `/tmp/shsat-student-report-answers-visible-${stamp}.png`, `/tmp/shsat-student-report-answers-visible-mobile-${stamp}.png`,
        `/tmp/shsat-admin-report-${stamp}.png`, `/tmp/shsat-admin-report-mobile-${stamp}.png`,
        `/tmp/shsat-class-score-trend-${stamp}.png`, `/tmp/shsat-class-score-trend-mobile-${stamp}.png`,
        `/tmp/shsat-scaled-student-detail-${stamp}.png`, `/tmp/shsat-scaled-student-detail-mobile-${stamp}.png`],
      reportPdf: reportPdfPath,
      reportPdfBytes: reportPdf.byteLength,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (classId && userId) await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    if (otherUserId) await api(admin, `/api/admin/users/${otherUserId}`, 'DELETE').catch(() => {});
    if (paperId) await api(admin, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await otherStudentContext.close();
    await adminContext.close();
    await browser.close();
  }
}

function makeChoicePart() {
  return {
    sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
    instructions: null, settings: {}, questions: [],
    children: [{
      sectionCode: 'ELA_REVIEW', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
      instructions: null, settings: {}, children: [],
      questions: [{
        questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
        stem: 'Choose the correct language answer.',
        render: {
          options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }],
          questionConfig: {
            shsatSkillTag: { subjectCode: 'ELA', domainCode: 'ELA_READING_COMPREHENSION', skillCode: 'ELA_READING_MAIN_IDEA' },
          }, validationRules: {},
        },
        answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
        sortOrder: 0, displayNumber: 1, maxPoints: 1, scoringSectionCode: 'ELA',
      }, {
        questionTypeCode: 'MULTI_SELECT', payloadSchemaVersion: 1,
        stem: 'Select all values equal to four.',
        render: {
          options: [{ key: 'A', text: '2 + 2' }, { key: 'B', text: '3 + 2' }, { key: 'C', text: '8 ÷ 2' }, { key: 'D', text: '3 × 2' }],
          questionConfig: { shsatSkillTag: { subjectCode: 'ELA', domainCode: 'ELA_READING_COMPREHENSION', skillCode: 'ELA_READING_MAIN_IDEA' } },
          validationRules: {},
        },
        answerKey: { answers: ['A', 'C'] }, grading: {}, explanation: 'Both A and C equal four.', categoryId: null,
        sortOrder: 1, displayNumber: 2, maxPoints: 1, scoringSectionCode: 'ELA',
      }, {
        questionTypeCode: 'MULTI_SELECT_FIXED', payloadSchemaVersion: 1,
        stem: 'Select exactly two factors of ten.',
        render: {
          options: [{ key: 'A', text: '3' }, { key: 'B', text: '2' }, { key: 'C', text: '7' }, { key: 'D', text: '5' }],
          questionConfig: {
            selectionLimit: 2,
            shsatSkillTag: { subjectCode: 'ELA', domainCode: 'ELA_READING_COMPREHENSION', skillCode: 'ELA_READING_MAIN_IDEA' },
          },
          validationRules: {},
        },
        answerKey: { answers: ['B', 'D'] }, grading: {}, explanation: 'Two and five are factors of ten.', categoryId: null,
        sortOrder: 2, displayNumber: 3, maxPoints: 1, scoringSectionCode: 'ELA',
      }, {
        questionTypeCode: 'INLINE_CHOICE', payloadSchemaVersion: 1,
        stem: 'Choose the correct result: {{blank:result}}',
        render: { questionConfig: {
          inlineText: 'Choose the correct result: {{blank:result}}',
          blanks: [{ id: 'result', label: 'Result', options: [{ key: 'A', text: '40' }, { key: 'B', text: '42' }] }],
          shsatSkillTag: { subjectCode: 'ELA', domainCode: 'ELA_READING_COMPREHENSION', skillCode: 'ELA_READING_MAIN_IDEA' },
        }, validationRules: {} },
        answerKey: { answers: { result: 'B' } }, grading: {}, explanation: 'The correct result is 42.', categoryId: null,
        sortOrder: 3, displayNumber: 4, maxPoints: 1, scoringSectionCode: 'ELA',
      }],
    }],
  };
}

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function api(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const response = await page.evaluate(async ({ path, method, body, token }) => {
    const result = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

async function apiStatus(page, path) {
  return page.evaluate(async path => {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return response.status;
  }, path);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
