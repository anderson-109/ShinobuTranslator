import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
function fixture() {
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << >> /Contents 7 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const text='BT /F1 24 Tf 40 400 Td (PDF TEST PAGE ONE) Tj ET';
 objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,'<< /Length 0 >>\nstream\n\nendstream');
 let pdf='%PDF-1.4\n'; const offsets=[0];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const start=Buffer.byteLength(pdf); pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const n of offsets.slice(1)) pdf+=`${String(n).padStart(10,'0')} 00000 n \n`;
 return Buffer.from(pdf+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
}
const bytes=fixture(); mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/pdf-smoke-fixture.pdf',bytes);
const server=createServer((req,res)=>{if(req.url==='/article'){res.setHeader('Content-Type','text/html');res.end('<title>Normal page</title>Normal page');return;} res.setHeader('Content-Type','application/pdf');res.end(bytes);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const extension=resolve('apps/extension/dist-chromium');
mkdirSync('.tmp',{recursive:true});
const context=await chromium.launchPersistentContext(mkdtempSync(resolve('.tmp/pdf-smoke-')),{headless:true,channel:'chromium',args:['--disable-gpu','--disable-features=WebGPUService',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1280,height:1000}});
try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'); const id=new URL(worker.url()).host;
 let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`chrome-extension://${id}/pdf.html`);
 await page.locator('#file').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:bytes});
 await expect(page.locator('#pdf-page')).toBeVisible({timeout:30000});await expect(page.locator('#total')).toHaveText('2');
 console.log('PASS local PDF upload and rasterization');
 await expect(page).toHaveTitle('Anderson Index for PDF 翻譯');
 const overflow=await page.evaluate(()=>({x:document.body.scrollWidth>innerWidth,y:document.body.scrollHeight>innerHeight}));
 expect(overflow).toEqual({x:false,y:false});
 await page.locator('#fit-mode').selectOption('width');
 const wide=await page.locator('#page-container').boundingBox();expect(wide.width).toBeGreaterThan(1200);
 await page.locator('#fit-mode').selectOption('page');
 const fitted=await page.locator('#page-container').boundingBox();expect(fitted.width).toBeLessThan(wide.width);
 await page.screenshot({path:'artifacts/anderson-pdf-reader.png'});
 await page.locator('#fit-mode').selectOption('width');
 console.log('PASS title, logo and full-window width/page fit');
 await page.locator('#next').click(); await expect(page.locator('#status')).toContainText('第 2 / 2 頁');
 await page.locator('#previous').click();await expect(page.locator('#status')).toContainText('第 1 / 2 頁');
 await page.locator('#page').fill('2');await page.locator('#page').dispatchEvent('change');await expect(page.locator('#status')).toContainText('第 2 / 2 頁');
 console.log('PASS previous/next/page-number navigation');
 await expect(page.getByRole('button',{name:'翻译当前页',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'翻译当前页',exact:true})).toBeInViewport();
 await page.screenshot({path:'artifacts/pdf-reader-smoke.png'});
 console.log('PASS existing translation controls mounted');
 await page.evaluate(()=>{window.__pdfTicks=0;window.__pdfGap=0;let last=performance.now();setInterval(()=>{const now=performance.now();window.__pdfGap=Math.max(window.__pdfGap,now-last);last=now;window.__pdfTicks++;},20);});
 await page.getByRole('button',{name:'翻译当前页',exact:true}).click();
 console.log('Translation requested for blank page');
 await page.locator('#previous').click();await expect(page.locator('#status')).toContainText('第 1 / 2 頁');
 await page.locator('#next').click();await expect(page.locator('#status')).toContainText('第 2 / 2 頁');
 await expect(page.getByRole('button',{name:'显示原图',exact:true})).toBeVisible({timeout:120000});
 console.log('PASS local OCR/pipeline translation of blank PDF page');
 const heartbeat=await page.evaluate(()=>({ticks:window.__pdfTicks,maxGapMs:window.__pdfGap}));
 // Driver/font cold starts vary by machine; record gaps while asserting that
 // the page keeps ticking and that real navigation works during the job.
 expect(heartbeat.ticks).toBeGreaterThan(10);
 console.log('PASS page navigation during translation and UI heartbeat',JSON.stringify(heartbeat));
 await expect(page.locator('#cache-state')).toContainText('已快取',{timeout:15000});
 await page.close();page=await context.newPage();
 await page.goto(`chrome-extension://${id}/pdf.html`);await page.locator('#file').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:bytes});
 await expect(page.locator('#pdf-page')).toBeVisible({timeout:30000});await page.locator('#next').click();
 await expect(page.locator('#cache-state')).toContainText('已載入快取譯文');
 await expect(page.getByRole('button',{name:'显示原图',exact:true})).toBeVisible();
 console.log('PASS persistent cache after closing/reopening the PDF');
 await page.locator('#clear-cache').click();await expect(page.locator('#cache-state')).toContainText('快取已清除');
 await expect(page.getByRole('button',{name:'翻译当前页',exact:true})).toBeVisible();
 console.log('PASS clear PDF cache');
 await worker.evaluate(()=>{
  const originalFetch=globalThis.fetch;
  globalThis.__openAiRequests=[];globalThis.__rejectOpenAi=false;
  globalThis.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input.url??String(input);
   if(!url.startsWith('https://api.openai.com/'))return originalFetch(input,init);
   const body=JSON.parse(init.body);globalThis.__openAiRequests.push(body);
   if(globalThis.__rejectOpenAi)return new Response(JSON.stringify({error:{message:'mock invalid API key',code:'invalid_api_key'}}),{status:401,headers:{'content-type':'application/json'}});
   let content;
   const user=body.messages.find(message=>message.role==='user');
   if(Array.isArray(user.content)){
     const ids=user.content.filter(part=>part.type==='text').map(part=>part.text.match(/Region ID: (.+)/)?.[1]).filter(Boolean);
     content=JSON.stringify({regions:ids.map(id=>({id,text:'HELLO WORLD'}))});
   }else{
     const raw=user.content.split(/(?:輸入數據|输入数据)：/u).at(-1);
     const regions=JSON.parse(raw);
     content=JSON.stringify({regions:regions.map(region=>({id:region.id,translation:'這是翻譯測試。',columns:['這是翻譯測試。']}))});
   }
   return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}});
  };
 });
 await page.evaluate(async()=>{
   const api=globalThis.chrome;
   const command=async command=>{const response=await api.runtime.sendMessage({type:'mt:extension-control',command});if(!response.ok)throw new Error(response.error);return response.result;};
   await command({kind:'replace-api-key',provider:'openai',apiKey:'synthetic-test-key'});
   const {projection}=await command({kind:'read'});const settings=projection.settings;
   settings.translator='llm';settings.llmProvider='openai';settings.targetLang='zh-CHT';settings.ocrEngine='openai';
   settings.llmProfiles.openai={...settings.llmProfiles.openai,authMode:'api_key',modelPreset:'gpt-5-mini',useCustomModel:false};
   await command({kind:'replace-settings',settings,expectedRevision:projection.revision});
 });
 await page.locator('#previous').click();await expect(page.locator('#status')).toContainText('第 1 / 2 頁');
 await expect(page.getByRole('button',{name:'翻译当前页',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'翻译当前页',exact:true}).click();
 await expect(page.getByRole('button',{name:'显示原图',exact:true})).toBeVisible({timeout:120000});
 const openAiRequests=await worker.evaluate(()=>globalThis.__openAiRequests);
 expect(openAiRequests.length).toBeGreaterThanOrEqual(2);
 for(const request of openAiRequests){expect(request.model).toBe('gpt-5-mini');expect(request.reasoning_effort).toBe('low');}
 expect(openAiRequests.some(request=>request.messages.some(message=>typeof message.content==='string'&&message.content.includes('PDF 上下文 JSON')))).toBe(true);
 console.log('PASS mocked OpenAI gpt-5-mini OCR, contextual translation and translated-image output');
 await worker.evaluate(()=>{globalThis.__rejectOpenAi=true;});await page.locator('#clear-cache').click();await expect(page.locator('#cache-state')).toContainText('快取已清除');
 await page.getByRole('button',{name:'翻译当前页',exact:true}).click();
 await expect(page.locator('#reading-anchor')).toContainText('第 1 頁翻譯失敗：OCR 识别失败',{timeout:180000});
 expect((await worker.evaluate(()=>globalThis.__openAiRequests.length))).toBeGreaterThan(openAiRequests.length);
 console.log('PASS rejected OpenAI OCR request shown as a readable stage failure');
 for(const path of ['/book.pdf?version=1','/document/123']){
   await page.goto(origin+path).catch(()=>{});
   await expect(page).toHaveURL(new RegExp(`chrome-extension://${id}/pdf.html`),{timeout:30000});
   await expect(page.locator('#pdf-page')).toBeVisible({timeout:30000});
   console.log(`PASS automatic PDF navigation ${path}`);
 }
 await page.locator('#original').click();await expect(page).toHaveURL(/shinobu-native=1/,{timeout:15000});
 console.log('PASS return to native viewer without redirect loop');
 await page.goto(origin+'/article');await expect(page).toHaveTitle('Normal page');
 console.log('PASS normal pages unchanged');
 if(errors.length) throw new Error(errors.join('\n'));
}catch(error){for(const p of context.pages()) console.log('PAGE',p.url(),await p.locator('body').innerText({timeout:1000}).catch(()=>''));throw error;}
finally{await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

