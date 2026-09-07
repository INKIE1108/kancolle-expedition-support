import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeNozaki, completeNozaki } from '../src/utils/nozaki.ts';
import { monthlyPeriodKey, prerequisiteLayers, concreteFormation, recommendMonthly } from '../src/utils/expeditionGuide.ts';
import { isDiscordWebhook, isPushEndpoint, deliveryUpdate, deliverNotification } from '../server/notifications.js';
const list = JSON.parse(fs.readFileSync(new URL('../public/data/expeditions.json', import.meta.url), 'utf8'));

test('古い完了状態と遅延した完了処理が再スタートを上書きしない', () => {
 const old = { startAt: 1, endAt: 100, notifiedAt: 110, updatedAt: 1 };
 const running = { startAt: 200, endAt: 300, notifiedAt: null, updatedAt: 200 };
 assert.deepEqual(mergeNozaki(running, old), running);
 assert.deepEqual(completeNozaki(running, 100, 250), running);
 assert.equal(completeNozaki(running, 300, 310).updatedAt, 200);
 assert.equal(mergeNozaki(old, running).endAt, 300);
 assert.equal(mergeNozaki(running, { ...running, endAt: null, startAt: null, updatedAt: 201 }).endAt, null);
});
test('マンスリー期間は日本時間15日正午で切り替わる', () => {
 assert.equal(monthlyPeriodKey(Date.parse('2026-09-15T02:59:59Z')), '2026-08');
 assert.equal(monthlyPeriodKey(Date.parse('2026-09-15T03:00:00Z')), '2026-09');
 assert.equal(monthlyPeriodKey(Date.parse('2026-01-01T00:00:00Z')), '2025-12');
});
test('開放ルートは近い順で、循環・合流でも重複しない', () => {
 const layers = prerequisiteLayers('E1', list);
 assert.equal(layers[0].expedition.id, '40');
 assert.equal(layers.find(x => x.expedition.id === '38')?.depth, 2);
 assert.equal(new Set(layers.map(x => x.expedition.id)).size, layers.length);
 const cycle = [{id:'a',prerequisites:[{expeditionId:'b'}]}, {id:'b',prerequisites:[{expeditionId:'a'}]}];
 assert.equal(prerequisiteLayers('a', cycle as any).length, 1);
});
test('自由枠と旗艦、選択艦種を具体例で区別する', () => {
 assert.equal(concreteFormation('護衛空母/軽巡1＋自由5。').example, '軽巡1 ＋ 駆逐5（自由枠）');
 assert.match(concreteFormation('重巡旗艦1＋軽巡1＋駆逐3＋自由1。').example, /重巡1（旗艦）/);
 assert.match(concreteFormation('潜水艦/潜水空母3＋自由1。').example, /潜水艦3/);
});
test('マンスリーおすすめは完了を除外し、前提と交戦リスクを保持する', () => {
 const ranked = recommendMonthly(list, [], 'fuel', true);
 const convoy = ranked.find(r => r.expedition.id === '43');
 assert.ok(convoy);
 assert.deepEqual(convoy.missing.map(e => e.id), ['42']);
 assert.ok(ranked.every(r => r.expedition.combatType !== 'II'));
 assert.ok(!recommendMonthly(list, ['43'], 'fuel', false).some(r => r.expedition.id === '43'));
 assert.equal(list.find(e => e.id === 'E1').combatType, 'II');
 assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../src/data/expeditions-fallback.json', import.meta.url), 'utf8')), list);
});
test('任意URL・偽装ホストへのサーバー送信を拒否', () => {
 assert.ok(isDiscordWebhook('https://discord.com/api/webhooks/123/abc-def'));
 for (const u of ['http://discord.com/api/webhooks/1/a', 'https://discord.com.evil.test/api/webhooks/1/a', 'https://127.0.0.1/api/webhooks/1/a']) assert.equal(isDiscordWebhook(u), false);
 assert.equal(isPushEndpoint('https://localhost/'), false);
 assert.ok(isPushEndpoint('https://fcm.googleapis.com/anything'));
});
test('通知の一部失敗は再送待ち、上限でerror', () => {
 assert.equal(deliveryUpdate({attempts:1}, {delivered:{discord:true},errors:['timeout']}, 0).status, 'pending');
 assert.equal(deliveryUpdate({attempts:5}, {delivered:{},errors:['timeout']}, 0).status, 'error');
 assert.equal(deliveryUpdate({attempts:1}, {delivered:{'push:a':true},errors:[]}, 0).status, 'sent');
});
test('Pushのみで送信でき、再送時は成功した端末へ再送しない', async () => {
 const saved = [];
 const subscriptions = [{id:'a',endpoint:'https://fcm.googleapis.com/a'},{id:'b',endpoint:'https://fcm.googleapis.com/b'}];
 const db = {from(table) { let update; const q = {select(){return q;},eq(){return q;},update(v){update=v;return q;},then(resolve){if(update)saved.push(update);resolve({data:table==='push_subscriptions'?subscriptions:[],error:null});}};return q;}};
 let calls = [];
 const deps = {pushConfigured:true,sendDiscord:async()=>assert.fail('Discord should not be used'),sendPush:async s=>{calls.push(s.id);if(s.id==='b')throw Error('timeout');}};
 const item = {id:'job',user_id:'u',webhook_url:'push-only',content:'test',attempts:1,delivery_state:{}};
 const first = await deliverNotification(db,item,deps);
 assert.deepEqual(first.delivered, {'push:a':true});
 calls=[];
 await deliverNotification(db,{...item,attempts:2,delivery_state:first.delivered},{...deps,sendPush:async s=>{calls.push(s.id);}});
 assert.deepEqual(calls,['b']);
});

