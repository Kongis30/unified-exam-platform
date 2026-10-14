<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { getExamTypes, getPlatformHealth } from '@/api/platform'

const examTypes = ref([])
const apiStatus = ref('checking')
const loadError = ref('')

const typeAccents = {
  SAT: 'accent-sat',
  PSAT: 'accent-psat',
  SHSAT: 'accent-shsat',
}

/** 首页只展示服务端已注册类型；两个 API 任一失败时显示可诊断状态。 */
async function loadPlatformOverview() {
  try {
    const [health, types] = await Promise.all([getPlatformHealth(), getExamTypes()])
    apiStatus.value = health.status === 'UP' ? 'online' : 'degraded'
    examTypes.value = types
  } catch (error) {
    apiStatus.value = 'offline'
    loadError.value = error instanceof Error ? error.message : '暂时无法连接后端服务'
  }
}

onMounted(loadPlatformOverview)
</script>

<template>
  <div class="page-content">
    <section class="welcome-band">
      <div class="welcome-copy">
        <div class="eyebrow"><span class="eyebrow-line"></span>统一考试管理 · 基础框架</div>
        <h1>一处管理，<em>各自专注。</em></h1>
        <p>账号、班级和发布入口统一；SAT、PSAT、SHSAT 保持各自的试卷结构与考试流程。</p>
        <div class="welcome-meta">
          <span class="status-mark" :class="`status-${apiStatus}`"></span>
          <span v-if="apiStatus === 'online'">平台 API 已连接</span>
          <span v-else-if="apiStatus === 'checking'">正在连接平台 API</span>
          <span v-else-if="apiStatus === 'degraded'">平台 API 部分可用</span>
          <span v-else>平台 API 未连接</span>
          <span class="meta-separator">·</span>
          <span>当前阶段：项目骨架</span>
        </div>
        <p v-if="loadError" class="connection-error">{{ loadError }}。请先启动后端服务。</p>
      </div>
      <div class="welcome-graphic" aria-hidden="true">
        <div class="orbit orbit-one"></div>
        <div class="orbit orbit-two"></div>
        <div class="orbit-core"><span>EX</span></div>
        <span class="orbit-label orbit-label-top">01 / PLATFORM</span>
        <span class="orbit-label orbit-label-bottom">03 / MODULES</span>
      </div>
      <div class="welcome-count"><strong>{{ String(examTypes.length).padStart(2, '0') }}</strong><span>已注册类型</span></div>
    </section>

    <section class="section-heading">
      <div>
        <div class="eyebrow"><span class="eyebrow-line"></span>TYPE DIRECTORY</div>
        <h2>选择考试类型</h2>
        <p>各类型入口独立注册，统一使用平台账号和班级。</p>
      </div>
      <span class="section-counter">{{ String(examTypes.length).padStart(2, '0') }} TYPES</span>
    </section>

    <section v-if="examTypes.length" class="type-grid" aria-label="考试类型列表">
      <RouterLink
        v-for="(type, index) in examTypes"
        :key="type.code"
        class="type-card"
        :class="typeAccents[type.code] || 'accent-default'"
        :to="{ name: 'exam-type', params: { code: type.code } }"
      >
        <div class="card-topline">
          <span class="card-number">0{{ index + 1 }}</span>
          <span class="card-arrow" aria-hidden="true">↗</span>
        </div>
        <div class="card-code">{{ type.code }}</div>
        <h3>{{ type.displayName }}</h3>
        <p>{{ type.summary }}</p>
        <div class="card-footer"><span>模块已注册</span><span class="card-footer-line"></span><span>进入模块</span></div>
      </RouterLink>
    </section>
    <div v-else-if="apiStatus === 'online'" class="empty-state">
      <span class="empty-symbol">—</span>
      <strong>尚无已注册的考试类型</strong>
      <p>请在后端考试类型模块中注册入口。</p>
    </div>
    <div v-else class="loading-state"><span class="loading-rule"></span>正在读取考试类型目录…</div>

    <section class="foundation-strip">
      <div class="foundation-title"><span class="foundation-icon">↗</span><div><strong>基础能力建设中</strong><small>功能将按实施阶段逐步接入</small></div></div>
      <div class="foundation-step"><span>01</span><strong>工程与类型注册</strong><i class="step-current">当前</i></div>
      <div class="foundation-step"><span>02</span><strong>统一账号与班级</strong><i>下一阶段</i></div>
      <div class="foundation-step"><span>03</span><strong>试卷与考试流程</strong><i>规划中</i></div>
    </section>

    <footer class="page-footer"><span>UNIFIED EXAM PLATFORM</span><span>BUILDING THE SHARED FOUNDATION</span></footer>
  </div>
</template>
