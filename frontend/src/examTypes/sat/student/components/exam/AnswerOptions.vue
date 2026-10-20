<template>
  <div class="answer-options" :class="{ 'highlight-mode': highlightMode, 'constrain': constrainWidth, 'readonly': readOnly }">
    <div class="options-header">
      <div class="question-info">
        <div class="question-number-badge">{{ questionNumber }}</div>
        <button 
          v-if="!readOnly"
          class="mark-review-btn"
          :class="{ 'marked': isMarkedForReview }"
          @click="toggleMarkForReview"
        >
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" 
                  :fill="isMarkedForReview ? '#e74c3c' : 'none'"
                  :stroke="isMarkedForReview ? '#e74c3c' : 'currentColor'"
                  stroke-width="2"/>
          </svg>
          Mark for Review
        </button>
      </div>
      <h3
        v-if="showQuestionHeader"
        class="options-title sat-rich-text"
        :class="{ 'highlightable': highlightMode }"
        @mouseup="handleTextSelection($event)"
        @click="handleQuestionImageClick"
      >
        <div v-math v-html="questionHtml"></div>
      </h3>
    </div>
    
    <div class="options-list">
      <!-- 正常选项渲染：已规范化为数组的 {id, text} -->
      <template v-if="normalizedOptions.length > 0">
        <div 
          v-for="option in normalizedOptions" 
          :key="option.id"
          class="option-row"
        >
          <div
            class="option-item"
            :class="{ 
              'selected': selectedAnswer === option.id,
              'correct-option': readOnly && correctAnswerText === option.id,
              'hover': hoveredOption === option.id,
              'eliminated': isEliminated(option.id)
            }"
            @click="selectOption(option.id)"
            @mouseenter="hoveredOption = option.id"
            @mouseleave="hoveredOption = null"
          >
            <div class="option-radio">
              <div class="radio-circle">
                <div v-if="selectedAnswer === option.id" class="radio-dot"></div>
              </div>
              <span class="option-label">{{ option.id }}</span>
            </div>
            <div class="option-text" v-math v-html="formatOption(option.text)"></div>
          </div>
          <button 
            v-if="!readOnly"
            class="strike-btn" 
            @click="toggleEliminate(option.id)" 
            :aria-pressed="isEliminated(option.id)"
            :aria-label="isEliminated(option.id) ? 'Unstrike option' : 'Strike option'"
            title="Strike"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none">
              <path d="M4 12h16" stroke="currentColor"/>
            </svg>
          </button>
        </div>
      </template>

      <!-- 填空题：提供输入框 -->
      <template v-else-if="isFillBlank">
        <div class="fill-blank-input">
          <el-input
            v-model="freeAnswer"
            placeholder="Type your answer here"
            clearable
            :disabled="readOnly"
            @input="onFreeAnswerChange"
          />
        </div>
      </template>

      <!-- 无选项的选择题或其它题型：给出提示与输入框作为兜底 -->
      <template v-else>
        <div class="fill-blank-input">
          <el-input
            v-model="freeAnswer"
            placeholder="Type your answer here"
            clearable
            :disabled="readOnly"
            @input="onFreeAnswerChange"
          />
        </div>
      </template>
    </div>

    <div v-if="readOnly && showReviewAnswer" class="review-answer-panel">
      <div><strong>Your Answer:</strong> {{ selectedAnswer || '-' }}</div>
      <div><strong>Correct Answer:</strong> {{ correctAnswerText || '-' }}</div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue'
import { renderMarkdown } from '../../utils/markdown.js'

