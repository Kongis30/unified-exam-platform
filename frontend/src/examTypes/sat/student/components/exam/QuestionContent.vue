<template>
  <div class="question-content" :class="{ 'highlight-mode': highlightMode }">
    <div class="content-body">
      <!-- 阅读材料区域：当有文字材料或图片材料时显示 -->
      <div v-if="showPassage && hasPassageSection" class="passage-section">
        <div class="passage-content sat-rich-text" :class="{ 'highlightable': highlightMode }" @mouseup="handleTextSelection($event, 'passage')">
          <div v-math v-html="passageHtml" ref="passageHtmlRef" @click="handleImageClick"></div>
          <!-- 显示材料图片（若有），宽度与材料区域一致，点击可预览 -->
          <div v-if="materialImageUrl" class="material-image">
            <img
              :src="materialImageUrl"
              alt="Material"
              @click="emitImagePreview(materialImageUrl)"
            />
          </div>
        </div>
      </div>
      
      <!-- 题目区域 -->
      <div v-if="showQuestionText" class="question-section" :class="{ 'no-passage': !question.passage }">
        <div class="question-text sat-rich-text" :class="{ 'highlightable': highlightMode }" @mouseup="handleTextSelection($event, 'question')">
          <div v-math v-html="questionHtml" ref="questionHtmlRef" @click="handleImageClick"></div>
        </div>
      </div>
    </div>
    
  </div>
</template>

<script>
import { computed, ref, watch, watchEffect } from 'vue'
import { renderMarkdown } from '../../utils/markdown.js'
import { paperEditApi } from '../../api/exam.js'

