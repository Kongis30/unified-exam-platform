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
