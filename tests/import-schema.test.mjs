import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const src=readFileSync('app.js','utf8');
const block=src.slice(src.indexOf('const BACKUP_MAX_BYTES'),src.indexOf('function load()'));
const parse=runInNewContext(block+';prepareBackup',{seed:()=>({wallets:[],txs:[],bills:[],settings:{budget:0}}),parseYmd:s=>new Date(s+'T00:00:00Z'),ymd:d=>d.toISOString().slice(0,10)});
const good=()=>({wallets:[{id:'cash',name:'現金',initial:0}],txs:[]});
test('legacy backup without bills/settings accepted',()=>assert.equal(parse(good()).bills.length,0));
test('bad card day and text fields rejected',()=>{let d=good();d.wallets[0].payDay='<img>';assert.throws(()=>parse(d));d=good();d.txs=[{id:'t',walletId:'cash',date:'2026-11-09',type:'expense',amount:10,memo:{}}];assert.throws(()=>parse(d))});
test('invalid budget rejected',()=>{const d=good();d.settings={budget:'bad'};assert.throws(()=>parse(d))});
test('remote state is persisted before assignment',()=>{const s=readFileSync('sync.js','utf8');const a=s.indexOf('const checked = prepareBackup(next)');assert.ok(a>=0);assert.ok(s.indexOf('localStorage.setItem(KEY',a)<s.indexOf('S = checked',a))});
test('negative wallet initial is legitimate and preserved',()=>{const d=good();d.wallets[0].initial=-500;assert.equal(parse(d).wallets[0].initial,-500)});
test('invalid local saved data is not overwritten by fallback state',()=>{
 const begin=src.indexOf('let invalidLocalBackup = null;');const end=src.indexOf('const now =',begin);
 const original='{"wallets":null}';let saved=original;let pushed=false;
 const api=runInNewContext(src.slice(begin,end)+';({save,raw:()=>invalidLocalBackup})',{KEY:'test',seed:()=>good(),prepareBackup:parse,localStorage:{getItem:()=>saved,setItem:(_k,v)=>{saved=v}},toast(){},Sync:{push(){pushed=true}}});
 assert.equal(api.raw(),original);api.save();assert.equal(saved,original);assert.equal(pushed,false);
});
test('boot reads valid negative balances without falling back',()=>{
 const begin=src.indexOf('let invalidLocalBackup = null;');const end=src.indexOf('const now =',begin);const d=good();d.wallets[0].initial=-400;
 const api=runInNewContext(src.slice(begin,end)+';({state:S,raw:invalidLocalBackup})',{KEY:'test',seed:()=>good(),prepareBackup:parse,localStorage:{getItem:()=>JSON.stringify(d)},toast(){},Sync:{}});
 assert.equal(api.state.wallets[0].initial,-400);assert.equal(api.raw,null);
});
function resetHarness({raw='{"wallets":null}',failWrite=false}={}) {
 const begin=src.indexOf('let invalidLocalBackup = null;');const end=src.indexOf('const now =',begin);
 let saved=raw, pushes=0, signedOut=0, handlers;const notices=[];
 const Sync={status:'synced',push(){pushes++},async signOut(){signedOut++},setHandlers(h){handlers=h}};
 const logoutBlock=src.slice(src.indexOf('async function logout()'),src.indexOf('function billRow('));
 const api=runInNewContext(src.slice(begin,end)+logoutBlock+';({resetStoredState,logout,state:()=>S, switch:()=>handlers.onSwitch()})',{
  KEY:'test',seed:()=>({...good(),bills:[]}),prepareBackup:parse,localStorage:{getItem:()=>saved,setItem:(_k,v)=>{if(failWrite)throw Error('quota');saved=v}},
  toast:m=>notices.push(m),Sync,UI:{},render(){},confirm:()=>true,get handlers(){return handlers}
 });
 return {api,notices,saved:()=>saved,pushes:()=>pushes,signedOut:()=>signedOut};
}
test('reset preserves invalid raw data and does not push or claim success',()=>{
 const h=resetHarness();const before=h.api.state();assert.equal(h.api.resetStoredState(true),false);
 assert.equal(h.api.state(),before);assert.equal(h.saved(),'{"wallets":null}');assert.equal(h.pushes(),0);
 assert.match(src,/if \(resetStoredState\(true\)\) \{ render\(\); toast\('削除しました'\)/);
});
test('account switch refuses to discard invalid or unsavable state',()=>{
 for(const h of [resetHarness(),resetHarness({raw:JSON.stringify(good()),failWrite:true})]) {
  const before=h.api.state(),raw=h.saved();assert.equal(h.api.switch(),false);assert.equal(h.api.state(),before);assert.equal(h.saved(),raw);
 }
});
test('logout reports retained local data rather than a successful clear',async()=>{
 const h=resetHarness();const before=h.api.state();await h.api.logout();
 assert.equal(h.signedOut(),1);assert.equal(h.saved(),'{"wallets":null}');assert.equal(h.api.state(),before);
 assert.match(h.notices.at(-1),/端末のデータは削除できず残っています/);
});
test('successful reset persists seed and syncs only after persistence',()=>{
 const d=good();d.wallets[0].initial=99;const h=resetHarness({raw:JSON.stringify(d)});
 assert.equal(h.api.resetStoredState(true),true);assert.equal(JSON.parse(h.saved()).wallets[0].initial,0);assert.equal(h.pushes(),1);
});
