import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// SAT/PSAT 试题、材料和导出共用的 Markdown 渲染器。
const md = new MarkdownIt({
  html: true,
  linkify: true,
  // 材料编辑器中的每个换行都代表原文排版，考试界面和 PDF 均保留为换行。
  breaks: true,
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

// 代码块内的 ++...++ 是应用自己的下划线标记；其余内容仍按代码文本转义输出。
function renderCodeText(source) {
  const markerPattern = /\+\+([^\n]+?)\+\+/g
  let output = ''
  let cursor = 0
  let match

  while ((match = markerPattern.exec(source))) {
    output += md.utils.escapeHtml(source.slice(cursor, match.index))
    output += `<u>${md.utils.escapeHtml(match[1])}</u>`
    cursor = markerPattern.lastIndex
  }

  return output + md.utils.escapeHtml(source.slice(cursor))
}

// markdown-it 默认会转义整个代码块；覆盖输出只为识别应用的下划线标记，并保留代码块布局。
md.renderer.rules.code_block = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  return `<pre${renderer.renderAttrs(token)}><code>${renderCodeText(token.content)}</code></pre>\n`
}
md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : ''
  const language = info ? info.split(/(\s+)/g)[0] : ''
  const attributes = token.attrs ? token.attrs.slice() : []

  if (info) {
    const classIndex = attributes.findIndex(([name]) => name === 'class')
    if (classIndex < 0) attributes.push(['class', `${options.langPrefix}${language}`])
    else attributes[classIndex] = [attributes[classIndex][0], `${attributes[classIndex][1]} ${options.langPrefix}${language}`]
  }

  const codeToken = { attrs: attributes }
  return `<pre><code${renderer.renderAttrs(codeToken)}>${renderCodeText(token.content)}</code></pre>\n`
}

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

// 由考试材料、答案选项和纸卷导出页调用；输出经过白名单净化的 HTML。
export function renderMarkdown(source) {
  if (!source) return ''
  const preprocessed = normalizeMarkdownSource(source)
    .replace(/____+/g, '<span class="blank-space">&nbsp;</span>')
  const rendered = md.render(preprocessed)
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'span', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    ALLOWED_ATTR: ['src', 'alt', 'class', 'align'],
  })
}
