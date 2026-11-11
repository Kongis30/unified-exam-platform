// 考试按派发方式分组的共享逻辑。
//
// assignmentKind 由后端计算，两种页面语义略有不同但取值一致：
//   GROUP      —— 整班派发（含 target_scope = ALL_STUDENTS 的历史数据）
//   ONE_ON_ONE —— 只派给个人
//
// 学生端按「这名学生是通过班级还是个人拿到考试」判定，
// 管理端按「这场考试本身是整班派发还是个人派发」判定，
// 两边都归一到同一组取值，因此可以共用这里的拆分与顺序定义。

export const ASSIGNMENT_KIND = {
  GROUP: 'GROUP',
  ONE_ON_ONE: 'ONE_ON_ONE',
}

// 子区域顺序固定：先整班，再一对一。
const ASSIGNMENT_GROUP_ORDER = [
  { key: ASSIGNMENT_KIND.GROUP, title: 'Group Exams', empty: 'No group exams assigned yet.' },
  { key: ASSIGNMENT_KIND.ONE_ON_ONE, title: '1on1 Exams', empty: 'No 1on1 exams assigned yet.' },
]

// 只有明确等于 GROUP 才归入班级考试；其余一律归入一对一。
// 这样后端尚未升级、响应缺少 assignmentKind 时，考试不会整块消失，
// 未知取值（例如将来新增的派发方式）也有确定的展示位置。
export function isGroupAssignment(exam) {
  return exam?.assignmentKind === ASSIGNMENT_KIND.GROUP
}

/**
 * 按派发方式把考试拆成两个子区域，每个子区域保留原始顺序。
 *
 * @param exams 考试数组；非数组入参按空数组处理
 * @param emptyCopy 可选，覆盖各子区域的空状态文案，形如 { GROUP: '...', ONE_ON_ONE: '...' }
 */
export function groupExamsByAssignment(exams, emptyCopy = {}) {
  const rows = Array.isArray(exams) ? exams.filter(Boolean) : []
  return ASSIGNMENT_GROUP_ORDER.map((group) => ({
    key: group.key,
    title: group.title,
    empty: emptyCopy[group.key] ?? group.empty,
    exams: rows.filter((exam) => (group.key === ASSIGNMENT_KIND.GROUP
      ? isGroupAssignment(exam)
      : !isGroupAssignment(exam))),
  }))
}
