<template>
  <div class="report-wait">
    <header class="topbar">
      <div class="brand">JIN SAT&amp;PSAT System</div>
      <nav class="actions">
        <a class="help" href="javascript:void(0)">Help</a>
        <a class="home" href="/">Return to Home</a>
      </nav>
    </header>

    <main class="content">
      <h1 class="title">Digital Practice Is Over: Stand By!</h1>
      <p class="desc">All your work has been saved, and we’re uploading it now. Do not refresh this page or quit the app.</p>

      <div class="card">
        <div class="illustration">⬆️</div>
        <p class="hint">If this screen doesn't update in a few minutes, hit<br/><strong>Return to Home</strong></p>
      </div>
    </main>
  </div>
</template>

<script>
export default {
  name: 'ReportWait'
}
</script>

<style scoped>
.report-wait {
  min-height: 100vh;
  background: #fff;
  color: #2c3e50;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}
.brand { font-size: 12px; color: #666; }
.actions { display: flex; gap: 16px; }
.actions a { font-size: 12px; color: #4a4a4a; text-decoration: none; }

.content {
  max-width: 720px;
  margin: 40px auto;
  text-align: center;
}
.title { font-size: 22px; font-weight: 600; margin-bottom: 12px; }
.desc { font-size: 14px; color: #4a4a4a; margin-bottom: 24px; }

.card {
  margin: 0 auto;
  width: 420px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.06);
  border: 1px solid #eee;
  padding: 28px 18px;
}
.illustration { font-size: 42px; margin: 12px 0 18px; }
.hint { font-size: 12px; color: #4a4a4a; }
</style>
