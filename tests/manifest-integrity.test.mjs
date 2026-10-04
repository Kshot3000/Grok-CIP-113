import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,makeManifest,parseManifest} from '../src/domain.js';

const roundTrip=(template,network='preview')=>makeManifest(fromTemplate(template),network);
const tampered=(template,fn,network='preview')=>{const m=roundTrip(template,network);fn(m);return JSON.stringify(m);};

test('genuine manifests for every template still import and round-trip exactly',()=>{
  for(const t of ['rwa','credit','stable','community']){
    const m=roundTrip(t);
    assert.deepEqual(parseManifest(JSON.stringify(m)),{design:fromTemplate(t),network:'preview'});
    assert.equal(JSON.stringify(makeManifest(parseManifest(JSON.stringify(m)).design,'preview').token),JSON.stringify(m.token));
  }
});

test('amounts must be decimal strings: JSON numbers are rejected, never converted',()=>{
  // A JSON number has already lost precision at JSON.parse time (2^53+1
  // becomes 2^53) — accepting one would silently redesign the supply.
  for(const value of [1000000,9007199254740992,0,1.5,true,null]) {
    assert.throws(()=>parseManifest(tampered('rwa',m=>{m.design.supply=value;})),/decimal string/,`supply=${String(value)}`);
    assert.throws(()=>parseManifest(tampered('rwa',m=>{m.design.limit=value;})),/decimal string/,`limit=${String(value)}`);
  }
});

test('exact string amounts beyond float precision import bit-for-bit',()=>{
  const d={...fromTemplate('community'),supply:'9007199254740993'};
  const m=makeManifest(d,'preview');
  assert.equal(m.token.initialSupplyBaseUnits,'9007199254740993');
  assert.equal(parseManifest(JSON.stringify(m)).design.supply,'9007199254740993');
});

test('token summary must match the design: each field is cross-checked',()=>{
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.token.name='Forged Token';})),/does not match its design \(name\)/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.token.ticker='FRG';})),/does not match its design \(ticker\)/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.token.decimals=0;})),/does not match its design \(decimals\)/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.token.initialSupplyBaseUnits='1';})),/does not match its design \(initialSupplyBaseUnits\)/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.token.initialSupplyBaseUnits=1000000000000;})),/does not match its design/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{delete m.token;})),/missing its token summary/);
});

test('forged honesty claims are rejected instead of silently dropped',()=>{
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.status='deployed';})),/design-only/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation.standardStatus='Active';})),/other than Proposed/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation.standard='CIP-999';})),/other than CIP-113/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation.midnight.proofVerified=true;})),/cannot back/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation.midnight.bridgeDeployed=true;})),/cannot back/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation.realfi.affiliation=true;})),/cannot back/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation.realfi.productIssued=true;})),/cannot back/);
});

test('hand-trimmed files may omit status and implementation, but not contradict them',()=>{
  const m=roundTrip('credit');delete m.status;delete m.implementation;
  assert.deepEqual(parseManifest(JSON.stringify(m)),{design:fromTemplate('credit'),network:'preview'});
});

test('incidental whitespace is canonicalised so design and summary agree',()=>{
  // The studio can save a draft whose name was typed with padding; the
  // manifest summary is trimmed at export, so import trims the design too.
  const d={...fromTemplate('rwa'),tokenName:'  Prism Real Asset  ',supply:' 1000000 ',limit:' 10000 '};
  const m=makeManifest(d,'preview');
  const imported=parseManifest(JSON.stringify(m));
  assert.equal(imported.design.tokenName,'Prism Real Asset');
  assert.equal(imported.design.supply,'1000000');
  assert.equal(imported.design.limit,'10000');
});

test('malformed containers fail with clear errors, not crashes',()=>{
  const d=fromTemplate('rwa');
  assert.throws(()=>parseManifest('not json'),/not valid JSON/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.design=null;})),/no design section/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.design=[d];})),/no design section/);
  assert.throws(()=>parseManifest(tampered('rwa',m=>{m.implementation='deployed';})),/malformed implementation/);
});
