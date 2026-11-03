import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { router } from './router'
import { registerMathDirective } from './examTypes/sat/student/math'
import './styles.css'
import './report-print.css'

const app = createApp(App)
app.use(createPinia()).use(router)
registerMathDirective(app)
app.mount('#app')
