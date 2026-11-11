// 学生首页 My Exams 的派发方式分组。
//
// 分组规则、子区域顺序与默认文案集中在 utils/examAssignmentGrouping.js，
// 这里只保留学生端的历史入口名（groupStudentExams），
// 使 StudentExamPage 与既有单测无需改动。

import { ASSIGNMENT_KIND, groupExamsByAssignment, isGroupAssignment } from './examAssignmentGrouping.js'

export { ASSIGNMENT_KIND, isGroupAssignment }

/** 按派发方式把考试拆成两个子区域，每个子区域保留原始顺序。 */
export function groupStudentExams(exams) {
  return groupExamsByAssignment(exams)
}
