import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({window:{addEventListener(){}},localStorage:{getItem(){return null;}}});
vm.runInContext(fs.readFileSync(new URL('../sync.js',import.meta.url),'utf8')+';globalThis.api=Sync;',context);
const {merge,canon}=context.api;
const rec=n=>({kind:'tx',data:{id:'sample',amount:n}});
const normalize=x=>JSON.parse(JSON.stringify(x));
const base=x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,canon(v)]));
test('remote-only edit is adopted without a duplicate write',()=>{const old={t:rec(100)};assert.deepEqual(normalize(merge(old,base(old),{t:rec(200)})),{recs:{t:rec(200)},push:[],del:[]});});
test('local-only edit is sent; simultaneous edits follow documented local priority',()=>{const old={t:rec(100)};for(const remote of [old,{t:rec(300)}]){const result=normalize(merge({t:rec(200)},base(old),remote));assert.deepEqual(result,{recs:{t:rec(200)},push:['t'],del:[]});}});
test('independent edits on two simulated clients converge',()=>{const old={a:rec(100),b:rec(100)};const a={...old,a:rec(200)},b={...old,b:rec(300)};const merged=normalize(merge(a,base(old),b));assert.deepEqual(merged.recs,{a:rec(200),b:rec(300)});assert.deepEqual(normalize(merge(merged.recs,base(merged.recs),merged.recs)),{recs:merged.recs,push:[],del:[]});});
test('unchanged remote deletion does not revive on a clean client',()=>{const old={t:rec(100)};assert.deepEqual(normalize(merge(old,base(old),{})),{recs:{},push:[],del:[]});});
test('local deletion of unchanged remote produces one delete',()=>{const old={t:rec(100)};assert.deepEqual(normalize(merge({},base(old),old)),{recs:{},push:[],del:['t']});});
test('concurrent remote edit survives a local delete per current policy',()=>{const old={t:rec(100)};assert.deepEqual(normalize(merge({},base(old),{t:rec(300)})),{recs:{t:rec(300)},push:[],del:[]});});

test('local edit survives concurrent remote deletion and is sent back',()=>{
  const old={t:rec(100)};
  assert.deepEqual(normalize(merge({t:rec(300)},base(old),{})),{recs:{t:rec(300)},push:['t'],del:[]});
});
test('both clients deleting a record does not create an extra write',()=>{
  assert.deepEqual(normalize(merge({},base({t:rec(100)}),{})),{recs:{},push:[],del:[]});
});
