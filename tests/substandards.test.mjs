import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBSTANDARDS,substandardById,simulateSubstandardTransfer,simulateSeizure,fromTemplate,validateDesign,makeManifest,parseManifest} from '../src/domain.js';

const failedNames=r=>r.checks.filter(c=>!c.pass).map(c=>c.name);
const KYC_OK={certPresent:true,certTrustedIssuer:true,certSignatureValid:true,certNamesSender:true,certExpired:false,paused:false};
const EXT_OK={...KYC_OK,recipientAllowlisted:true,recipientEntryExpired:false,selfTransfer:false};

test('substandard catalog matches the Foundation reference modules',()=>{
  assert.deepEqual(SUBSTANDARDS.map(s=>s.id),['generic','freeze-seize','kyc','kyc-extended']);
  assert.equal(substandardById('generic').source,null);
  for(const id of ['freeze-seize','kyc','kyc-extended']){
    const s=substandardById(id);
    assert.ok(s.source.startsWith('https://github.com/cardano-foundation/cip113-programmable-tokens-platform/'),id);
    assert.ok(s.summary.length>40,id);
  }
  assert.equal(substandardById('nope'),undefined);
});

test('freeze-and-seize checks sender and recipient against the denylist',()=>{
  assert.equal(simulateSubstandardTransfer('freeze-seize',{senderDenylisted:false,recipientDenylisted:false}).allowed,true);
  const sender=simulateSubstandardTransfer('freeze-seize',{senderDenylisted:true,recipientDenylisted:false});
  assert.equal(sender.allowed,false);assert.deepEqual(failedNames(sender),['Sender not denylisted']);
  const recipient=simulateSubstandardTransfer('freeze-seize',{senderDenylisted:false,recipientDenylisted:true});
  assert.equal(recipient.allowed,false);assert.deepEqual(failedNames(recipient),['Recipient not denylisted']);
  const both=simulateSubstandardTransfer('freeze-seize',{senderDenylisted:true,recipientDenylisted:true});
  assert.equal(both.allowed,false);assert.equal(failedNames(both).length,2);
});

test('seizure requires an authorised actor and a denylisted holder',()=>{
  assert.equal(simulateSeizure({actorAuthorised:true,holderDenylisted:true}).allowed,true);
  const clean=simulateSeizure({actorAuthorised:true,holderDenylisted:false});
  assert.equal(clean.allowed,false);assert.deepEqual(failedNames(clean),['Holder is denylisted']);
  const stranger=simulateSeizure({actorAuthorised:false,holderDenylisted:true});
  assert.equal(stranger.allowed,false);assert.deepEqual(failedNames(stranger),['Authorised issuer action']);
  assert.equal(simulateSeizure({actorAuthorised:false,holderDenylisted:false}).allowed,false);
});

test('basic KYC runs the five documented certificate checks, each failing independently',()=>{
  assert.equal(simulateSubstandardTransfer('kyc',KYC_OK).allowed,true);
  assert.equal(simulateSubstandardTransfer('kyc',KYC_OK).checks.length,5);
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc',{...KYC_OK,certTrustedIssuer:false})),['Trusted KYC entity']);
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc',{...KYC_OK,certSignatureValid:false})),['Certificate signature']);
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc',{...KYC_OK,certNamesSender:false})),['Certificate names this sender']);
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc',{...KYC_OK,certExpired:true})),['Certificate still valid']);
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc',{...KYC_OK,paused:true})),['Transfers not paused']);
  // Basic KYC never checks the recipient: recipient fields are not part of the model.
  assert.equal(simulateSubstandardTransfer('kyc',{...KYC_OK}).checks.some(c=>/Recipient/.test(c.name)),false);
});

test('a missing KYC certificate fails the certificate checks but not the pause check',()=>{
  const r=simulateSubstandardTransfer('kyc',{certPresent:false,certTrustedIssuer:false,certSignatureValid:false,certNamesSender:false,certExpired:false,paused:false});
  assert.equal(r.allowed,false);
  assert.deepEqual(failedNames(r),['Trusted KYC entity','Certificate signature','Certificate names this sender','Certificate still valid']);
});

test('KYC extended is additive: sender checks plus recipient allowlist and entry expiry',()=>{
  const ok=simulateSubstandardTransfer('kyc-extended',EXT_OK);
  assert.equal(ok.allowed,true);assert.equal(ok.checks.length,7);
  // Sender-side failures still block even when the recipient is fully valid.
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc-extended',{...EXT_OK,certExpired:true})),['Certificate still valid']);
  // Unlisted recipient fails membership and, transitively, the entry check.
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc-extended',{...EXT_OK,recipientAllowlisted:false})),['Recipient in allowlist','Recipient entry current']);
  // An expired entry fails only the entry-currency check.
  assert.deepEqual(failedNames(simulateSubstandardTransfer('kyc-extended',{...EXT_OK,recipientEntryExpired:true})),['Recipient entry current']);
});

test('KYC extended skips recipient checks for self-transfers only',()=>{
  const self=simulateSubstandardTransfer('kyc-extended',{...EXT_OK,recipientAllowlisted:false,recipientEntryExpired:true,selfTransfer:true});
  assert.equal(self.allowed,true);
  // The exemption never waives the sender certificate: a paused token still blocks a self-transfer.
  assert.equal(simulateSubstandardTransfer('kyc-extended',{...EXT_OK,selfTransfer:true,paused:true}).allowed,false);
});

test('substandard simulators reject generic, unknown, and malformed scenarios',()=>{
  assert.throws(()=>simulateSubstandardTransfer('generic',{}),/Generic PRISM rules/);
  assert.throws(()=>simulateSubstandardTransfer('unknown-module',{}));
  assert.throws(()=>simulateSubstandardTransfer('freeze-seize',{senderDenylisted:'yes',recipientDenylisted:false}),/must be true or false/);
  assert.throws(()=>simulateSubstandardTransfer('kyc',{...KYC_OK,paused:1}),/must be true or false/);
  assert.throws(()=>simulateSeizure({actorAuthorised:true}));
  assert.throws(()=>simulateSeizure(null));
});

test('templates preset a substandard and designs validate it',()=>{
  assert.equal(fromTemplate('stable').substandard,'freeze-seize');
  assert.equal(fromTemplate('credit').substandard,'kyc');
  assert.equal(fromTemplate('rwa').substandard,'kyc-extended');
  assert.equal(fromTemplate('community').substandard,'generic');
  assert.equal(validateDesign(fromTemplate()).length,0);
  assert.ok(validateDesign({...fromTemplate(),substandard:'made-up'}).includes('Unknown substandard module.'));
});

test('manifests carry the substandard, round-trip it, and legacy files default to generic',()=>{
  const d=fromTemplate('stable'),manifest=makeManifest(d,'preview');
  assert.equal(manifest.implementation.substandard.id,'freeze-seize');
  assert.equal(manifest.implementation.substandard.modeledLocally,true);
  assert.deepEqual(parseManifest(JSON.stringify(manifest)),{design:d,network:'preview'});
  const legacy=makeManifest(fromTemplate('credit'),'preprod');delete legacy.design.substandard;
  const imported=parseManifest(JSON.stringify(legacy));
  assert.equal(imported.design.substandard,'generic');
  assert.equal(imported.network,'preprod');
  const forged=makeManifest(fromTemplate(),'preview');forged.design.substandard='evil';
  assert.throws(()=>parseManifest(JSON.stringify(forged)),/Unknown substandard/);
});