export default {
  name: 'QuestionContent',
  props: {
    question: {
      type: Object,
      required: true
    },
    questionNumber: {
      type: Number,
      required: true
    },
    highlightMode: {
      type: Boolean,
      default: false
    },
    showQuestionText: {
      type: Boolean,
      default: true
    },
    showPassage: {
      type: Boolean,
      default: true
    },
    savedPassageHtml: {
      type: String,
      default: ''
    },
    savedQuestionHtml: {
      type: String,
      default: ''
    }
  },
  emits: ['toggle-highlight', 'add-note', 'toggle-mark-review', 'save-highlight', 'preview-image'],
  setup(props, { emit }) {
    const passageHtmlRef = ref(null)
    const questionHtmlRef = ref(null)
    const questionTypeBadge = computed(() => {
      switch (props.question.type) {
        case 'reading':
          return 'Reading and Writing'
        case 'math':
          return 'Math'
        default:
          return 'Question'
      }
    })
    
    const formatPassage = (passage) => renderMarkdown(passage)
    // 支持从 question.passage 或 material.content 渲染材料文本
    const passageHtml = computed(() => {
      if (props.savedPassageHtml) return props.savedPassageHtml
      const text = props.question?.passage || props.question?.material?.content || ''
      return formatPassage(text)
    })
    const rawImage = computed(() => props.question?.materialFileUrl || props.question?.material?.fileUrl || props.question?.fileUrl || '')
    const normalize = (u) => {
      if (!u) return ''
      const s = String(u)
      if (s.startsWith('/uploads/')) return s
      if (s.startsWith('uploads/')) return `/${s}`
      return s
    }
    const normalizeImageSrc = (src) => normalize(src)
    const materialImageUrl = computed(() => {
      const u = rawImage.value
      return normalize(u)
    })
    // 备用：当题目中未携带图片URL时，按需拉取题目详情以获得材料图片
    const materialImageUrlRemote = ref('')
    const displayImageUrl = computed(() => materialImageUrl.value || materialImageUrlRemote.value)
    const fetchedFor = ref(null)
    watch(() => props.question?.id, async (qid) => {
      try {
        materialImageUrlRemote.value = ''
        fetchedFor.value = null
        // 若已有URL则不再拉取
        if (materialImageUrl.value) return
        if (!qid) return
        const res = await paperEditApi.getQuestionDetail(qid)
        const mat = res?.data?.material || res?.material || null
        const url = normalize(mat?.fileUrl || '')
        if (url) {
          materialImageUrlRemote.value = url
          fetchedFor.value = qid
          console.log('[QuestionContent] fetched material.fileUrl from detail', { qid, url })
        }
      } catch (e) {
        console.warn('[QuestionContent] fetch question detail failed', e)
      }
    }, { immediate: true })
    const questionHtml = computed(() => renderMarkdown(props.question.question))
    const hasPassageSection = computed(() => {
      const passage = props.question?.passage
      const text = props.question?.material?.content
      const img = displayImageUrl.value || rawImage.value
      const hasText = !!((passage && String(passage).trim()) || (text && String(text).trim()))
      const hasImage = !!img
      // 仅当存在文本或图片时显示材料文本区域
      return hasText || hasImage
    })

    // Debug: 打印材料图片字段与规范化后的URL，帮助定位未显示原因
    watchEffect(() => {
      try {
        console.log('[QuestionContent] material debug', {
          questionId: props.question?.id,
          passageExists: !!(props.question?.passage && String(props.question.passage).trim()),
          rawImage: rawImage.value,
          normalizedUrl: materialImageUrl.value,
          materialObj: props.question?.material || null
        })
      } catch (e) {}
    })
    
    const removeHighlightWrapper = (el) => {
      if (!el || !el.parentNode) return
      const parent = el.parentNode
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    }
    const handleTextSelection = (event, area) => {
      if (!props.highlightMode) return
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      // 限定选择范围只能在纯文本容器内，避免影响图片和表格
      const contentRoot = area === 'passage' ? passageHtmlRef.value : questionHtmlRef.value
      if (!contentRoot) return
      if (!contentRoot.contains(selection.anchorNode) || !contentRoot.contains(selection.focusNode)) {
        // 选择不在文本容器内（可能选到图片或容器外部），忽略
        return
      }
      // 阻止对图片与表格的高亮，避免结构破坏与图片重复
      const frag = range.cloneContents()
      if (frag && frag.querySelector && frag.querySelector('img, table, tr, td, th')) {
        // 忽略包含图片或表格结构的选择
        selection.removeAllRanges()
        return
      }
      // 如果当前选择在已高亮的区域内，则取消该高亮
      const anchorHighlight = selection.anchorNode?.parentElement?.closest('.highlighted-text')
      const focusHighlight = selection.focusNode?.parentElement?.closest('.highlighted-text')
      if (anchorHighlight || focusHighlight) {
        removeHighlightWrapper(anchorHighlight || focusHighlight)
        selection.removeAllRanges()
        const html = contentRoot?.innerHTML || ''
        emit('save-highlight', { type: area, questionNumber: props.questionNumber, html })
        return
      }
      // 否则新增高亮
      if (selection.toString().trim()) {
        const span = document.createElement('span')
        span.className = 'highlighted-text'
        span.style.backgroundColor = '#ffe082'
        span.style.padding = '2px 0'
        try {
          range.surroundContents(span)
        } catch (e) {
          // 回退到只插入纯文本高亮，避免复制复杂结构（如表格、图片）
          const text = selection.toString()
          if (!text) {
            selection.removeAllRanges()
            return
          }
          const textNode = document.createTextNode(text)
          span.appendChild(textNode)
          range.deleteContents()
          range.insertNode(span)
        }
        selection.removeAllRanges()
        const html = contentRoot?.innerHTML || ''
        emit('save-highlight', { type: area, questionNumber: props.questionNumber, html })
      }
    }
    
    const toggleHighlight = () => {
      emit('toggle-highlight')
    }
    
    const addNote = () => {
      emit('add-note')
    }
    
    const toggleMarkForReview = () => {
      emit('toggle-mark-review')
    }

    const emitImagePreview = (src) => {
      const normalized = normalizeImageSrc(src)
      if (normalized) emit('preview-image', normalized)
    }

    const handleImageClick = (event) => {
      const target = event?.target
      if (!target || target.tagName !== 'IMG') return
      emitImagePreview(target.getAttribute('src') || target.src)
    }
    
    return {
      questionTypeBadge,
      formatPassage,
      passageHtml,
      passageHtmlRef,
      materialImageUrl: displayImageUrl,
      questionHtml,
      questionHtmlRef,
      hasPassageSection,
      handleTextSelection,
      handleImageClick,
      emitImagePreview,
      toggleHighlight,
      addNote,
      toggleMarkForReview
    }
  }
}
</script>