test('並行する配信APIは同じ予約を一度だけ取得する', async () => {
 const { default: handler } = await import('../api/cron-dispatch.js');
 const originalFetch = globalThis.fetch;
 const before = { ...process.env };
 process.env.CRON_SECRET = 'test-secret';
 process.env.VITE_SUPABASE_URL = 'https://notification-test.invalid';
 process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
 delete process.env.VAPID_PUBLIC_KEY; delete process.env.VITE_VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
 const row = {id:'test-job',user_id:'test-user',status:'pending',attempts:0,end_at:'2000-01-01T00:00:00Z',next_attempt_at:null,claimed_at:null,delivery_state:{},content:'test',webhook_url:'https://discord.com/api/webhooks/123/token'};
 let sent = 0;
 globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
  if (url.hostname === 'discord.com') { sent++; return new Response(null,{status:204}); }
  assert.equal(url.hostname,'notification-test.invalid');
  if (url.pathname.endsWith('push_subscriptions')) return Response.json([]);
  let matches = true;
  for(const [key,value] of url.searchParams) {
   if(value.startsWith('eq.')) matches &&= String(row[key]) === value.slice(3);
   if(key==='claimed_at' && value.startsWith('lt.')) matches &&= Boolean(row.claimed_at && row.claimed_at < value.slice(3));
  }
  if(init?.method === 'PATCH' && matches) Object.assign(row,JSON.parse(init.body));
  return Response.json(matches ? [{...row}] : []);
 };
 const makeRes = () => ({statusCode:0,body:null,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
 try {
  const a=makeRes(),b=makeRes();
  await Promise.all([handler({method:'POST',headers:{authorization:'Bearer test-secret'}},a),handler({method:'POST',headers:{authorization:'Bearer test-secret'}},b)]);
  assert.equal(a.statusCode,200,JSON.stringify(a.body)); assert.equal(b.statusCode,200,JSON.stringify(b.body));
  assert.equal(sent,1); assert.equal(row.status,'sent'); assert.equal(row.attempts,1);
 } finally {globalThis.fetch=originalFetch; for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key]; Object.assign(process.env,before);}
});
