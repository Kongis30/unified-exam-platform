/** 将可独立管理的考试项目归并到用户看到的系统入口。 */
export function groupExamTypesIntoWorkspaces(types) {
  const workspaces = new Map()

  for (const type of types) {
    const code = type.workspaceCode || type.code
    const workspace = workspaces.get(code) || {
      code,
      displayName: type.workspaceName || type.displayName,
      summary: type.summary,
      programs: [],
    }
    workspace.programs.push(type)
    workspaces.set(code, workspace)
  }

  return [...workspaces.values()]
}

// 选择页保留已上线系统和后续模块入口；能否进入仍由后端授权目录决定。
export const EXAM_SYSTEM_CATALOG = [
  { code: 'SAT', displayName: 'SAT', summary: 'Manage SAT papers, classes, and exams.' },
  { code: 'PSAT', displayName: 'PSAT', summary: 'Manage PSAT papers, classes, and exams.' },
  { code: 'SHSAT', displayName: 'SHSAT', summary: 'Manage SHSAT papers, classes, and exams.' },
  { code: 'ACT', displayName: 'ACT', summary: 'ACT exam preparation and assessment.' },
  { code: 'SSAT', displayName: 'SSAT', summary: 'SSAT exam preparation and assessment.' },
  { code: 'ISEE', displayName: 'ISEE', summary: 'ISEE exam preparation and assessment.' },
  { code: 'NY_STATE_TEST', displayName: 'NY State Test', summary: 'New York State Test preparation and assessment.' },
  { code: 'REGENTS', displayName: 'Regents', summary: 'Regents exam preparation and assessment.' },
  { code: 'AP', displayName: 'AP', summary: 'Advanced Placement exam preparation and assessment.' },
]

/** 将完整的选择页入口与当前账号实际获权的模块合并。 */
export function getExamSystemCards(availableTypes) {
  const availableCodes = new Set(groupExamTypesIntoWorkspaces(availableTypes).map(({ code }) => code))
  return EXAM_SYSTEM_CATALOG.map((system) => ({
    ...system,
    available: availableCodes.has(system.code),
  }))
}
