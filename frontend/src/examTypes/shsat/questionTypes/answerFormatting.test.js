import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

let vite
let answerDisplay
let fallbackQuestionTypeDefinition
let normalizeAnswerList
let formatEquationAnswer
let formatSelectedPoints
let formatGraphPoints
let normalizeGraphAnswerPoints
let formatHotSpotSelection
let normalizeHotSpotAnswerData
let formatHotTextSelection
let normalizeHotTextAnswerData
let formatInlineChoiceAnswerMap
let normalizeInlineChoiceAnswerMap
let formatSolutionSetAnswer
let formatTableGridAnswerMap
let formatTableGridTextCellMap
let formatDragAndDropMatches
let normalizeDragAndDropMatches
let normalizeTableGridAnswerMap
let normalizeTableGridTextCellMap

test.before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  ;[answerDisplay, fallbackQuestionTypeDefinition, normalizeAnswerList, formatEquationAnswer,
    formatSelectedPoints, formatGraphPoints, normalizeGraphAnswerPoints, formatHotSpotSelection,
    normalizeHotSpotAnswerData, formatHotTextSelection, normalizeHotTextAnswerData, formatInlineChoiceAnswerMap,
    normalizeInlineChoiceAnswerMap, formatSolutionSetAnswer, formatTableGridAnswerMap,
    normalizeTableGridAnswerMap, formatTableGridTextCellMap, normalizeTableGridTextCellMap,
    formatDragAndDropMatches, normalizeDragAndDropMatches] = await Promise.all([
    vite.ssrLoadModule('/src/utils/answerDisplay.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/fallback.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/utils.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/equationEditor/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/graphQuestion/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/hotSpot/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/hotText/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/inlineChoice/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/solutionSet/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/tableGrid/helpers.js'),
    vite.ssrLoadModule('/src/examTypes/shsat/questionTypes/dragAndDrop/helpers.js'),
  ]).then(([display, fallback, answerUtils, equation, graph, hotSpot, hotText, inlineChoice,
    solutionSet, tableGrid, dragAndDrop]) => [
    display.answerDisplayText,
    fallback.default,
    answerUtils.normalizeAnswerList,
    equation.formatEquationAnswer,
    graph.formatSelectedPoints,
    graph.formatGraphPoints,
    graph.normalizeGraphAnswerPoints,
    hotSpot.formatHotSpotSelection,
    hotSpot.normalizeHotSpotAnswerData,
    hotText.formatHotTextSelection,
    hotText.normalizeHotTextAnswerData,
    inlineChoice.formatInlineChoiceAnswerMap,
    inlineChoice.normalizeInlineChoiceAnswerMap,
    solutionSet.formatSolutionSetAnswer,
    tableGrid.formatTableGridAnswerMap,
    tableGrid.normalizeTableGridAnswerMap,
    tableGrid.formatTableGridTextCellMap,
    tableGrid.normalizeTableGridTextCellMap,
    dragAndDrop.formatDragAndDropMatches,
    dragAndDrop.normalizeDragAndDropMatches,
  ])
})

test.after(async () => {
  await vite?.close()
})

test('formats legacy and structured scalar answers without JavaScript object coercion', () => {
  assert.equal(answerDisplay({ value: { label: 'C' } }), 'C')
  assert.equal(answerDisplay({ correctAnswer: [{ key: 'A' }, { text: 'B' }] }), 'A, B')
  assert.equal(answerDisplay({ legacy: { source: 'answer key' } }), 'legacy: source: answer key')
  assert.equal(answerDisplay('[{"value":"A"},{"value":"B"}]'), 'A, B')
  assert.equal(normalizeAnswerList({ answers: [{ value: 'C' }] }).join(', '), 'C')
  assert.equal(normalizeAnswerList({ correctAnswer: { label: 'D' } }).join(', '), 'D')
  assert.doesNotMatch(answerDisplay({ answers: [{ value: 'C' }] }), /\[object Object\]/)
})