export default {
  name: 'AnswerOptions',
  props: {
    question: {
      type: Object,
      required: true
    },
    showQuestionHeader: {
      type: Boolean,
      default: true
    },
    selectedAnswer: {
      type: String,
      default: null
    },
    highlightMode: {
      type: Boolean,
      default: false
    },
    questionNumber: {
      type: Number,
      required: true
    },
    isReviewed: {
      type: Boolean,
      default: false
    },
    constrainWidth: {
      type: Boolean,
      default: false
    },
    savedQuestionHtml: {
      type: String,
      default: ''
    },
    readOnly: {
      type: Boolean,
      default: false
    },
    showReviewAnswer: {
      type: Boolean,
      default: true
    },
    correctAnswer: {
      type: [String, Number],
      default: ''
    }
  },
  emits: ['answer-selected', 'toggle-mark-review', 'save-highlight', 'preview-image'],
  setup(props, { emit }) {
    const hoveredOption = ref(null)
    const confidenceLevel = ref('')
    const isMarkedForReview = ref(false)
    const eliminatedOptions = ref(new Set())
    const isEliminated = (id) => eliminatedOptions.value.has(id)
    const toggleEliminate = (id) => {
      if (props.readOnly) return
      const set = eliminatedOptions.value
      const willEliminate = !set.has(id)
      if (willEliminate) set.add(id)
      else set.delete(id)
      // 触发响应式更新
      eliminatedOptions.value = new Set(set)
      // 如果当前选项被划掉且已选中，则清除选中
      if (willEliminate && props.selectedAnswer === id) {
        emit('answer-selected', null)
      }
    }
    
    // 切换题目时，清空已划掉的选项
    watch(() => props.question, () => {
      eliminatedOptions.value = new Set()
      hoveredOption.value = null
    })

    // 同步复查标记状态
    watch(() => props.isReviewed, (val) => {
      isMarkedForReview.value = !!val
    }, { immediate: true })
    
    const removeHighlightWrapper = (el) => {
      if (!el || !el.parentNode) return
      const parent = el.parentNode
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    }
    const handleTextSelection = (event) => {
      if (!props.highlightMode) return
      const container = event?.currentTarget
      // 仅允许在问题标题处进行高亮
      if (!container || !container.classList.contains('options-title')) return
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const anchorHighlight = selection.anchorNode?.parentElement?.closest('.highlighted-text')
      const focusHighlight = selection.focusNode?.parentElement?.closest('.highlighted-text')
      if (anchorHighlight || focusHighlight) {
        removeHighlightWrapper(anchorHighlight || focusHighlight)
        selection.removeAllRanges()
        const html = container.innerHTML || ''
        emit('save-highlight', { type: 'question', questionNumber: props.questionNumber, html })
        return
      }
      if (selection.toString().trim()) {
        const span = document.createElement('span')
        span.className = 'highlighted-text'
        span.style.backgroundColor = '#ffe082'
        span.style.padding = '2px 0'
        try {
          range.surroundContents(span)
        } catch (e) {
          const frag = range.cloneContents()
          span.appendChild(frag)
          range.deleteContents()
          range.insertNode(span)
        }
        selection.removeAllRanges()
        const html = container.innerHTML || ''
        emit('save-highlight', { type: 'question', questionNumber: props.questionNumber, html })
      }
    }
    
    const selectOption = (optionId) => {
      if (props.readOnly) return
      if (isEliminated(optionId)) return
      if (!props.highlightMode) {
        emit('answer-selected', optionId)
      }
    }

    const normalizeImageSrc = (src) => {
      if (!src) return ''
      const s = String(src)
      const apiBase = import.meta.env.VITE_API_BASE_URL || '/sat-api'
      if (s.startsWith('/uploads/')) return `${apiBase}${s}`
      if (s.startsWith('uploads/')) return `${apiBase}/${s}`
      return s
    }

    const handleQuestionImageClick = (event) => {
      const target = event?.target
      if (!target || target.tagName !== 'IMG') return
      const src = normalizeImageSrc(target.getAttribute('src') || target.src)
      if (src) emit('preview-image', src)
    }
    
    const clearAnswer = () => {
      emit('answer-selected', null)
    }
    
    const toggleMarkForReview = () => {
      if (props.readOnly) return
      isMarkedForReview.value = !isMarkedForReview.value
      emit('toggle-mark-review')
    }
    
    // 统一的 Markdown 渲染（与材料一致，使用 utils/markdown）
    const formatQuestion = (text) => renderMarkdown(text)
    const formatOption = (text) => renderMarkdown(text).replace(
      /(<img\b[^>]*\bsrc=")(\/*uploads\/[^\"]+)(")/gi,
      (_match, prefix, src, suffix) => `${prefix}${normalizeImageSrc(src)}${suffix}`
    )
    const questionHtml = computed(() => props.savedQuestionHtml || formatQuestion(props.question.question))

    // 题型识别：填空题
    const isFillBlank = computed(() => String(props.question?.type || '').toLowerCase() === 'fill_blank')
    const correctAnswerText = computed(() => String(props.correctAnswer || ''))

    // 规范化选项：将字符串/对象/数组统一为 [{ id: 'A', text: '...' }, ...]
    const normalizedOptions = computed(() => {
      const raw = props.question?.options
      if (!raw) return []
      try {
        // 若为字符串（常见于后端 JSON 字段），尝试解析
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        // 若为对象映射 { A: '...', B: '...' }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const order = ['A', 'B', 'C', 'D', 'E', 'F']
          return order
            .filter(k => parsed[k] && String(parsed[k]).trim())
            .map(k => ({ id: k, text: parsed[k] }))
        }
        // 若已为数组，且成员包含 id/text
        if (Array.isArray(parsed)) {
          return parsed
            .filter(opt => opt && (opt.id || opt.label) && (opt.text || opt.value))
            .map(opt => ({ id: opt.id || opt.label, text: opt.text || opt.value }))
        }
      } catch (e) {
        console.warn('[AnswerOptions] options parse failed:', e)
        return []
      }
      return []
    })

    // 自由输入答案（用于填空题或无选项题）
    const freeAnswer = ref(props.selectedAnswer || '')
    watch(() => props.selectedAnswer, (val) => {
      // 同步外部选中值到输入框（空串视为未答）
      freeAnswer.value = val || ''
    })
    const onFreeAnswerChange = (val) => {
      if (props.readOnly) return
      const v = typeof val === 'string' ? val.trim() : ''
      emit('answer-selected', v || null)
    }
    
    return {
      hoveredOption,
      confidenceLevel,
      isMarkedForReview,
      eliminatedOptions,
      isEliminated,
      toggleEliminate,
      handleTextSelection,
      handleQuestionImageClick,
      selectOption,
      clearAnswer,
      toggleMarkForReview,
      formatQuestion,
      formatOption,
      questionHtml,
      correctAnswerText,
      normalizedOptions,
      isFillBlank,
      freeAnswer,
      onFreeAnswerChange
    }
  }
}
</script>

