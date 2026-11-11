import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGNMENT_KIND, groupStudentExams, isGroupAssignment } from './studentExamGrouping.js'

const exam = (id, assignmentKind) => ({ id, title: `Exam ${id}`, assignmentKind })

const titles = (groups) => groups.map((group) => group.title)
const idsOf = (groups, key) => groups.find((group) => group.key === key).exams.map((item) => item.id)

test('always returns the two subsections in Group then 1on1 order', () => {
  assert.deepEqual(titles(groupStudentExams([])), ['Group Exams', '1on1 Exams'])
})

test('splits a mixed list into the matching subsections', () => {
  const groups = groupStudentExams([
    exam(1, 'GROUP'), exam(2, 'ONE_ON_ONE'), exam(3, 'GROUP'), exam(4, 'ONE_ON_ONE'),
  ])
  assert.deepEqual(idsOf(groups, 'GROUP'), [1, 3])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [2, 4])
})

test('keeps each subsection in the order the API returned', () => {
  const groups = groupStudentExams([exam(9, 'ONE_ON_ONE'), exam(7, 'GROUP'), exam(8, 'ONE_ON_ONE')])
  assert.deepEqual(idsOf(groups, 'GROUP'), [7])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [9, 8])
})

test('a missing assignmentKind falls back to 1on1 instead of dropping the exam', () => {
  const groups = groupStudentExams([{ id: 1, title: 'Legacy' }])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [1])
})

test('an unknown assignmentKind is shown under 1on1 rather than disappearing', () => {
  const groups = groupStudentExams([exam(1, 'SOMETHING_NEW')])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [1])
})

test('lowercase or padded group values are not treated as GROUP', () => {
  const groups = groupStudentExams([exam(1, 'group'), exam(2, ' GROUP'), exam(3, 'GROUP')])
  assert.deepEqual(idsOf(groups, 'GROUP'), [3])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [1, 2])
})

test('both subsections expose their own empty copy', () => {
  const groups = groupStudentExams([])
  assert.equal(groups.find((group) => group.key === 'GROUP').empty, 'No group exams assigned yet.')
  assert.equal(groups.find((group) => group.key === 'ONE_ON_ONE').empty, 'No 1on1 exams assigned yet.')
})

test('a group-only student keeps an empty 1on1 subsection', () => {
  const groups = groupStudentExams([exam(1, 'GROUP')])
  assert.deepEqual(idsOf(groups, 'GROUP'), [1])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [])
})

test('a one-on-one-only student keeps an empty Group subsection', () => {
  const groups = groupStudentExams([exam(1, 'ONE_ON_ONE')])
  assert.deepEqual(idsOf(groups, 'GROUP'), [])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [1])
})

test('tolerates null, undefined and non-array input', () => {
  for (const input of [null, undefined, 'nope', 42, {}]) {
    const groups = groupStudentExams(input)
    assert.equal(groups.length, 2)
    assert.deepEqual(idsOf(groups, 'GROUP'), [])
    assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [])
  }
})

test('ignores null entries mixed into the list', () => {
  const groups = groupStudentExams([null, exam(1, 'GROUP'), undefined])
  assert.deepEqual(idsOf(groups, 'GROUP'), [1])
  assert.deepEqual(idsOf(groups, 'ONE_ON_ONE'), [])
})

test('isGroupAssignment only accepts the exact GROUP value', () => {
  assert.equal(isGroupAssignment(exam(1, ASSIGNMENT_KIND.GROUP)), true)
  assert.equal(isGroupAssignment(exam(1, ASSIGNMENT_KIND.ONE_ON_ONE)), false)
  assert.equal(isGroupAssignment({ id: 1 }), false)
  assert.equal(isGroupAssignment(null), false)
  assert.equal(isGroupAssignment(undefined), false)
})

test('does not mutate the input array', () => {
  const input = [exam(1, 'GROUP'), exam(2, 'ONE_ON_ONE')]
  const snapshot = input.map((item) => item.id)
  groupStudentExams(input)
  assert.deepEqual(input.map((item) => item.id), snapshot)
})

test('does not share exam arrays between the two subsections', () => {
  const groups = groupStudentExams([exam(1, 'GROUP'), exam(2, 'ONE_ON_ONE')])
  const groupExams = groups.find((group) => group.key === 'GROUP').exams
  groupExams.push(exam(99, 'GROUP'))
  assert.deepEqual(idsOf(groupStudentExams([exam(1, 'GROUP')]), 'GROUP'), [1])
  assert.equal(groups.find((group) => group.key === 'ONE_ON_ONE').exams.length, 1)
})
