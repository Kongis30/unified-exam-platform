const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true}); const page=await browser.newPage(); const calls=[]; let fail=true;
 await page.route('**/api/**',async route=>{const req=route.request(); const url=new URL(req.url()); if(!url.pathname.startsWith('/api/')) return route.continue(); calls.push({path:url.pathname,method:req.method(),data:req.postDataJSON()});
  if(url.pathname==='/api/auth/csrf') return route.fulfill({json:{token:'fake'}});
  if(url.pathname==='/api/admin/papers/7/exams') return route.fulfill({json:{summary:{id:55}}});
  if(url.pathname==='/api/admin/exams/55/targets' && fail){fail=false;return route.fulfill({status:400,json:{message:'Retry target save'}})}
  return route.fulfill({json:{summary:{id:55}}});
 });
 await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5175'}/login`);
 const result=await page.evaluate(async()=>{const {adminApi}=await import('/src/examTypes/shsat/admin/services/adminApi.js'); const data={paperId:7,examTitle:'test',startTime:'2026-11-05T10:00',endTime:'2026-11-05T12:00',duration:90,targetType:'SPECIFIC_CLASSES',target_ids:[2],studentUserIds:[11,13],studentTargets:[{classId:2,studentId:11},{classId:3,studentId:13}],attemptLimit:1}; let draftId;try{await adminApi.createExam(data)}catch(e){draftId=e.draftExamId} await adminApi.updateExam(draftId,data);return draftId});
 assert.equal(result,55);const posts=calls.filter(x=>x.path==='/api/admin/papers/7/exams');const saves=calls.filter(x=>x.path==='/api/admin/exams/55/targets');assert.equal(posts.length,1);assert.equal(saves.length,2);assert.deepEqual(saves[1].data,{classIds:[2],studentUserIds:[11,13],studentTargets:[{classId:2,studentId:11},{classId:3,studentId:13}]});console.log('SHSAT adapter: mixed targets and retry of existing draft passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
