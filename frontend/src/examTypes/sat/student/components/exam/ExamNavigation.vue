<template>
  <div class="exam-navigation">
    <!-- 底部导航栏 -->
    <div class="bottom-nav">
      <!-- 左侧：用户信息和题目进度 -->
      <div class="nav-left">
        <div class="user-info">{{ studentName }}</div>
      </div>
      
      <!-- 中间：题号选择按钮 -->
      <div class="nav-center">
        <button class="question-selector-btn" @click="toggleQuestionPanel">
          Question {{ currentQuestion }} of {{ totalQuestions }}
          <span class="chevron" :class="{ open: showQuestionPanel }">▾</span>
        </button>
      </div>
      
      <!-- 右侧：导航按钮 -->
      <div class="nav-right">
        <button 
          v-if="currentQuestion < totalQuestions"
          class="nav-button next-button"
          @click="$emit('next-question')"
        >
          Next
        </button>
        <button
          v-else-if="reviewMode"
          class="nav-button review-back-button"
          @click="$emit('close-review')"
        >
          Back to Report
        </button>
        <button 
          v-else
          class="nav-button submit-button"
          @click="$emit('submit-exam')"
        >
          Submit
        </button>
      </div>
    </div>
    
    <!-- 题目状态面板（居中小弹窗） -->
    <div v-if="showQuestionPanel" class="question-status-panel">
      <div class="panel-header">
        <h3 class="panel-title">Section 1: Reading and Writing Questions</h3>
        <button class="close-panel-btn" @click="showQuestionPanel = false">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </div>
      
      <div class="status-legend">
        <div class="legend-item">
          <div class="legend-icon current"></div>
          <span>Current</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon unanswered"></div>
          <span>Unanswered</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon for-review"></div>
          <span>For Review</span>
        </div>
      </div>
      
      <div class="question-grid">
        <button
          v-for="(status, index) in questionStatus"
          :key="index + 1"
          class="question-status-btn"
          :class="{
            'current': status.current,
            'answered': status.answered && !status.current,
            'reviewed': status.reviewed,
            'unanswered': !status.answered && !status.current && !status.reviewed
          }"
          @click="navigateToQuestion(index + 1)"
        >
          {{ index + 1 }}
        </button>
      </div>
      
      <div class="panel-footer">
        <button class="submit-btn" @click="reviewMode ? closeReview() : submitExam()">
          {{ reviewMode ? 'Back to Report' : 'Submit' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, ref } from 'vue'
import { authState } from '@/auth'

export default {
  name: 'ExamNavigation',
  props: {
    currentQuestion: {
      type: Number,
      required: true
    },
    totalQuestions: {
      type: Number,
      required: true
    },
    questionStatus: {
      type: Array,
      required: true
    },
    reviewMode: {
      type: Boolean,
      default: false
    }
  },
  emits: [
    'question-navigate', 
    'previous-question', 
    'next-question', 
    'toggle-review',
    'submit-exam',
    'close-review'
  ],
  setup(props, { emit }) {
    const showQuestionPanel = ref(false)
    const studentName = computed(() => authState.user?.realName?.trim() || authState.user?.username || 'Student')
    
    const toggleQuestionPanel = () => {
      showQuestionPanel.value = !showQuestionPanel.value
    }
    
    const navigateToQuestion = (questionNumber) => {
      emit('question-navigate', questionNumber)
      // 选择后关闭面板，避免干扰
      showQuestionPanel.value = false
    }
    
    const submitExam = () => {
      emit('submit-exam')
      // 提交后关闭面板
      showQuestionPanel.value = false
    }

    const closeReview = () => {
      emit('close-review')
      showQuestionPanel.value = false
    }
    
    return {
      showQuestionPanel,
      studentName,
      toggleQuestionPanel,
      navigateToQuestion,
      submitExam,
      closeReview
    }
  }
}
</script>

<style scoped>
.exam-navigation {
  position: relative;
  background-color: white;
}

/* 底部导航栏 */
.bottom-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background-color: #f8f9fa;
  border-top: 1px solid #e0e0e0;
  min-height: 60px;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.user-info {
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
}

.nav-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.question-selector-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 20px;
  color: #2c3e50;
  font-size: 14px;
  cursor: pointer;
}

.question-selector-btn:hover {
  background-color: #f6f8fa;
  border-color: #8c959f;
}

.chevron {
  font-size: 14px;
  transition: transform 0.2s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-button {
  padding: 10px 20px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 80px;
}

.nav-button:hover:not(:disabled) {
  background-color: #2980b9;
  transform: translateY(-1px);
}

.nav-button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
  transform: none;
}

.submit-button {
  background-color: #2ecc71;
}

.submit-button:hover:not(:disabled) {
  background-color: #27ae60;
}

.review-back-button {
  background-color: #6c757d;
}

.review-back-button:hover:not(:disabled) {
  background-color: #5a6268;
}

/* 题目状态面板 */
.question-status-panel {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 20px 24px;
  max-height: none;
  overflow: visible;
  z-index: 1000;
  width: 560px;
}

.question-status-panel::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-top: 12px solid white;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1));
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e0e0e0;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
  margin: 0;
}

.close-panel-btn {
  background: none;
  border: none;
  color: #656d76;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-panel-btn:hover {
  background-color: #f0f0f0;
  color: #2c3e50;
}

.status-legend {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #656d76;
}

.legend-icon {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid #d0d7de;
}

.legend-icon.current {
  background-color: #3498db;
  border-color: #3498db;
}

.legend-icon.unanswered {
  background-color: white;
  border-color: #d0d7de;
}

.legend-icon.for-review {
  background-color: #e74c3c;
  border-color: #e74c3c;
}

.question-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 12px;
  margin-bottom: 20px;
  max-width: 400px;
}

.question-status-btn {
  width: 40px;
  height: 40px;
  border: 2px solid #d0d7de;
  border-radius: 6px;
  background-color: white;
  color: #2c3e50;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.question-status-btn:hover {
  border-color: #3498db;
  background-color: #f8f9fa;
}

.question-status-btn.current {
  background-color: #3498db;
  border-color: #3498db;
  color: white;
}

.question-status-btn.answered {
  background-color: #27ae60;
  border-color: #27ae60;
  color: white;
}

.question-status-btn.reviewed {
  background-color: #e74c3c;
  border-color: #e74c3c;
  color: white;
}

.question-status-btn.unanswered {
  background-color: white;
  border-color: #d0d7de;
  color: #656d76;
}

.panel-footer {
  display: flex;
  justify-content: center;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.submit-btn {
  padding: 10px 20px;
  background-color: #007bff;
  border: 1px solid #007bff;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover {
  background-color: #0056b3;
  border-color: #0056b3;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .bottom-nav {
    padding: 12px 16px;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }
  
  .nav-left {
    justify-content: center;
    gap: 16px;
  }
  
  .nav-right {
    justify-content: center;
  }
  
  .question-status-panel {
    padding: 16px;
  }
  
  .question-grid {
    grid-template-columns: repeat(6, 1fr);
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .nav-left {
    flex-direction: column;
    gap: 8px;
    text-align: center;
  }
  
  .question-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  
  .question-status-btn {
    width: 36px;
    height: 36px;
    font-size: 12px;
  }
}
</style>
