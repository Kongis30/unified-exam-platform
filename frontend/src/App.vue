<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="platform-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/" aria-label="统一考试平台首页">
        <span class="brand-mark">E</span>
        <span class="brand-copy">
          <strong>EXAM PLATFORM</strong>
          <small>统一考试平台</small>
        </span>
      </RouterLink>

      <div class="sidebar-label">工作空间</div>
      <RouterLink class="nav-item" active-class="nav-item-active" to="/">
        <span class="nav-index">01</span>
        <span>总览</span>
      </RouterLink>
      <div class="nav-item nav-item-muted" aria-disabled="true">
        <span class="nav-index">02</span>
        <span>账号管理</span>
        <small>阶段 2</small>
      </div>
      <div class="nav-item nav-item-muted" aria-disabled="true">
        <span class="nav-index">03</span>
        <span>班级管理</span>
        <small>阶段 2</small>
      </div>

      <div class="sidebar-divider"></div>
      <div class="sidebar-label">考试类型</div>
      <div class="type-shortcuts">
        <RouterLink class="type-shortcut" to="/exam-types/SAT"><i class="type-dot dot-sat"></i>SAT</RouterLink>
        <RouterLink class="type-shortcut" to="/exam-types/PSAT"><i class="type-dot dot-psat"></i>PSAT</RouterLink>
        <RouterLink class="type-shortcut" to="/exam-types/SHSAT"><i class="type-dot dot-shsat"></i>SHSAT</RouterLink>
      </div>

      <div class="sidebar-footer">
        <span class="footer-pulse"></span>
        <span>平台骨架阶段</span>
        <span class="footer-build">0.1</span>
      </div>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <div class="breadcrumb"><span>平台</span><b>/</b><strong>工作空间</strong></div>
        <div class="topbar-right">
          <span class="environment-tag"><i></i>本地开发</span>
          <span class="avatar">EP</span>
        </div>
      </header>
      <RouterView />
    </main>
  </div>
</template>
