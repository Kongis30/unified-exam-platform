import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false
})

const underlineRule = (state, silent) => {
  const marker = '++'
  const start = state.pos
  if (state.src.slice(start, start + marker.length) !== marker) return false

  const contentStart = start + marker.length
  const contentEnd = state.src.indexOf(marker, contentStart)
  if (contentEnd < 0 || contentEnd === contentStart) return false
  if (silent) return false

  const oldPosMax = state.posMax
  state.pos = contentStart
  state.posMax = contentEnd
  state.push('underline_open', 'u', 1)
  state.md.inline.tokenize(state)
  state.push('underline_close', 'u', -1)
  state.posMax = oldPosMax
  state.pos = contentEnd + marker.length
  return true
}

md.inline.ruler.before('emphasis', 'underline', underlineRule)

function normalizeMarkdownSource(source) {
  let normalized = String(source).replace(/\r\n?/g, '\n')

  // 部分历史题目把换行保存成两个字符的 "\\n"，只在没有真实换行时解码，避免误伤正文中的反斜杠。
  if (!normalized.includes('\n') && normalized.includes('\\n')) {
    normalized = normalized.replaceAll('\\n', '\n')
  }

  const lines = normalized.split('\n')
  const result = []
  lines.forEach((line, index) => {
    const previous = lines[index - 1] || ''
    const isHeading = /^\s{0,3}#{1,6}\s+/.test(line)
    const nextLine = lines[index + 1] || ''
    const isTableStart = /^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(nextLine)
    const previousIsTable = /^\s*\|/.test(previous)

    // Markdown-it 对块级结构要求清晰的边界；补空行不会改变正文内容，只修复历史数据的粘连格式。
    if (result.length && previous.trim() && (isHeading || (isTableStart && !previousIsTable))) {
      result.push('')
    }
    result.push(line)
  })
  return result.join('\n')
}

export function renderMarkdown(source) {
  if (!source) return ''
  // Keep the editor syntax small and predictable: ____ renders a visible blank.
  const preprocessed = normalizeMarkdownSource(source)
    .replace(/____+/g, '<span class="blank-space">&nbsp;</span>')
  // 使用块级渲染，确保标题、段落、列表和 Markdown 表格不会退化成普通文本。
  const rendered = md.render(preprocessed)
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: ['p','br','strong','em','u','ul','ol','li','table','thead','tbody','tr','th','td','img','span','code','pre','h1','h2','h3','h4','h5','h6'],
    ALLOWED_ATTR: ['src','alt','class','align']
  })
}
