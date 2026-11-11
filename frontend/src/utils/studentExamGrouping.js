// 学生首页 My Exams 的派发方式分组。
//
// assignmentKind 由后端 listForStudent 计算：
//   GROUP      —— 整班派发（含 target_scope = ALL_STUDENTS 的历史数据）
//   ONE_ON_ONE —— 只派给个人
//
// 这里集中定义分组顺序、标题与空状态文案，新增分组只需改 ASSIGNMENT_GROUPS。

export const ASSIGNMENT_KIND = {
  GROUP: 'GROUP',
  ONE_ON_ONE: 'ONE_ON_ONE',
}

const ASSIGNMENT_GROUPS = [
  { key: ASSIGNMENT_KIND.GROUP, title: 'Group Exams', empty: 'No group exams assigned yet.' },
  { key: ASSIGNMENT_KIND.ONE_ON_ONE, title: '1on1 Exams', empty: 'No 1on1 exams assigned yet.' },
]

// 只有明确等于 GROUP 才归入班级考试；其余一律归入一对一。
// 这样后端尚未升级、响应缺少 assignmentKind 时，考试不会整块消失，
// 未知取值（例如将来新增的派发方式）也有确定的展示位置。
export function isGroupAssignment(exam) {
  return exam?.assignmentKind === ASSIGNMENT_KIND.GROUP
}

/** 按派发方式把考试拆成两个子区域，每个子区域保留原始顺序。 */
export function groupStudentExams(exams) {
  const rows = Array.isArray(exams) ? exams.filter(Boolean) : []
  return ASSIGNMENT_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    empty: group.empty,
    exams: rows.filter((exam) => (group.key === ASSIGNMENT_KIND.GROUP
      ? isGroupAssignment(exam)
      : !isGroupAssignment(exam))),
  }))
}
