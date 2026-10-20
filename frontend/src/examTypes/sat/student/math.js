import { nextTick } from 'vue'

export function registerMathDirective(app) {
  const tryRender = (el, attempts = 20) => {
    const doRender = () => {
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true }
          ],
          throwOnError: false,
          strict: false
        })
      } catch (e) {
        console.warn('KaTeX render error:', e)
      }
    }
    if (typeof window !== 'undefined' && typeof window.renderMathInElement === 'function') {
      // 等待内容插入到 DOM 后再渲染，避免 v-html 更新时错过
      requestAnimationFrame(doRender)
    } else if (attempts > 0) {
      setTimeout(() => tryRender(el, attempts - 1), 200)
    }
  }

  app.directive('math', {
    mounted(el) {
      nextTick(() => tryRender(el))
    },
    updated(el) {
      nextTick(() => tryRender(el))
    }
  })
}