<style scoped>
.question-content {
  flex: 1;
  background-color: white;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px;
}

.content-body {
  flex: 1;
  overflow-y: auto;
  padding-right: 10px;
  /* 轻量滚动条样式（浅灰、窄宽） */
  scrollbar-width: thin; /* Firefox */
  scrollbar-color: #e4e7ed transparent; /* Firefox */
}

/* WebKit 浏览器滚动条样式（内容容器） */
.content-body::-webkit-scrollbar {
  width: 5px; /* 更窄的上下拖动条 */
}
.content-body::-webkit-scrollbar-track {
  background: transparent;
}
.content-body::-webkit-scrollbar-thumb {
  background-color: #e4e7ed; /* 浅灰色 */
  border-radius: 3px;
}
.content-body::-webkit-scrollbar-thumb:hover {
  background-color: #d3dae6; /* 略深但仍然浅色 */
}

/* 高亮模式样式（移除容器背景变色，仅对选中文本着色） */

.highlightable {
  cursor: text;
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

.passage-section {
  margin-bottom: 24px;
}

.passage-content {
  font-size: calc(17px * var(--exam-font-scale, 1));
  line-height: 1.6;
  color: #333;
  text-align: left;
  overflow-y: auto; /* 图片或文本过长时，垂直滚动 */
  /* 轻量滚动条样式（浅色、窄宽，尽量无感） */
  scrollbar-width: thin; /* Firefox */
  scrollbar-color: #e4e7ed transparent; /* Firefox */
}

/* WebKit 浏览器滚动条样式 */
.passage-content::-webkit-scrollbar {
  width: 6px;
}
.passage-content::-webkit-scrollbar-track {
  background: transparent;
}
.passage-content::-webkit-scrollbar-thumb {
  background-color: #e4e7ed; /* 浅色，与页面主题相近 */
  border-radius: 3px;
}
.passage-content::-webkit-scrollbar-thumb:hover {
  background-color: #d3dae6; /* 略深的浅色，保持低对比 */
}
.passage-content {
  overflow-x: auto; /* 宽表格可横向滚动 */
}

/* 图片材料显示：自适应宽度，居中且与文字间距紧凑 */
.passage-content :deep(img) {
  margin: 4px auto;
  cursor: zoom-in;
}

/* 居中材料图片显示 */
.material-image {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 8px;
}

.material-image img {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  cursor: zoom-in;
}

.question-section {
  margin-bottom: 20px;
}
.question-section.no-passage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
}

.question-text {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  line-height: 1.5;
  margin: 0;
  text-align: center;
}

/* 已移除底部工具栏样式 */

/* 响应式设计 */
@media (max-width: 768px) {
  .question-content {
    padding: 16px;
  }
  
  .passage-content p {
    font-size: calc(16px * var(--exam-font-scale, 1));
  }
  
  .question-text {
    font-size: calc(16px * var(--exam-font-scale, 1));
  }
  
  .question-toolbar {
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .tool-button {
    font-size: 12px;
    padding: 6px 10px;
  }
}

@media (max-width: 480px) {
  .question-content {
    padding: 12px;
  }
  
  .passage-content p {
    font-size: calc(15px * var(--exam-font-scale, 1));
    line-height: 1.5;
  }
  
  .question-text {
    font-size: calc(15px * var(--exam-font-scale, 1));
  }
}
</style>