<style scoped>
/* 高亮模式样式（移除容器背景变色，仅对选中文本着色） */

.highlightable {
  cursor: text !important;
  user-select: text;
}

.highlightable:hover {
  background-color: rgba(255, 243, 205, 0.3);
}

.highlighted-text {
  background-color: #ffe082 !important; /* 更深的高亮颜色 */
  padding: 2px 0 !important;
  border-radius: 2px;
}

.option-item.highlightable {
  cursor: text !important;
}

.option-item.highlightable:hover {
  background-color: rgba(255, 243, 205, 0.3) !important;
  border-color: #ffc107 !important;
}

/* 在高亮模式下，禁用选项文本的选中，避免误触高亮逻辑 */
.answer-options.highlight-mode .option-item .option-text {
  user-select: none;
}

.answer-options {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 24px;
  background-color: white;
}
.answer-options.constrain {
  max-width: 65vw; /* 页面宽度的65% */
  margin: 0 auto; /* 居中显示 */
}

.options-header {
  margin-bottom: 20px;
}

.question-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.question-number-badge {
  background-color: #333;
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(15px * var(--exam-font-scale, 1));
  font-weight: 600;
}

.mark-review-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: white;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #656d76;
  font-size: calc(13px * var(--exam-font-scale, 1));
  cursor: pointer;
  transition: all 0.2s ease;
}

