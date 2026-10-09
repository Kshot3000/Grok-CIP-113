import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,makeManifest,verifyManifest,diffDesignFile,DESIGN_COMPARE_FIELDS} from '../src/domain.js';

const genuine=(template,network='preview')=>JSON.stringify(makeManifest(fromTemplate(template),network));
const fileOf=(design,network='preview')=>JSON.stringify(makeManifest(design,network));

test('a file describing the current design compares as identical',()=>{
  const d=fromTemplate('rwa');
  const r=diffDesignFile(fileOf(d),d,'preview');
  assert.equal(r.same,true);
  assert.deepEqual(r.differences,[]);
  assert.equal(r.compared,DESIGN_COMPARE_FIELDS.length);
  assert.equal(r.compared,15);
  assert.equal(r.network,'preview');
  assert.equal(r.currentNetwork,'preview');
});

test('comparison returns no design to apply — comparing cannot become a quiet import',()=>{
  const r=diffDesignFile(genuine('rwa'),fromTemplate('credit'),'preview');
  assert.equal('design' in r,false);
  assert.deepEqual(Object.keys(r).sort(),['compared','currentNetwork','currentSummary','differences','fileCreatedAt','fileImplementationChecked','fileSummary','network','same']);
  for(const diff of r.differences) assert.deepEqual(Object.keys(diff).sort(),['current','field','file','label']);
});

test('the two summaries are the verifier\u2019s own summary, minus file metadata',()=>{
  const raw=genuine('stable');
  const r=diffDesignFile(raw,fromTemplate('rwa'),'preview');
  const v=verifyManifest(raw);
  const {createdAt,implementationChecked,...rest}=v.summary;
  assert.deepEqual(r.fileSummary,rest);
  assert.equal('createdAt' in r.fileSummary,false);
  assert.equal('implementationChecked' in r.fileSummary,false);
  // The current side is built by the same builder: verifying a manifest
  // of the current design gives exactly the current summary.
  const vc=verifyManifest(fileOf(fromTemplate('rwa')));
  const {createdAt:_c,implementationChecked:_i,...currentRest}=vc.summary;
  assert.deepEqual(r.currentSummary,currentRest);
});

test('a network difference alone is one difference, named network',()=>{
  const d=fromTemplate('rwa');
  const r=diffDesignFile(fileOf(d,'mainnet'),d,'preview');
  assert.equal(r.same,false);
  assert.deepEqual(r.differences,[{field:'network',label:'Network',file:'mainnet',current:'preview'}]);
});

test('a ticker change is reported with both exact values',()=>{
  const file={...fromTemplate('rwa'),ticker:'PRB'};
  const r=diffDesignFile(fileOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['ticker']);
  assert.equal(r.differences[0].file,'PRB');
  assert.equal(r.differences[0].current,'PRA');
});

test('supply compares exactly past 2^53, in display and base units',()=>{
  const file={...fromTemplate('community'),supply:'9007199254740993'};
  const current={...fromTemplate('community'),supply:'9007199254740992'};
  const r=diffDesignFile(fileOf(file),current,'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['supply','supplyBaseUnits']);
  assert.equal(r.differences[1].file,'9007199254740993');
  assert.equal(r.differences[1].current,'9007199254740992');
});

test('a decimals change with the same supply string differs in base units only',()=>{
  const file={...fromTemplate('rwa'),decimals:0};
  const r=diffDesignFile(fileOf(file),fromTemplate('rwa'),'preview');
  const fields=r.differences.map(x=>x.field);
  assert.ok(fields.includes('decimals'));
  assert.ok(fields.includes('supplyBaseUnits'));
  assert.ok(!fields.includes('supply'));
});

test('turning the limit off differs on the toggle and both limit amounts, the file side null',()=>{
  const file={...fromTemplate('rwa'),limitEnabled:false};
  const r=diffDesignFile(fileOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['limitEnabled','limit','limitBaseUnits']);
  assert.equal(r.differences[1].file,null);
  assert.equal(r.differences[1].current,fromTemplate('rwa').limit);
});

test('a substandard change is a single difference carrying the module ids',()=>{
  const file={...fromTemplate('credit'),substandard:'freeze-seize'};
  const r=diffDesignFile(fileOf(file),fromTemplate('credit'),'preview');
  const sub=r.differences.filter(x=>x.field==='substandard');
  assert.equal(sub.length,1);
  assert.equal(sub[0].file,'freeze-seize');
  assert.equal(sub[0].current,'kyc');
  assert.ok(!r.differences.some(x=>x.field==='substandardName'));
});

test('differences are reported in the canonical field order, not edit order',()=>{
  const file={...fromTemplate('rwa'),ticker:'ZZZ',allowlist:false,paused:true};
  const r=diffDesignFile(fileOf(file),fromTemplate('rwa'),'preview');
  assert.deepEqual(r.differences.map(x=>x.field),['ticker','allowlist','startsPaused']);
  const order=DESIGN_COMPARE_FIELDS.map(([f])=>f);
  const idx=r.differences.map(x=>order.indexOf(x.field));
  assert.deepEqual(idx,[...idx].sort((a,b)=>a-b));
});

test('file metadata is reported separately and never counts as a difference',()=>{
  const d=fromTemplate('rwa');
  const m=makeManifest(d,'preview');
  const r=diffDesignFile(JSON.stringify(m),d,'preview');
  assert.equal(r.same,true);
  assert.equal(r.fileCreatedAt,m.createdAt);
  assert.equal(r.fileImplementationChecked,true);
  const trimmed=makeManifest(d,'preview');delete trimmed.implementation;delete trimmed.createdAt;
  const r2=diffDesignFile(JSON.stringify(trimmed),d,'preview');
  assert.equal(r2.same,true);
  assert.equal(r2.fileCreatedAt,null);
  assert.equal(r2.fileImplementationChecked,false);
});

test('a tampered file is refused whole with the import\u2019s reason, never partially compared',()=>{
  const m=makeManifest(fromTemplate('rwa'),'preview');m.token.ticker='FRG';
  assert.throws(()=>diffDesignFile(JSON.stringify(m),fromTemplate('rwa'),'preview'),/does not match its design \(ticker\)/);
  assert.throws(()=>diffDesignFile('not json',fromTemplate('rwa'),'preview'),/not valid JSON/);
});

test('an invalid current design or unknown current network is refused before comparing',()=>{
  const bad={...fromTemplate('rwa'),ticker:'lowercase',supply:'0'};
  assert.throws(()=>diffDesignFile(genuine('rwa'),bad,'preview'),/Your current design cannot be compared yet/);
  assert.throws(()=>diffDesignFile(genuine('rwa'),fromTemplate('rwa'),'nowhere'),/Unknown current network/);
  assert.throws(()=>diffDesignFile(genuine('rwa'),null,'preview'),/no current design/);
});

test('comparison is pure: inputs are not mutated and repeated calls agree',()=>{
  const current=fromTemplate('credit');
  const snapshot=JSON.stringify(current);
  const raw=genuine('stable');
  const a=diffDesignFile(raw,current,'preview');
  const b=diffDesignFile(raw,current,'preview');
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(current),snapshot);
});
