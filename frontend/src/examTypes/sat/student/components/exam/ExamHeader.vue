<template>
  <div class="exam-header">
    <div class="header-left">
      <label v-if="previewMode && previewModules.length > 1" class="preview-module-select">
        <span>Module preview</span>
        <select :value="selectedPreviewModule" @change="$emit('select-preview-module', $event.target.value)">
          <option v-for="module in previewModules" :key="module.id" :value="module.id">{{ module.title }}</option>
        </select>
      </label>
      <div v-else class="section-title">{{ moduleName }}</div>
    </div>
    
    <div class="header-center">
      <div v-if="reviewMode" class="review-mode-badge">Review Mode</div>
      <div v-else-if="previewMode" class="review-mode-badge">Paper Preview</div>
      <div v-else class="timer-container">
        <div class="timer" v-if="!isTimeHidden">
          <span class="time-text">{{ formattedTime }}</span>
        </div>
        <div class="timer-icon-only" v-else>
          <svg viewBox="0 0 24 24" width="24" height="24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
        </div>
        <button class="hide-time-btn" @click="toggleTimeVisibility">
          {{ isTimeHidden ? 'Show' : 'Hide' }}
        </button>
      </div>
    </div>
    
    <div class="header-right">
      <button 
        v-if="!reviewMode"
        class="highlights-btn"
        :class="{ 'active': highlightMode }"
        @click="toggleHighlightMode"
      >
        Highlights & Notes
      </button>

      <button class="calculator-btn" @click="openCalculator">
        Calculator
      </button>

      <div class="font-selector" ref="fontDropdown">
        <button
          class="font-button"
          type="button"
          title="Font Size"
          aria-label="Font Size"
          @click="toggleFontMenu"
        >
          A
        </button>
        <div v-if="fontMenuOpen" class="tool-dropdown">
          <button class="tool-option" :class="{ active: fontScale === 1 }" type="button" @click="setFontScale(1)">
            1.0x
          </button>
          <button class="tool-option" :class="{ active: fontScale === 1.15 }" type="button" @click="setFontScale(1.15)">
            1.15x
          </button>
          <button class="tool-option" :class="{ active: fontScale === 1.3 }" type="button" @click="setFontScale(1.3)">
            1.3x
          </button>
          <button class="tool-option" :class="{ active: fontScale === 1.45 }" type="button" @click="setFontScale(1.45)">
            1.45x
          </button>
          <button class="tool-option" :class="{ active: fontScale === 1.6 }" type="button" @click="setFontScale(1.6)">
            1.6x
          </button>
        </div>
      </div>

      <button class="fullscreen-btn" @click="toggleFullscreen">
        {{ isFullscreen ? 'Exit Fullscreen' : 'Fullscreen' }}
      </button>
      
      <div class="more-dropdown" ref="moreDropdown">
        <button class="more-btn" @click="toggleMoreMenu">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <circle cx="12" cy="12" r="1" fill="currentColor"/>
            <circle cx="19" cy="12" r="1" fill="currentColor"/>
            <circle cx="5" cy="12" r="1" fill="currentColor"/>
          </svg>
        </button>
        
        <div class="dropdown-menu" v-if="showMoreMenu">
          <button class="dropdown-item" @click="showHelp">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" stroke="currentColor" stroke-width="2" fill="none"/>
              <path d="M12 17h.01" stroke="currentColor" stroke-width="2" fill="none"/>
            </svg>
            Help
          </button>
          <button class="dropdown-item exit-item" @click="exitExam">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="2" fill="none"/>
              <polyline points="16,17 21,12 16,7" stroke="currentColor" stroke-width="2" fill="none"/>
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2"/>
            </svg>
            {{ reviewMode ? 'Back to Report' : previewMode ? 'Back to Paper Management' : 'Exit Exam' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from 'vue'

export default {
  name: 'ExamHeader',
  props: {
    examTitle: {
      type: String,
      required: true
    },
    moduleName: {
      type: String,
      default: ''
    },
    currentQuestion: {
      type: Number,
      required: true
    },
    totalQuestions: {
      type: Number,
      required: true
    },
    timeRemaining: {
      type: Number,
      required: true
    },
    highlightMode: {
      type: Boolean,
      default: false
    },
    reviewMode: {
      type: Boolean,
      default: false
    },
    previewMode: {
      type: Boolean,
      default: false
    },
    previewModules: {
      type: Array,
      default: () => []
    },
    selectedPreviewModule: {
      type: [String, Number],
      default: ''
    },
    fontScale: {
      type: Number,
      default: 1
    }
  },
  emits: ['toggle-highlight-mode', 'show-help', 'exit-exam', 'open-calculator', 'change-font-scale', 'select-preview-module'],
  setup(props, { emit }) {
    const isTimeHidden = ref(false)
    // 由父组件控制高亮模式，header仅展示状态并发送切换事件
    const highlightModeState = computed(() => props.highlightMode)
    const showMoreMenu = ref(false)
    const moreDropdown = ref(null)
    const fontMenuOpen = ref(false)
    const fontDropdown = ref(null)
    const isFullscreen = ref(false)
    
    const formattedTime = computed(() => {
      const hours = Math.floor(props.timeRemaining / 3600)
      const minutes = Math.floor((props.timeRemaining % 3600) / 60)
      const seconds = props.timeRemaining % 60
      
      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      } else {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`
      }
    })
    
    const toggleTimeVisibility = () => {
      isTimeHidden.value = !isTimeHidden.value
    }
    
    const toggleHighlightMode = () => {
      emit('toggle-highlight-mode', !props.highlightMode)
    }
    
    const toggleMoreMenu = () => {
      showMoreMenu.value = !showMoreMenu.value
      fontMenuOpen.value = false
    }
    
    const showHelp = () => {
      showMoreMenu.value = false
      emit('show-help')
    }
    
    const exitExam = () => {
      showMoreMenu.value = false
      emit('exit-exam')
    }

    const openCalculator = () => {
      emit('open-calculator')
    }

    const toggleFontMenu = () => {
      fontMenuOpen.value = !fontMenuOpen.value
      showMoreMenu.value = false
    }

    const setFontScale = (scale) => {
      emit('change-font-scale', scale)
      fontMenuOpen.value = false
    }

    const toggleFullscreen = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen()
          isFullscreen.value = true
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen()
            isFullscreen.value = false
          }
        }
      } catch (err) {
        console.error('Error toggling fullscreen:', err)
      }
    }
    
    // 监听全屏变化事件，处理按ESC退出的情况
    const handleFullscreenChange = () => {
      isFullscreen.value = !!document.fullscreenElement
    }
    
    // 点击外部关闭下拉菜单
    const handleClickOutside = (event) => {
      if (moreDropdown.value && !moreDropdown.value.contains(event.target)) {
        showMoreMenu.value = false
      }
      if (fontDropdown.value && !fontDropdown.value.contains(event.target)) {
        fontMenuOpen.value = false
      }
    }
    
    onMounted(() => {
      // Check if already in fullscreen on mount
      if (document.fullscreenElement) {
        isFullscreen.value = true
      }
      
      document.addEventListener('click', handleClickOutside)
      document.addEventListener('fullscreenchange', handleFullscreenChange)
    })
    
    onUnmounted(() => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    })
    
    return {
      isTimeHidden,
      highlightMode: highlightModeState,
      showMoreMenu,
      moreDropdown,
      fontMenuOpen,
      fontDropdown,
      formattedTime,
      toggleTimeVisibility,
      toggleHighlightMode,
      toggleMoreMenu,
      showHelp,
      exitExam,
      openCalculator,
      toggleFontMenu,
      setFontScale,
      toggleFullscreen,
      isFullscreen
    }
  }
}
</script>

<style scoped>
.exam-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background-color: #1e3a8a;
  color: white;
  min-height: 60px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-left {
  flex: 1;
  display: flex;
  align-items: center;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: white;
}

.preview-module-select {
  display: grid;
  gap: 3px;
  color: rgb(255 255 255 / 76%);
  font-size: 11px;
  font-weight: 600;
}

.preview-module-select select {
  max-width: 260px;
  border: 0;
  padding: 0;
  color: white;
  background: transparent;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
}

.preview-module-select option {
  color: #202938;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.timer-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.review-mode-badge {
  padding: 8px 16px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  font-weight: 600;
}

.timer {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: rgba(255, 255, 255, 0.1);
  padding: 8px 16px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.timer-icon-only {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.1);
  padding: 8px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
}

.time-text {
  font-size: 16px;
  font-weight: 600;
  color: white;
  font-family: 'Courier New', monospace;
}

.hide-time-btn {
  padding: 4px 8px;
  background-color: transparent;
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hide-time-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
}

.header-right {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}

.highlights-btn {
  padding: 8px 16px;
  background-color: transparent;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.highlights-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.highlights-btn.active {
  background-color: #fbbf24;
  color: #1e3a8a;
  border-color: #fbbf24;
}

.calculator-btn {
  padding: 8px 16px;
  background-color: transparent;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.calculator-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.font-selector {
  position: relative;
}

.font-button {
  padding: 8px 12px;
  background-color: transparent;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.font-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.tool-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  min-width: 132px;
  overflow: hidden;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tool-option {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: white;
  color: #2c3e50;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  transition: background-color 0.2s ease;
}

.tool-option:hover,
.tool-option.active {
  background: #1e3a8a;
  color: white;
}

.fullscreen-btn {
  padding: 8px 16px;
  background-color: transparent;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.fullscreen-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.more-dropdown {
  position: relative;
}

.more-btn {
  padding: 8px;
  background-color: transparent;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.more-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 150px;
  z-index: 1000;
  overflow: hidden;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  background-color: transparent;
  color: #2c3e50;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  text-align: left;
}

.dropdown-item:hover {
  background-color: #f8f9fa;
}

.dropdown-item.exit-item {
  color: #e74c3c;
  border-top: 1px solid #e0e0e0;
}

.dropdown-item.exit-item:hover {
  background-color: #fef2f2;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .exam-header {
    padding: 10px 16px;
    flex-direction: column;
    gap: 12px;
    min-height: auto;
  }
  
  .header-left,
  .header-center,
  .header-right {
    flex: none;
    width: 100%;
  }
  
  .header-left {
    justify-content: center;
  }
  
  .header-center {
    order: -1;
  }
  
  .header-right {
    justify-content: center;
    gap: 8px;
  }
  
  .highlights-btn {
    padding: 6px 12px;
    font-size: 12px;
  }

  .font-button {
    padding: 6px 10px;
    font-size: 14px;
  }
  
  .timer-container {
    gap: 6px;
  }
}

@media (max-width: 480px) {
  .exam-header {
    padding: 8px 12px;
  }
  
  .section-title {
    font-size: 14px;
  }
  
  .time-text {
    font-size: 14px;
  }
  
  .timer {
    padding: 6px 12px;
  }
  
  .header-right {
    flex-wrap: wrap;
    gap: 6px;
  }
  
  .highlights-btn {
    font-size: 11px;
    padding: 4px 8px;
  }

  .font-button {
    font-size: 13px;
    padding: 4px 8px;
  }
}
</style>
