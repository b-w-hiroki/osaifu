import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const src=readFileSync('app.js','utf8');
const marker="const esc =";
const start=src.indexOf(marker);
const end=src.indexOf("\n",start);
const escape=runInNewContext(src.slice(start,end)+';esc');
test('production escape keeps hostile imported values as text',()=>{
 const value="\"<img src=x onerror=alert(1)>'&";
 const safe=escape(value); assert.ok(!/[<>"']/.test(safe)); assert.ok(safe.includes('&lt;'));
});
test('boundary 1 stays escaped',()=>assert.ok(src.includes("${esc(it.bill.id)}")));
test('boundary 2 stays escaped',()=>assert.ok(src.includes("${esc(t.id)}")));
test('boundary 3 stays escaped',()=>assert.ok(src.includes("${esc(w.id)}")));
test('boundary 4 stays escaped',()=>assert.ok(src.includes("${esc(v.id)}")));
test('boundary 5 stays escaped',()=>assert.ok(src.includes("${esc(it.bill.tag || freqLabel(it.bill))}")));
