const STORAGE_PREFIX = 'paper-editor.selection';

// 本地保存每个考试模块、每份试卷的当前选题，不同步到服务端。
export function readEditorSelection(examType, paperId) {
  try {
    const value = localStorage.getItem(selectionKey(examType, paperId));
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeEditorSelection(examType, paperId, selection) {
  const key = selectionKey(examType, paperId);
  try {
    if (selection) {
      localStorage.setItem(key, JSON.stringify(selection));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // 浏览器禁用本地存储时，编辑功能仍可正常使用。
  }
}

function selectionKey(examType, paperId) {
  return `${STORAGE_PREFIX}.${String(examType).toLowerCase()}.${paperId}`;
}