.mark-review-btn:hover {
  background-color: #f6f8fa;
  border-color: #8c959f;
}

.mark-review-btn.marked {
  background-color: #fef2f2;
  border-color: #e74c3c;
  color: #e74c3c;
}

.options-title {
  font-size: calc(17px * var(--exam-font-scale, 1));
  font-weight: 600;
  color: #333;
  margin: 0;
  line-height: 1.4;
}

.options-title :deep(img) {
  max-height: 420px;
  cursor: zoom-in;
}

.options-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fill-blank-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fill-label {
  font-size: calc(15px * var(--exam-font-scale, 1));
  color: #555;
}
.no-options-tip {
  font-size: calc(14px * var(--exam-font-scale, 1));
  color: #888;
}

.option-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: white;
  flex: 1;
  position: relative;
}

.option-item:hover {
  border-color: #3498db;
  background-color: #f8f9fa;
}

.option-item.selected {
  border-color: #3498db;
  background-color: #e3f2fd;
}

.answer-options.readonly .option-item {
  cursor: default;
}

.answer-options.readonly .option-item:hover {
  border-color: #e0e0e0;
  background-color: white;
}

.answer-options.readonly .option-item.selected {
  border-color: #3498db;
  background-color: #e3f2fd;
}

.answer-options.readonly .option-item.correct-option {
  border-color: #67c23a;
  background-color: #f0f9eb;
}

.answer-options.readonly .option-item.selected.correct-option {
  border-color: #67c23a;
  background-color: #e1f3d8;
}

.option-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.radio-circle {
  width: 18px;
  height: 18px;
  border: 2px solid #d0d7de;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.option-item.selected .radio-circle {
  border-color: #3498db;
  background-color: #3498db;
}

.radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: white;
}

.option-label {
  font-weight: 600;
  color: #333;
  font-size: calc(15px * var(--exam-font-scale, 1));
  min-width: 16px;
}

.option-text {
  color: #555;
  line-height: 1.5;
  font-size: calc(15px * var(--exam-font-scale, 1));
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.option-text :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 320px;
  height: auto;
  object-fit: contain;
  margin: 8px 0;
}

.option-item.eliminated {
  pointer-events: none;
  cursor: not-allowed;
  opacity: 0.6;
  filter: grayscale(100%);
}

.option-item.eliminated .option-label,
.option-item.eliminated .option-text {
  text-decoration: line-through;
}

.option-item.eliminated::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  top: 50%;
  border-top: 2px solid #e74c3c;
}

.option-item.eliminated {
  pointer-events: none;
  cursor: not-allowed;
}

.strike-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background-color: #fff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #656d76;
  cursor: pointer;
}

.strike-btn:hover {
  background-color: #f6f8fa;
  border-color: #8c959f;
  color: #24292f;
}

.strike-btn svg path {
  stroke-linecap: round;
  stroke-width: 3;
}

.review-answer-panel {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fafafa;
  color: #303133;
  font-size: calc(15px * var(--exam-font-scale, 1));
  line-height: 1.8;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .answer-options {
    flex: none;
    padding: 16px;
  }
  
  .options-title {
    font-size: calc(16px * var(--exam-font-scale, 1));
  }
  
  .option-item {
    padding: 10px 12px;
    margin-bottom: 6px;
  }
  
  .option-text {
    font-size: calc(14px * var(--exam-font-scale, 1));
  }
}

@media (max-width: 480px) {
  .answer-options {
    padding: 12px;
  }
  
  .question-number-badge {
    width: 20px;
    height: 20px;
    font-size: calc(13px * var(--exam-font-scale, 1));
  }
  
  .mark-review-btn {
    font-size: calc(12px * var(--exam-font-scale, 1));
    padding: 4px 8px;
  }
  
  .options-title {
    font-size: calc(15px * var(--exam-font-scale, 1));
  }
  
  .option-item {
    padding: 8px 10px;
  }
  
  .option-text {
    font-size: calc(13px * var(--exam-font-scale, 1));
  }
}
</style>
