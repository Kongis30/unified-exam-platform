import { createRouter, createWebHistory } from 'vue-router'

const ExamTypePage = () => import('./views/ExamTypePage.vue')
import PlatformHome from './views/PlatformHome.vue'
import LoginPage from './views/LoginPage.vue'
import ExamWorkspaceHome from './views/ExamWorkspaceHome.vue'
import UsersPage from './views/UsersPage.vue'
import StudentAttemptPage from './views/StudentAttemptPage.vue'
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
    { path: '/student/systems', name: 'student-systems', redirect: { name: 'home' },
      meta: { roles: ['STUDENT'] } },
    { path: '/student/systems/:code', name: 'student-workspace', component: ExamTypePage,
      props: true, meta: { roles: ['STUDENT'] } },
    { path: '/shsat/student/attempts/:attemptId', alias: '/student/attempts/:attemptId', name: 'student-attempt', component: StudentAttemptPage,
      props: true, meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat/student/exams/:examId', alias: ['/psat/student/exams/:examId', '/student/sat/exams/:examId'], name: 'sat-student-exam', component: () => import('./examTypes/sat/student/views/SatFormalExamPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat/student/review/:assignmentId', name: 'sat-review-practice', component: () => import('./views/ReviewPracticePage.vue'),
      props: { examTypeCode: 'SAT' }, meta: { roles: ['STUDENT'] } },
    { path: '/psat/student/review/:assignmentId', name: 'psat-review-practice', component: () => import('./views/ReviewPracticePage.vue'),
      props: { examTypeCode: 'PSAT' }, meta: { roles: ['STUDENT'] } },
    { path: '/sat/student/module-wait', alias: ['/psat/student/module-wait', '/student/sat/module-wait'], name: 'sat-module-wait', component: () => import('./examTypes/sat/student/views/SatModuleTransitionPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat/student/break', alias: ['/psat/student/break', '/student/sat/break'], name: 'sat-exam-break', component: () => import('./examTypes/sat/student/views/SatBreakPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat/student/report-wait', alias: ['/psat/student/report-wait', '/student/sat/report-wait'], name: 'sat-report-wait', component: () => import('./examTypes/sat/student/views/SatReportWaitPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat/student/report', alias: ['/psat/student/report', '/student/sat/report'], name: 'sat-report', component: () => import('./examTypes/sat/student/views/SatReportPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/shsat/student/exams/:examId', alias: '/student/shsat/exams/:examId', name: 'shsat-student-exam',
      component: () => import('@shsat/pages/StudentExam.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/shsat/student/exams/:examId/practice', alias: '/student/exams/:examId', name: 'student-exam',
      component: () => import('@shsat/pages/StudentExam.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/student/exams', name: 'student', redirect: { name: 'exam-type', params: { code: 'SHSAT' } },
      meta: { roles: ['STUDENT'] } },
    { path: '/shsat/student/attempts/:attemptId/report', alias: '/student/attempts/:attemptId/report', name: 'student-attempt-report',
      component: () => import('@shsat/admin/pages/StudentAttemptReportPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/shsat/student/attempts/:attemptId/wrong-answers', alias: '/student/attempts/:attemptId/wrong-answers', name: 'student-wrong-answer-review',
      component: () => import('@shsat/pages/WrongAnswerReviewPage.vue'),
      meta: { roles: ['STUDENT'] } },
    { path: '/shsat', alias: '/exam-types/SHSAT/admin', name: 'shsat-admin', component: ExamWorkspaceHome, props: { code: 'SHSAT' },
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat', alias: '/exam-types/SAT/admin', name: 'sat-admin',
      component: ExamWorkspaceHome, props: { code: 'SAT' },
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/psat', alias: '/exam-types/PSAT/admin', name: 'psat-admin',
      component: ExamWorkspaceHome, props: { code: 'PSAT' },
      meta: { roles: ['ADMIN', 'TEACHER', 'STUDENT'] } },
    { path: '/sat/admin/classes/:classId', alias: '/exam-types/SAT/admin/classes/:classId', name: 'sat-class-detail',
      component: () => import('./views/SatClassDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/psat/admin/classes/:classId', alias: '/exam-types/PSAT/admin/classes/:classId', name: 'psat-class-detail',
      component: () => import('./views/SatClassDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/psat/admin/classes/:classId/students/:studentId/scores', alias: '/exam-types/PSAT/admin/classes/:classId/students/:studentId/scores', name: 'psat-student-scores',
      component: () => import('./views/SatStudentScoresPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/sat/admin/classes/:classId/students/:studentId/scores', alias: '/exam-types/SAT/admin/classes/:classId/students/:studentId/scores', name: 'sat-student-scores',
      component: () => import('./views/SatStudentScoresPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/sat/admin/exams/:examId/results', alias: '/exam-types/SAT/admin/exams/:examId/results', name: 'sat-exam-results',
      component: () => import('./views/SatExamResultsPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/psat/admin/exams/:examId/results', alias: '/exam-types/PSAT/admin/exams/:examId/results', name: 'psat-exam-results',
      component: () => import('./views/SatExamResultsPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/sat/admin/papers/:paperId/edit', alias: '/exam-types/SAT/admin/papers/:paperId/edit', name: 'sat-paper-edit',
      component: () => import('./examTypes/sat/admin/SatPaperEditPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/sat/admin/papers/:paperId/preview', alias: '/exam-types/SAT/admin/papers/:paperId/preview', name: 'sat-paper-preview',
      component: () => import('./examTypes/sat/admin/SatPaperViewPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/sat/admin/papers/:paperId/export', alias: '/exam-types/SAT/admin/papers/:paperId/export', name: 'sat-paper-export',
      component: () => import('./examTypes/sat/admin/SatPaperViewPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/sat/admin/exams/:examId/monitor', alias: '/exam-types/SAT/admin/exams/:examId/monitor', name: 'sat-admin-exam-monitor',
      component: () => import('@shsat/admin/pages/ExamMonitorPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/psat/admin/papers/:paperId/edit', alias: '/exam-types/PSAT/admin/papers/:paperId/edit', name: 'psat-paper-edit',
      component: () => import('./examTypes/sat/admin/SatPaperEditPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/psat/admin/papers/:paperId/preview', alias: '/exam-types/PSAT/admin/papers/:paperId/preview', name: 'psat-paper-preview',
      component: () => import('./examTypes/sat/admin/SatPaperViewPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/psat/admin/papers/:paperId/export', alias: '/exam-types/PSAT/admin/papers/:paperId/export', name: 'psat-paper-export',
      component: () => import('./examTypes/sat/admin/SatPaperViewPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/psat/admin/exams/:examId/monitor', alias: '/exam-types/PSAT/admin/exams/:examId/monitor', name: 'psat-admin-exam-monitor',
      component: () => import('@shsat/admin/pages/ExamMonitorPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/shsat/admin/papers/:paperId/edit', alias: '/exam-types/SHSAT/admin/papers/:paperId/edit', name: 'admin-paper-edit', component: () => import('@shsat/admin/pages/PaperEditPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/shsat/admin/papers/:paperId/preview', alias: '/exam-types/SHSAT/admin/papers/:paperId/preview', name: 'admin-paper-preview', component: () => import('@shsat/pages/StudentExam.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/shsat/admin/papers/:paperId/export', alias: '/exam-types/SHSAT/admin/papers/:paperId/export', name: 'admin-paper-export', component: () => import('@shsat/admin/pages/PaperExportPage.vue'),
      meta: { roles: ['ADMIN'] } },
    { path: '/shsat/admin/exams/:examId/monitor', alias: '/exam-types/SHSAT/admin/exams/:examId/monitor', name: 'admin-exam-monitor', component: () => import('@shsat/admin/pages/ExamMonitorPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/shsat/admin/classes/:classId', alias: '/exam-types/SHSAT/admin/classes/:classId', name: 'admin-class-detail', component: () => import('@shsat/admin/pages/ClassDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/shsat/admin/classes/:classId/students/:studentId', alias: '/exam-types/SHSAT/admin/classes/:classId/students/:studentId', name: 'admin-student-detail', component: () => import('@shsat/admin/pages/StudentDetailPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/shsat/admin/classes/:classId/exams/:examId/results', alias: '/exam-types/SHSAT/admin/classes/:classId/exams/:examId/results', name: 'admin-class-exam-results', component: () => import('@shsat/admin/pages/ClassExamResultsPage.vue'),
      meta: { roles: ['ADMIN', 'TEACHER'] } },
    { path: '/shsat/admin/classes/:classId/exams/:examId/wrong-answer-tasks/:taskId', alias: '/exam-types/SHSAT/admin/classes/:classId/exams/:examId/wrong-answer-tasks/:taskId', name: 'admin-wrong-answer-task', component: () => import('@shsat/admin/pages/WrongAnswerTaskPage.vue'),
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

router.beforeEach(async (to, from) => {
  if (to.meta.public) {
    if (authState.user || await refreshUser()) return { name: 'home' }
    return true
  }
  const user = authState.loaded ? authState.user : await refreshUser()
  if (!user) return { name: 'login', query: { redirect: to.fullPath } }
  // 旧入口和收藏链接统一转到新路径，查询参数及登录后的返回地址继续保留。
  if (to.name === 'exam-type') {
    const code = String(to.params.code || '').toUpperCase()
    if (['SAT', 'PSAT', 'SHSAT'].includes(code)) return { name: `${code.toLowerCase()}-admin`, query: to.query, hash: to.hash }
  }
  if (to.path.startsWith('/exam-types/') && to.path.includes('/admin')) {
    return { name: to.name, params: to.params, query: to.query, hash: to.hash }
  }
  // SAT 与 PSAT 共用考试页面，跨页面跳转时保持进入考试时的模块前缀。
  if (to.path.startsWith('/sat/student/')
      && (from.path.startsWith('/psat') || from.path.startsWith('/exam-types/PSAT/'))) {
    return { path: `/psat${to.path.slice('/sat'.length)}`, query: to.query, hash: to.hash }
  }
  if (to.path.startsWith('/student/sat/')) {
    const workspace = sessionStorage.getItem('sat:workspace') === 'PSAT' ? 'psat' : 'sat'
    return { path: `/${workspace}/student/${to.path.slice('/student/sat/'.length)}`, query: to.query, hash: to.hash }
  }
  if (to.path.startsWith('/student/shsat/') || to.path.startsWith('/student/attempts/') || /^\/student\/exams\/[^/]+/.test(to.path)) {
    return { name: to.name, params: to.params, query: to.query, hash: to.hash }
  }
  if (to.path.startsWith('/psat/student/')) sessionStorage.setItem('sat:workspace', 'PSAT')
  else if (to.path.startsWith('/sat/student/')) sessionStorage.setItem('sat:workspace', 'SAT')
  if (to.meta.roles && !to.meta.roles.includes(user.roleCode)) return { name: 'home' }
  return true
})
