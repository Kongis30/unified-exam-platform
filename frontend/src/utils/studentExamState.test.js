import test from 'node:test'
import assert from 'node:assert/strict'
import { getStudentExamState } from './studentExamState.js'

const now = Date.parse('2026-10-25T12:00:00Z')
const baseExam = {
  opensAt: '2026-10-25T10:00:00Z',
  closesAt: '2026-10-25T14:00:00Z',
  attemptsUsed: 0,
  attemptLimit: 1,
  activeAttemptId: null,
  latestAttemptId: null,
}

test('shows an open exam with no attempts as available and startable', () => {
  assert.deepEqual(getStudentExamState(baseExam, now), {
    label: 'Available', canStart: true, canViewAttempt: false, startLabel: 'Start exam',
  })
})

test('shows a completed attempt as submitted while the exam window is still open', () => {
  assert.deepEqual(getStudentExamState({ ...baseExam, attemptsUsed: 1, latestAttemptId: 41 }, now), {
    label: 'Submitted', canStart: false, canViewAttempt: true, startLabel: 'Start exam',
  })
})

test('keeps an exam available when a retake remains', () => {
  assert.equal(getStudentExamState({ ...baseExam, attemptsUsed: 1, attemptLimit: 2, latestAttemptId: 41 }, now).label, 'Available')
  assert.equal(getStudentExamState({ ...baseExam, attemptsUsed: 1, attemptLimit: 2, latestAttemptId: 41 }, now).canStart, true)
})

test('does not show an exhausted attempt as available when no report exists', () => {
  assert.deepEqual(getStudentExamState({ ...baseExam, attemptsUsed: 1 }, now), {
    label: 'No attempts left', canStart: false, canViewAttempt: false, startLabel: 'Start exam',
  })
})

test('prioritizes an active attempt and offers Continue', () => {
  assert.deepEqual(getStudentExamState({ ...baseExam, activeAttemptId: 42, attemptsUsed: 1, latestAttemptId: 41 }, now), {
    label: 'In progress', canStart: true, canViewAttempt: true, startLabel: 'Continue',
  })
})

test('prevents a new attempt outside the availability window', () => {
  const upcoming = getStudentExamState({ ...baseExam, opensAt: '2026-10-25T13:00:00Z' }, now)
  const closed = getStudentExamState({ ...baseExam, closesAt: '2026-10-25T11:00:00Z' }, now)
  assert.equal(upcoming.label, 'Upcoming')
  assert.equal(upcoming.canStart, false)
  assert.equal(closed.label, 'Closed')
  assert.equal(closed.canStart, false)
})
