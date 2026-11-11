import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGNMENT_KIND, groupExamsByAssignment, isGroupAssignment } from './examAssignmentGrouping.js'

const exam = (id, assignmentKind) => ({ id, title: `Exam ${id}`, assignmentKind })

const titles = (groups) => groups.map((group) => group.title)
const idsOf = (groups, key) => groups.find((group) => group.key === key).exams.map((item) => item.id)
const emptyOf = (groups, key) => groups.find((group) => group.key === key).empty

test('always returns the two subsections in Group then 1on1 order', () => {
  assert.deepEqual(titles(groupExamsByAssignment([])), ['Group Exams', '1on1 Exams'])
  assert.deepEqual(groupExamsByAssignment([]).map((group) => group.key), ['GROUP', 'ONE_ON_ONE'])
})

test('splits a mixed list into the two subsections', () => {
  const groups = groupExamsByAssignment([
    exam(1, ASSIGNMENT_KIND.GROUP),
    exam(2, ASSIGNMENT_KIND.ONE_ON_ONE),
    exam(3, ASSIGNMENT_KIND.GROUP),
  ])
  assert.deepEqual(idsOf(groups, 'GROUP'), [1, 3])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [2])
})

test('keeps the original order inside each subsection', () => {
  const groups = groupExamsByAssignment([
    exam(9, ASSIGNMENT_KIND.GROUP),
    exam(4, ASSIGNMENT_KIND.ONE_ON_ONE),
    exam(7, ASSIGNMENT_KIND.GROUP),
    exam(2, ASSIGNMENT_KIND.ONE_ON_ONE),
  ])
  assert.deepEqual(idsOf(groups, 'GROUP'), [9, 7])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [4, 2])
})

test('a missing assignmentKind falls back to 1on1 instead of dropping the exam', () => {
  const groups = groupExamsByAssignment([{ id: 5, title: 'Legacy' }])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [5])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
})

test('an unknown assignmentKind is shown under 1on1 rather than disappearing', () => {
  const groups = groupExamsByAssignment([exam(6, 'SOMETHING_NEW')])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [6])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
})

test('lowercase or padded group values are not treated as GROUP', () => {
  const groups = groupExamsByAssignment([exam(1, 'group'), exam(2, ' GROUP ')])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [1, 2])
})

test('both subsections expose their own default empty copy', () => {
  const groups = groupExamsByAssignment([])
  assert.equal(emptyOf(groups, 'GROUP'), 'No group exams assigned yet.')
  assert.equal(emptyOf(groups, 'ONE_ON_ONE'), 'No 1on1 exams assigned yet.')
})

test('empty copy can be overridden per subsection', () => {
  const groups = groupExamsByAssignment([], {
    GROUP: 'No group exams right now.',
    ONE_ON_ONE: 'No 1on1 exams right now.',
  })
  assert.equal(emptyOf(groups, 'GROUP'), 'No group exams right now.')
  assert.equal(emptyOf(groups, 'ONE_ON_ONE'), 'No 1on1 exams right now.')
})

test('a partial override only replaces the subsection that was given', () => {
  const groups = groupExamsByAssignment([], { ONE_ON_ONE: 'Nothing here.' })
  assert.equal(emptyOf(groups, 'GROUP'), 'No group exams assigned yet.')
  assert.equal(emptyOf(groups, 'ONE_ON_ONE'), 'Nothing here.')
})

test('a group-only list keeps an empty 1on1 subsection', () => {
  const groups = groupExamsByAssignment([exam(1, ASSIGNMENT_KIND.GROUP)])
  assert.deepEqual(idsOf(groups, 'GROUP'), [1])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [])
  assert.equal(groups.length, 2)
})

test('a one-on-one-only list keeps an empty Group subsection', () => {
  const groups = groupExamsByAssignment([exam(2, ASSIGNMENT_KIND.ONE_ON_ONE)])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [2])
})

test('tolerates null, undefined and non-array input', () => {
  for (const input of [null, undefined, 'nope', 42, {}]) {
    const groups = groupExamsByAssignment(input)
    assert.equal(groups.length, 2)
    assert.deepEqual(idsOf(groups, 'GROUP'), [])
    assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [])
  }
})

test('ignores null entries mixed into the list', () => {
  const groups = groupExamsByAssignment([null, exam(3, ASSIGNMENT_KIND.GROUP), undefined])
  assert.deepEqual(idsOf(groups, 'GROUP'), [3])
})

test('isGroupAssignment only accepts the exact GROUP value', () => {
  assert.equal(isGroupAssignment(exam(1, ASSIGNMENT_KIND.GROUP)), true)
  assert.equal(isGroupAssignment(exam(1, ASSIGNMENT_KIND.ONE_ON_ONE)), false)
  assert.equal(isGroupAssignment(exam(1, 'group')), false)
  assert.equal(isGroupAssignment({}), false)
  assert.equal(isGroupAssignment(null), false)
  assert.equal(isGroupAssignment(undefined), false)
})

test('does not mutate the input array', () => {
  const input = [exam(1, ASSIGNMENT_KIND.GROUP), exam(2, ASSIGNMENT_KIND.ONE_ON_ONE)]
  const snapshot = input.map((item) => item.id)
  groupExamsByAssignment(input)
  assert.deepEqual(input.map((item) => item.id), snapshot)
})

test('does not share exam arrays between the two subsections', () => {
  const groups = groupExamsByAssignment([exam(1, ASSIGNMENT_KIND.GROUP)])
  assert.notEqual(groups[0].exams, groups[1].exams)
  groups[0].exams.push(exam(99, ASSIGNMENT_KIND.GROUP))
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [])
})
