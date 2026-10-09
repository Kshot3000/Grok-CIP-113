import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,registryDatumPreview,parseRegistryDatumPreview,diffRegistryDatumPreview,REGISTRY_COMPARE_FIELDS} from '../src/domain.js';

const genuine=(template,network='preview')=>JSON.stringify(registryDatumPreview(fromTemplate(template),network));
const previewOf=(design,network='preview')=>JSON.stringify(registryDatumPreview(design,network));

test('a preview of the current design compares as identical',()=>{
  const d=fromTemplate('rwa');
  const r=diffRegistryDatumPreview(previewOf(d),d,'preview');
  assert.equal(r.same,true);
  assert.deepEqual(r.differences,[]);
  assert.equal(r.compared,REGISTRY_COMPARE_FIELDS.length);
  assert.equal(r.compared,10);
  assert.equal(r.network,'preview');
  assert.equal(r.currentNetwork,'preview');
});

test('comparison returns no design to apply — comparing cannot become a quiet import',()=>{
  const r=diffRegistryDatumPreview(genuine('rwa'),fromTemplate('credit'),'preview');
  assert.equal('design' in r,false);
  assert.deepEqual(Object.keys(r).sort(),['compared','currentNetwork','currentPreview','differences','filePreview','network','same']);
  for(const diff of r.differences) assert.deepEqual(Object.keys(diff).sort(),['current','field','file','label']);
});

test('both sides are the canonical previews the exporter and verifier themselves produce',()=>{
  const raw=genuine('stable');
  const r=diffRegistryDatumPreview(raw,fromTemplate('rwa'),'preview');
  assert.deepEqual(r.filePreview,parseRegistryDatumPreview(raw));
  assert.deepEqual(r.currentPreview,registryDatumPreview(fromTemplate('rwa'),'preview'));
});

test('a network difference alone is one difference, named network',()=>{
  const d=fromTemplate('rwa');
  const r=diffRegistryDatumPreview(previewOf(d,'mainnet'),d,'preview');
  assert.equal(r.same,false);
  assert.deepEqual(r.differences,[{field:'network',label:'Network',file:'mainnet',current:'preview'}]);
});

test('a ticker change is reported with both exact values',()=>{
  const file={...fromTemplate('rwa'),ticker:'PRB'};
  const r=diffRegistryDatumPreview(previewOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['ticker']);
  assert.equal(r.differences[0].file,'PRB');
  assert.equal(r.differences[0].current,'PRA');
});

test('supply compares exactly past 2^53, as base-unit strings',()=>{
  const file={...fromTemplate('community'),supply:'9007199254740993',decimals:0};
  const current={...fromTemplate('community'),supply:'9007199254740992',decimals:0};
  const r=diffRegistryDatumPreview(previewOf(file),current,'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['supplyBaseUnits']);
  assert.equal(r.differences[0].file,'9007199254740993');
  assert.equal(r.differences[0].current,'9007199254740992');
});

test('an allowlist change differs on transfer access alone',()=>{
  const file={...fromTemplate('rwa'),allowlist:false};
  const r=diffRegistryDatumPreview(previewOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences,[{field:'access',label:'Transfer access',file:'open',current:'allowlist'}]);
});

test('turning the limit off differs on the per-transfer limit alone, the file side null',()=>{
  const file={...fromTemplate('rwa'),limitEnabled:false};
  const r=diffRegistryDatumPreview(previewOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['perTransferLimit']);
  assert.equal(r.differences[0].file,null);
  assert.notEqual(r.differences[0].current,null);
});

test('pause and eligibility toggles each differ on their own field',()=>{
  const file={...fromTemplate('rwa'),pausable:false,identity:false};
  const r=diffRegistryDatumPreview(previewOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['issuerPauseModeled','eligibilityRequired']);
  assert.deepEqual(r.differences.map(x=>x.file),[false,false]);
});

test('a substandard change is a single difference carrying the module ids',()=>{
  const file={...fromTemplate('credit'),substandard:'freeze-seize'};
  const r=diffRegistryDatumPreview(previewOf(file),fromTemplate('credit'),'preview');
  const sub=r.differences.filter(x=>x.field==='substandard');
  assert.equal(sub.length,1);
  assert.equal(sub[0].file,'freeze-seize');
  assert.equal(sub[0].current,'kyc');
  assert.ok(!r.differences.some(x=>['substandardName','substandardReference'].includes(x.field)));
});

test('differences are reported in the canonical field order, not edit order',()=>{
  const file={...fromTemplate('rwa'),ticker:'ZZZ',allowlist:false,identity:false};
  const r=diffRegistryDatumPreview(previewOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['ticker','access','eligibilityRequired']);
  const order=REGISTRY_COMPARE_FIELDS.map(([f])=>f);
  const idx=r.differences.map(x=>order.indexOf(x.field));
  assert.deepEqual(idx,[...idx].sort((a,b)=>a-b));
});

test('a hand-trimmed file omitting the canonical sections compares as identical, not different',()=>{
  // The verifier completes omitted flags / still-required list / note
  // canonically, so their absence in the file is not a design
  // difference — counting it would make every trimmed genuine preview
  // read as a different design from its own export.
  const d=fromTemplate('rwa');
  const p=registryDatumPreview(d,'preview');
  delete p.applicationSpecific;delete p.cipDatum;delete p.registeredOnChain;delete p.registryFieldsStillRequired;delete p.note;
  const r=diffRegistryDatumPreview(JSON.stringify(p),d,'preview');
  assert.equal(r.same,true);
  assert.deepEqual(r.filePreview,r.currentPreview);
});

test('a tampered file is refused whole with the verifier\u2019s reason, never partially compared',()=>{
  const p=registryDatumPreview(fromTemplate('rwa'),'preview');p.cipDatum=true;
  assert.throws(()=>diffRegistryDatumPreview(JSON.stringify(p),fromTemplate('rwa'),'preview'),/never is/);
  const q=registryDatumPreview(fromTemplate('rwa'),'preview');q.policyId='a'.repeat(56);
  assert.throws(()=>diffRegistryDatumPreview(JSON.stringify(q),fromTemplate('rwa'),'preview'),/unexpected top-level field \(policyId\)/);
  const s=registryDatumPreview(fromTemplate('rwa'),'preview');s.token.initialSupplyBaseUnits=1000;
  assert.throws(()=>diffRegistryDatumPreview(JSON.stringify(s),fromTemplate('rwa'),'preview'),/exact decimal string/);
  assert.throws(()=>diffRegistryDatumPreview('not json',fromTemplate('rwa'),'preview'),/not valid JSON/);
});

test('an invalid current design or unknown current network is refused before comparing',()=>{
  const bad={...fromTemplate('rwa'),ticker:'lowercase',supply:'0'};
  assert.throws(()=>diffRegistryDatumPreview(genuine('rwa'),bad,'preview'),/Your current design cannot be compared yet/);
  assert.throws(()=>diffRegistryDatumPreview(genuine('rwa'),fromTemplate('rwa'),'nowhere'),/Unknown current network/);
  assert.throws(()=>diffRegistryDatumPreview(genuine('rwa'),null,'preview'),/no current design/);
});

test('comparison is pure: inputs are not mutated and repeated calls agree',()=>{
  const current=fromTemplate('credit');
  const snapshot=JSON.stringify(current);
  const raw=genuine('stable');
  const a=diffRegistryDatumPreview(raw,current,'preview');
  const b=diffRegistryDatumPreview(raw,current,'preview');
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(current),snapshot);
});
