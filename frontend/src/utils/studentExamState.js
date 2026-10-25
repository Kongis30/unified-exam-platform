export function getStudentExamState(exam, now = Date.now()) {
  const attemptsUsed = Number(exam?.attemptsUsed || 0)
  const attemptLimit = Number(exam?.attemptLimit || 0)
  const hasReport = Boolean(exam?.latestAttemptId)
  const isInProgress = Boolean(exam?.activeAttemptId)
  const opensAt = new Date(exam?.opensAt).getTime()
  const closesAt = new Date(exam?.closesAt).getTime()
  const availability = opensAt > now ? 'Upcoming' : closesAt <= now ? 'Closed' : 'Available'

  if (isInProgress) {
    return { label: 'In progress', canStart: true, canViewAttempt: hasReport, startLabel: 'Continue' }
  }

  if (attemptsUsed >= attemptLimit) {
    return {
      label: hasReport ? 'Submitted' : 'No attempts left',
      canStart: false,
      canViewAttempt: hasReport,
      startLabel: 'Start exam',
    }
  }

  return {
    label: availability,
    canStart: availability === 'Available' && attemptsUsed < attemptLimit,
    canViewAttempt: hasReport,
    startLabel: 'Start exam',
  }
}
