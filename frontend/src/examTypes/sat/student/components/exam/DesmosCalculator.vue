<template>
  <div
    v-if="visible"
    class="desmos-wrapper"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
  >
    <div class="desmos-header" @mousedown="startDrag" @mouseup="stopDrag">
      <div class="mode-toggle" aria-label="Calculator Mode">
        <button
          class="toggle-btn"
          :class="{ active: mode === 'graphing' }"
          @click="setMode('graphing')"
        >Graphing</button>
        <button
          class="toggle-btn"
          :class="{ active: mode === 'scientific' }"
          @click="setMode('scientific')"
        >Scientific</button>
      </div>
      <div class="header-actions">
        <button class="header-btn" @click="$emit('close')" aria-label="Close">×</button>
      </div>
    </div>
    <!-- 预载两个 iframe，切换时不重新加载 -->
    <iframe
      class="desmos-iframe"
      v-show="mode==='graphing'"
      src="https://www.desmos.com/calculator?lang=en"
      title="Desmos Graphing Calculator"
      frameborder="0"
      loading="eager"
      allow="fullscreen"
    ></iframe>
    <iframe
      class="desmos-iframe"
      v-show="mode==='scientific'"
      src="https://www.desmos.com/scientific?lang=en"
      title="Desmos Scientific Calculator"
      frameborder="0"
      loading="eager"
      allow="fullscreen"
    ></iframe>
  </div>
</template>

<script>
import { ref, onUnmounted } from 'vue'

export default {
  name: 'DesmosCalculator',
  props: {
    visible: { type: Boolean, default: false }
  },
  emits: ['close'],
  setup(props) {
    const mode = ref('graphing') // 'graphing' | 'scientific'
    const dragging = ref(false)
    const dragOffset = ref({ x: 0, y: 0 })
    const position = ref({ top: 100, left: 100 })

    const setMode = async (m) => {
      if (mode.value === m) return
      mode.value = m
    }


    const startDrag = (e) => {
      dragging.value = true
      const rect = e.currentTarget?.parentElement?.getBoundingClientRect()
      dragOffset.value = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      }
      document.addEventListener('mousemove', onDrag)
      document.addEventListener('mouseup', stopDrag)
    }

    const onDrag = (e) => {
      if (!dragging.value) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = 420
      const height = 520
      let left = e.clientX - dragOffset.value.x
      let top = e.clientY - dragOffset.value.y
      // 约束在视口内
      left = Math.max(0, Math.min(left, vw - width))
      top = Math.max(0, Math.min(top, vh - height))
      position.value = { top, left }
    }

    const stopDrag = () => {
      dragging.value = false
      document.removeEventListener('mousemove', onDrag)
      document.removeEventListener('mouseup', stopDrag)
    }

    onUnmounted(() => {
      stopDrag()
    })

    return {
      mode,
      setMode,
      position,
      startDrag,
      stopDrag
    }
  }
}
</script>

<style scoped>
.desmos-wrapper {
  position: fixed;
  z-index: 2000;
  width: 420px;
  height: 520px;
  background: #ffffff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  overflow: hidden;
}
.desmos-header {
  height: 40px;
  background: #1e3a8a;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  cursor: move;
}
.desmos-iframe { height: calc(100% - 40px); width: 100%; background: #fff; }
.mode-toggle {
  display: flex;
  gap: 8px;
}
.toggle-btn {
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 16px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.toggle-btn.active {
  background: #fff;
  color: #1e3a8a;
}
.header-actions { display: flex; gap: 8px; }
.header-btn {
  background: transparent;
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 18px;
}

</style>
