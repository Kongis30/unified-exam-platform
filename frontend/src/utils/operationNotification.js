import { ElNotification } from 'element-plus'
import 'element-plus/dist/index.css'

const notificationTitles = {
  success: 'Completed',
  error: 'Action failed',
  warning: 'Please check',
  info: 'Information',
}

// 显示短暂的操作结果；用于 SAT 管理页面的成功、失败和提醒反馈。
export function notifyOperation(message, type = 'success') {
  ElNotification({
    title: notificationTitles[type] || notificationTitles.info,
    message: String(message || ''),
    type,
    position: 'top-right',
    duration: 4500,
    showClose: true,
  })
}
