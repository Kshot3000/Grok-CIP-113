import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,registryDatumPreview,parseRegistryDatumPreview,REGISTRY_FIELDS_STILL_REQUIRED,REGISTRY_PREVIEW_NOTE} from '../src/domain.js';

const genuine=(template,network='preview')=>registryDatumPreview(fromTemplate(template),network);
const tampered=(template,fn,network='preview')=>{const p=genuine(template,network);fn(p);return JSON.stringify(p);};

test('genuine previews for every template verify and return the canonical preview exactly',()=>{
  for(const t of ['rwa','credit','stable','community','carbon','ticket']){
    const p=genuine(t);
    assert.deepEqual(parseRegistryDatumPreview(JSON.stringify(p)),p);
  }
});

test('verification is deterministic and the canonical constants are what the exporter writes',()=>{
  const p=genuine('stable','preprod');
  assert.deepEqual(p.registryFieldsStillRequired,[...REGISTRY_FIELDS_STILL_REQUIRED]);
  assert.equal(p.note,REGISTRY_PREVIEW_NOTE);
  assert.equal(JSON.stringify(parseRegistryDatumPreview(JSON.stringify(p))),JSON.stringify(p));
});

test('a preview claiming to be a CIP datum or an on-chain registration is rejected',()=>{
  // These three flags are the preview's honesty identity: flipping any one
  // turns a design aid into a false claim about deployed chain state.
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.cipDatum=true;})),/never is/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.registeredOnChain=true;})),/registers nothing/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.applicationSpecific=false;})),/application-specific/);
});

test('amounts must be canonical exact decimal strings: numbers, padding, and fractions are rejected, never converted',()=>{
  for(const value of [1000000000000,1.5,true,null]) {
    assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.initialSupplyBaseUnits=value;})),/exact decimal string/,`supply=${String(value)}`);
  }
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.initialSupplyBaseUnits='01000000000000';})),/not a canonical decimal string/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.initialSupplyBaseUnits='1000.5';})),/not a canonical decimal string/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.initialSupplyBaseUnits='0';})),/greater than zero/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.initialSupplyBaseUnits='9223372036854775808';})),/signed 64-bit/);
  // The exact string past float precision verifies bit-for-bit.
  const d={...fromTemplate('community'),supply:'9007199254740993'};
  assert.equal(parseRegistryDatumPreview(JSON.stringify(registryDatumPreview(d,'preview'))).token.initialSupplyBaseUnits,'9007199254740993');
});

test('the per-transfer limit must be null or a canonical amount no larger than the supply',()=>{
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.transferPolicy.perTransferLimitBaseUnits=10000000000;})),/exact decimal string/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.transferPolicy.perTransferLimitBaseUnits='2000000000000';})),/larger than its initial supply/);
  const open=parseRegistryDatumPreview(JSON.stringify(genuine('community')));
  assert.equal(open.transferPolicy.perTransferLimitBaseUnits,'1');
  const noCap=parseRegistryDatumPreview(JSON.stringify(registryDatumPreview({...fromTemplate('community'),limitEnabled:false},'preview')));
  assert.equal(noCap.transferPolicy.perTransferLimitBaseUnits,null);
});

test('fields PRISM never writes are refused, at every level — a smuggled policyId is the claim this check exists for',()=>{
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.policyId='a'.repeat(56);})),/unexpected top-level field \(policyId\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.cbor='84a400';})),/unexpected top-level field \(cbor\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.policyId='a'.repeat(56);})),/unexpected token field \(policyId\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.transferPolicy.datumHash='b'.repeat(64);})),/unexpected transfer policy field \(datumHash\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.substandard.txHash='c'.repeat(64);})),/unexpected substandard field \(txHash\)/);
});

test('the substandard section must match the catalog field by field',()=>{
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.substandard.id='kyc';})),/does not match PRISM's catalog \(name\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.substandard.name='Forged module';})),/does not match PRISM's catalog \(name\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.substandard.reference='https://example.invalid/forged';})),/does not match PRISM's catalog \(reference\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.substandard.modeledLocally=false;})),/does not match PRISM's catalog \(modeledLocally\)/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.substandard.id='does-not-exist';})),/unknown substandard/);
  // The generic module's reference is null, and that null is checked too.
  assert.throws(()=>parseRegistryDatumPreview(tampered('community',p=>{p.substandard.reference='https://example.invalid/forged';})),/does not match PRISM's catalog \(reference\)/);
});

test('the still-required list and the note cannot be shortened, reordered, or rewritten',()=>{
  // Dropping the Plutus Data / CBOR item is the edit this check exists
  // for: the handed-off preview would otherwise read as closer to a real
  // registry entry than PRISM ever claimed.
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.registryFieldsStillRequired=p.registryFieldsStillRequired.filter(s=>!s.includes('CBOR'));})),/still-required list does not match/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.registryFieldsStillRequired=[...p.registryFieldsStillRequired].reverse();})),/still-required list does not match/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.note='This token is registered on chain.';})),/note does not match/);
});

test('token identity and transfer policy are validated as exported',()=>{
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.name='  Padded Name  ';})),/no padding/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.ticker='bad ticker';})),/ticker must/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.token.decimals=7;})),/decimals must/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.transferPolicy.access='closed';})),/allowlist or open/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.transferPolicy.issuerPauseModeled='yes';})),/must be true or false/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.transferPolicy.eligibilityRequired=1;})),/must be true or false/);
});

test('hand-trimmed files may omit the flags, still-required list, and note — the return completes them canonically',()=>{
  const p=genuine('credit');delete p.applicationSpecific;delete p.cipDatum;delete p.registeredOnChain;delete p.registryFieldsStillRequired;delete p.note;
  assert.deepEqual(parseRegistryDatumPreview(JSON.stringify(p)),genuine('credit'));
});

test('malformed containers fail with clear errors, not crashes',()=>{
  assert.throws(()=>parseRegistryDatumPreview('not json'),/not valid JSON/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.kind='prism.cip113-design';})),/not a supported PRISM registry preview/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.previewVersion=2;})),/not a supported PRISM registry preview/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{p.network='fake-net';})),/not a supported PRISM registry preview/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{delete p.token;})),/missing its token section/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{delete p.transferPolicy;})),/missing its transfer policy/);
  assert.throws(()=>parseRegistryDatumPreview(tampered('rwa',p=>{delete p.substandard;})),/missing its substandard section/);
});
