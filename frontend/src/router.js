import { createRouter, createWebHistory } from 'vue-router'

import ExamTypePage from './views/ExamTypePage.vue'
import PlatformHome from './views/PlatformHome.vue'
import LoginPage from './views/LoginPage.vue'
import UsersPage from './views/UsersPage.vue'
import StudentAttemptPage from './views/StudentAttemptPage.vue'
import StudentSystemSelectPage from './views/StudentSystemSelectPage.vue'
import { authState, refreshUser } from './auth'

/** 统一入口路由；角色权限由会话用户和路由元数据共同控制。 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
    {
      path: '/',
      name: 'home',
      component: PlatformHome,
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] },
    },
    { path: '/users', name: 'users', component: UsersPage, meta: { roles: ['ADMIN'] } },
    { path: '/student/systems', name: 'student-systems', component: StudentSystemSelectPage,
      meta: { roles: ['STUDENT'] } },
    { path: '/student/systems/:code', name: 'student-workspace', component: ExamTypePage,
      props: true, meta: { roles: ['STUDENT'] } },
    { path: '/student/attempts/:attemptId', name: 'student-attempt', component: StudentAttemptPage,
      props: true, meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/student/sat/exams/:examId', name: 'sat-student-exam', component: () => import('./examTypes/sat/student/views/SatFormalExamPage.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/student/sat/module-wait', name: 'sat-module-wait', component: () => import('./examTypes/sat/student/views/SatModuleTransitionPage.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/student/sat/break', name: 'sat-exam-break', component: () => import('./examTypes/sat/student/views/SatBreakPage.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/student/sat/report-wait', name: 'sat-report-wait', component: () => import('./examTypes/sat/student/views/SatReportWaitPage.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/student/sat/report', name: 'sat-report', component: () => import('./examTypes/sat/student/views/SatReportPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/student/shsat/exams/:examId', name: 'shsat-student-exam',
      component: () => import('@shsat/pages/StudentExam.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/student/exams/:examId', name: 'student-exam',
      component: () => import('@shsat/pages/StudentExam.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/student/exams', name: 'student', redirect: { name: 'exam-type', params: { code: 'SHSAT' } },
      meta: { roles: ['STUDENT'] } },
    { path: '/student/attempts/:attemptId/report', name: 'student-attempt-report',
      component: () => import('@shsat/admin/pages/StudentAttemptReportPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/student/attempts/:attemptId/wrong-answers', name: 'student-wrong-answer-review',
      component: () => import('@shsat/pages/WrongAnswerReviewPage.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/exam-types/SHSAT/admin', name: 'shsat-admin', component: () => import('@shsat/admin/pages/AdminHome.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SAT/admin', name: 'sat-admin',
      component: () => import('./examTypes/sat/admin/SatAdminHome.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SAT/admin/classes/:classId', name: 'sat-class-detail',
      component: () => import('./views/SatClassDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SAT/admin/classes/:classId/students/:studentId/scores', name: 'sat-student-scores',
      component: () => import('./views/SatStudentScoresPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SAT/admin/exams/:examId/results', name: 'sat-exam-results',
      component: () => import('./views/SatExamResultsPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SAT/admin/papers/:paperId/edit', name: 'sat-paper-edit',
      component: () => import('./examTypes/sat/admin/SatPaperEditPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/exam-types/SAT/admin/exams/:examId/monitor', name: 'sat-admin-exam-monitor',
      component: () => import('@shsat/admin/pages/ExamMonitorPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/exam-types/SHSAT/admin/papers/:paperId/edit', name: 'admin-paper-edit', component: () => import('@shsat/admin/pages/PaperEditPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/exam-types/SHSAT/admin/papers/:paperId/preview', name: 'admin-paper-preview', component: () => import('@shsat/admin/pages/PaperPreviewPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/exam-types/SHSAT/admin/papers/:paperId/export', name: 'admin-paper-export', component: () => import('@shsat/admin/pages/PaperExportPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/exam-types/SHSAT/admin/exams/:examId/monitor', name: 'admin-exam-monitor', component: () => import('@shsat/admin/pages/ExamMonitorPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SHSAT/admin/classes/:classId', name: 'admin-class-detail', component: () => import('@shsat/admin/pages/ClassDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SHSAT/admin/classes/:classId/students/:studentId', name: 'admin-student-detail', component: () => import('@shsat/admin/pages/StudentDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SHSAT/admin/classes/:classId/exams/:examId/results', name: 'admin-class-exam-results', component: () => import('@shsat/admin/pages/ClassExamResultsPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/exam-types/SHSAT/admin/classes/:classId/exams/:examId/wrong-answer-tasks/:taskId', name: 'admin-wrong-answer-task', component: () => import('@shsat/admin/pages/WrongAnswerTaskPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    {
      path: '/exam-types/:code',
      name: 'exam-type',
      component: ExamTypePage,
      props: true,
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) {
    if (authState.user || await refreshUser()) return { name: 'home' }
    return true
  }
  const user = authState.loaded ? authState.user : await refreshUser()
  if (!user) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.roles && !to.meta.roles.includes(user.roleCode)) return { name: 'home' }
  if (to.name === 'home' && user.roleCode === 'STUDENT') return { name: 'student-systems' }
  return true
})
