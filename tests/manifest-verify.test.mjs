import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,makeManifest,verifyManifest} from '../src/domain.js';

const genuine=(template,network='preview')=>JSON.stringify(makeManifest(fromTemplate(template),network));
const tampered=(template,fn,network='preview')=>{const m=makeManifest(fromTemplate(template),network);fn(m);return JSON.stringify(m);};

test('every template verifies, and the summary describes its design exactly',()=>{
  for(const t of ['rwa','credit','stable','community','carbon','ticket']){
    const d=fromTemplate(t);
    const m=makeManifest(d,'preview');
    const r=verifyManifest(JSON.stringify(m));
    assert.equal(r.network,'preview');
    assert.equal(r.summary.tokenName,d.tokenName);
    assert.equal(r.summary.ticker,d.ticker);
    assert.equal(r.summary.decimals,d.decimals);
    assert.equal(r.summary.supply,d.supply);
    // The summary's base units are the exporter's own token summary figure.
    assert.equal(r.summary.supplyBaseUnits,m.token.initialSupplyBaseUnits);
    assert.equal(r.summary.template,d.template);
    assert.equal(r.summary.allowlist,d.allowlist);
    assert.equal(r.summary.pausable,d.pausable);
    assert.equal(r.summary.identity,d.identity);
    assert.equal(r.summary.startsPaused,d.paused);
    assert.equal(r.summary.substandardId,d.substandard);
  }
});

test('verification returns no design to apply — verifying cannot become a quiet import',()=>{
  const r=verifyManifest(genuine('rwa'));
  assert.equal('design' in r,false);
  assert.deepEqual(Object.keys(r).sort(),['network','summary']);
});

test('summary amounts are exact base-unit strings, including past 2^53',()=>{
  const d={...fromTemplate('community'),supply:'9007199254740993'};
  const r=verifyManifest(JSON.stringify(makeManifest(d,'preview')));
  assert.equal(r.summary.supply,'9007199254740993');
  assert.equal(r.summary.supplyBaseUnits,'9007199254740993');
});

test('a design with its limit off reports a null limit, never the stale limit field',()=>{
  const d={...fromTemplate('rwa'),limitEnabled:false};
  const r=verifyManifest(JSON.stringify(makeManifest(d,'preview')));
  assert.equal(r.summary.limitEnabled,false);
  assert.equal(r.summary.limit,null);
  assert.equal(r.summary.limitBaseUnits,null);
  const on=verifyManifest(genuine('rwa'));
  assert.equal(on.summary.limit,fromTemplate('rwa').limit);
  assert.equal(on.summary.limitBaseUnits,'10000000000');
});

test('createdAt is carried as the file states it, and is null when unstated or not a string',()=>{
  const m=makeManifest(fromTemplate('rwa'),'preview');
  assert.equal(verifyManifest(JSON.stringify(m)).summary.createdAt,m.createdAt);
  const trimmed=makeManifest(fromTemplate('rwa'),'preview');delete trimmed.createdAt;
  assert.equal(verifyManifest(JSON.stringify(trimmed)).summary.createdAt,null);
  const forged=makeManifest(fromTemplate('rwa'),'preview');forged.createdAt=12345;
  assert.equal(verifyManifest(JSON.stringify(forged)).summary.createdAt,null);
});

test('implementation presence is reported honestly: checked only when present',()=>{
  assert.equal(verifyManifest(genuine('rwa')).summary.implementationChecked,true);
  const m=makeManifest(fromTemplate('rwa'),'preview');delete m.implementation;
  assert.equal(verifyManifest(JSON.stringify(m)).summary.implementationChecked,false);
});

test('verify and import never disagree: tampered files fail verification, naming the field',()=>{
  assert.throws(()=>verifyManifest(tampered('rwa',m=>{m.token.ticker='FRG';})),/does not match its design \(ticker\)/);
  assert.throws(()=>verifyManifest(tampered('rwa',m=>{m.implementation.midnight.proofVerified=true;})),/verified Midnight proof/);
  assert.throws(()=>verifyManifest(tampered('rwa',m=>{m.implementation.required=m.implementation.required.slice(0,3);})),/required steps/);
  assert.throws(()=>verifyManifest(tampered('credit',m=>{m.implementation.substandard.id='freeze-seize';})),/implementation substandard does not match its design \(id\)/);
});

test('a JSON-number amount is refused by verification, never converted',()=>{
  assert.throws(()=>verifyManifest(tampered('rwa',m=>{m.design.supply=1000000;})),/decimal string/);
  assert.throws(()=>verifyManifest(tampered('rwa',m=>{m.design.limit=9007199254740992;})),/decimal string/);
});

test('a registry preview file is not a design manifest and does not verify as one',()=>{
  assert.throws(()=>verifyManifest(JSON.stringify({kind:'prism.registry-datum-preview',previewVersion:1})),/not a supported PRISM design manifest/);
  assert.throws(()=>verifyManifest('not json'),/not valid JSON/);
});

test('a legacy design that never stated a substandard verifies as generic',()=>{
  const m=makeManifest(fromTemplate('community'),'preview');
  delete m.design.substandard;
  const r=verifyManifest(JSON.stringify(m));
  assert.equal(r.summary.substandardId,'generic');
  assert.equal(r.summary.substandardName,'PRISM generic rules');
});

test('verification is pure: the same file verifies identically twice',()=>{
  const raw=genuine('stable');
  assert.deepEqual(verifyManifest(raw),verifyManifest(raw));
});
