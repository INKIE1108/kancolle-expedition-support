import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const server=await createServer({root:fileURLToPath(new URL('../', import.meta.url)),server:{host:'127.0.0.1',port:5174},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://sync-test.supabase.co'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('fake-browser-test-key')}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:JSON.parse(process.env.CHROMIUM_ARGS || '[]'),headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.routeWebSocket('**/realtime/**',()=>{});
 const user={id:'00000000-0000-4000-8000-000000000001',email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
 let failReads=true,failWrites=false,snapshot=null,writes=0;
 await page.route('https://sync-test.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.includes('/auth/'))return route.fulfill({json:user});
  if(url.pathname.endsWith('user_settings')) {
   if(req.method()==='GET')return route.fulfill(failReads?{status:400,json:{message:'fixture: read failed'}}:{json:snapshot?[{settings_json:snapshot}]:[]});
   if(failWrites)return route.fulfill({status:400,json:{message:'fixture: write failed'}});
   snapshot=req.postDataJSON().settings_json;writes++;return route.fulfill({json:[{user_id:user.id}]});
  }
  return route.fulfill({json:[]});
 });
 const payload=Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 await page.addInitScript(({user,payload})=>localStorage.setItem('sb-sync-test-auth-token',JSON.stringify({access_token:'eyJhbGciOiJIUzI1NiJ9.'+payload+'.fixture',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})),{user,payload});
 page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:5174');
 await page.waitForFunction(()=>document.querySelector('.sync-feedback')?.textContent.includes('同期失敗'),{},{timeout:12000});
 assert.equal(writes,0);console.log('PASS initial read failure does not claim sync success');
 failReads=false;
 await page.getByRole('button',{name:'設定',exact:true}).click();
 await page.getByRole('button',{name:'アカウント・同期 ログイン・クラウド保存'}).click();
 await page.getByRole('button',{name:'クラウドから読込',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.sync-feedback')?.textContent.includes('同期済み'),{},{timeout:8000});
 assert.ok(writes>0);console.log('PASS manual read success re-enables automatic saving');
 await page.getByRole('button',{name:'遠征',exact:true}).click();
 await page.getByPlaceholder('遠征名・IDで検索').fill('E1');
 const pin=page.locator('.expedition-item .pin-button');
 const oldPinned=snapshot.pinnedExpeditionIds.includes('E1');
 failWrites=true;
 await pin.click();
 await page.waitForFunction(()=>document.querySelector('.sync-feedback')?.textContent.includes('同期失敗'),{},{timeout:6000});
 console.log('PASS failed autosave is visibly reported');
 failWrites=false;
 await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await page.waitForFunction(()=>document.querySelector('.sync-feedback')?.textContent.includes('同期済み'),{},{timeout:8000});
 assert.notEqual(snapshot.pinnedExpeditionIds.includes('E1'),oldPinned);console.log('PASS reconnect saves the unsaved favorite instead of overwriting it');
 failWrites=true;
 await pin.click();
 await page.waitForFunction(()=>document.querySelector('.sync-feedback')?.textContent.includes('同期失敗'),{},{timeout:6000});
 const expected=await page.evaluate(()=>JSON.parse(localStorage.getItem('kancolle-expedition-pinned-v1')).includes('E1'));
 failWrites=false;
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('.sync-feedback')?.textContent.includes('同期済み'),{},{timeout:8000});
 assert.equal(snapshot.pinnedExpeditionIds.includes('E1'),expected);
 console.log('PASS pending edits survive reload and are uploaded on recovery');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS no browser errors; fake account/network only');
} finally {await browser.close();await server.close();}