test('formats answers from all registered SHSAT question families', () => {
  const hotspotConfig = { regions: [{ id: 'region-a', label: 'Top left' }] }
  const hotTextConfig = { contentParts: [{ type: 'segment', id: 'segment-a', text: 'answer text' }] }
  const tableQuestion = {
    tableRows: [{ id: 'row1', label: 'Row 1' }],
    tableColumns: [{ id: 'col1', label: 'Column 1' }],
  }
  const dragConfig = { targets: [{ id: 'target1', label: 'First' }], choices: [{ id: 'choice1', text: 'One' }] }
  const blanks = [{ id: 'blank1', label: 'Blank 1', options: [{ key: 'A', text: 'Option A' }] }]
  const cases = [
    ['multiple choice / fill blank', normalizeAnswerList({ answers: [{ value: { label: 'C' } }] }).join(', '), 'C'],
    ['legacy fallback', fallbackQuestionTypeDefinition.formatReportAnswer({ answerData: { value: { text: 'legacy answer' } }, emptyText: '—' }), 'legacy answer'],
    ['equation editor accepted answers', formatEquationAnswer({ acceptedAnswers: [{ value: 'x = 2' }, { value: '2x = 4' }] }), 'x = 2 / 2x = 4'],
    ['equation editor legacy value', formatEquationAnswer({ value: { text: 'x = 2' } }), 'x = 2'],
    ['graph question', formatGraphPoints(normalizeGraphAnswerPoints({ points: [{ x: 2, y: 3, label: 'P1' }] })), 'P1 (2, 3)'],
    ['hot spot', formatHotSpotSelection(normalizeHotSpotAnswerData({ selectedRegionIds: [{ id: 'region-a' }] }, hotspotConfig), hotspotConfig), 'Top left'],
    ['hot text', formatHotTextSelection(normalizeHotTextAnswerData({ selectedSegmentIds: [{ id: 'segment-a' }] }, hotTextConfig), hotTextConfig), 'answer text'],
    ['inline choice', formatInlineChoiceAnswerMap(normalizeInlineChoiceAnswerMap({ answers: [{ blankId: 'blank1', optionKey: { key: 'A' } }] }, blanks), '—', blanks), 'Blank 1: Option A'],
    ['inline choice keyed map', formatInlineChoiceAnswerMap(normalizeInlineChoiceAnswerMap({ answers: { blank1: 'A' } }, blanks), '—', blanks), 'Blank 1: Option A'],
    ['drag and drop', formatDragAndDropMatches(normalizeDragAndDropMatches({ placements: { target1: [{ id: 'choice1' }] } }, dragConfig), dragConfig), 'First: One'],
    ['solution set', formatSolutionSetAnswer({ solution: { endpoint: 2, endpointIncluded: true, direction: 'right' } }), 'x ≥ 2'],
    ['table grid', formatTableGridAnswerMap(normalizeTableGridAnswerMap(tableQuestion, { answers: { row1: { value: 'col1' } } }), '—', tableQuestion), 'Row 1: Column 1'],
    ['table grid text', formatTableGridTextCellMap(normalizeTableGridTextCellMap(tableQuestion, { cells: { 'row1.col1': { value: 'typed answer' } } }), '—', tableQuestion), 'Row 1 / Column 1: typed answer'],
  ]

  for (const [questionType, actual, expected] of cases) {
    assert.equal(actual, expected, `${questionType} answer formatting`)
    assert.doesNotMatch(actual, /\[object Object\]/, `${questionType} must not stringify an object implicitly`)
  }
})

test('formats SAT and PSAT answer values from scalar and encoded list records', () => {
  assert.equal(answerDisplay('C'), 'C')
  assert.equal(answerDisplay('["A", "C"]'), 'A, C')
  assert.equal(answerDisplay('{"answers":["2", "3"]}'), '2, 3')
})
