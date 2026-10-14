import { createRouter, createWebHistory } from 'vue-router'

import ExamTypePage from './views/ExamTypePage.vue'
import PlatformHome from './views/PlatformHome.vue'

/** 统一入口路由；账号鉴权和业务页会在后续阶段加入。 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PlatformHome,
    },
    {
      path: '/exam-types/:code',
      name: 'exam-type',
      component: ExamTypePage,
      props: true,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})
