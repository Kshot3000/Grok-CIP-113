import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,simulateBasicKycSequence,simulateSubstandardTransfer,MAX_BASIC_KYC_STEPS,KYC_ENTITIES} from '../src/domain.js';

const design=fromTemplate('rwa'); // supply 1,000,000 PRA, 6 decimals
const failedNames=s=>s.checks.filter(c=>!c.pass).map(c=>c.name);
const sumBalances=r=>Object.values(r.balances).reduce((a,v)=>a+BigInt(v),0n);
const U=1000000n;

const TRUST_REVOKED=[
  {kind:'transfer',from:'issuer',to:'approved',amount:'250',cert:'valid',entity:'entity-a'},
  {kind:'trust',entity:'entity-a',trusted:false},
  {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid',entity:'entity-a'},
  {kind:'trust',entity:'entity-a',trusted:true},
  {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid',entity:'entity-a'},
];
const SECOND_ENTITY=[
  {kind:'transfer',from:'issuer',to:'approved',amount:'200',cert:'valid',entity:'entity-b'},
  {kind:'trust',entity:'entity-b',trusted:true},
  {kind:'transfer',from:'issuer',to:'approved',amount:'200',cert:'valid',entity:'entity-b'},
  {kind:'trust',entity:'entity-a',trusted:false},
  {kind:'transfer',from:'approved',to:'issuer',amount:'50',cert:'valid',entity:'entity-b'},
];
const RECIPIENT_NOT_CHECKED=[
  {kind:'transfer',from:'issuer',to:'pending',amount:'150',cert:'valid',entity:'entity-a'},
  {kind:'transfer',from:'pending',to:'approved',amount:'50',cert:'expired',entity:'entity-a'},
  {kind:'pause',paused:true},
  {kind:'transfer',from:'pending',to:'approved',amount:'50',cert:'valid',entity:'entity-a'},
  {kind:'pause',paused:false},
  {kind:'transfer',from:'pending',to:'approved',amount:'50',cert:'valid',entity:'entity-a'},
];

test('revoking a trusted entity blocks its later certificates on the trust check alone; restoring it restores them',()=>{
  const r=simulateBasicKycSequence(design,TRUST_REVOKED);
  assert.equal(r.invalid,false);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,false,true,true]);
  assert.equal(r.appliedCount,4);
  // The blocked transfer's certificate is valid in every other respect and
  // its signer was trusted when the sequence began: trust is read from the
  // list as it stands at that step.
  assert.deepEqual(failedNames(r.steps[2]),['Trusted KYC entity']);
  assert.equal(r.transferredBaseUnits,(350n*U).toString());
  assert.equal(r.balances.approved,(150n*U).toString());
  assert.equal(r.balances.pending,(100n*U).toString());
  assert.deepEqual(r.trusted,['entity-a']);
  assert.equal(r.paused,false);
});

test('revocation is not retroactive: transfers applied while the entity was trusted stay applied',()=>{
  const r=simulateBasicKycSequence(design,TRUST_REVOKED);
  assert.equal(r.steps[1].balancesAfter.approved,(250n*U).toString(), 'the pre-revocation funding survives the revocation step');
  assert.equal(r.steps[2].balancesAfter.approved,(250n*U).toString(), 'the blocked transfer moved nothing');
  assert.deepEqual(r.steps[1].trustedAfter,[]);
  assert.deepEqual(r.steps[3].trustedAfter,['entity-a']);
});

test('a second entity starts untrusted, is added mid-lifecycle, and is unaffected by revoking the first',()=>{
  const r=simulateBasicKycSequence(design,SECOND_ENTITY);
  assert.deepEqual(r.steps.map(s=>s.allowed),[false,true,true,true,true]);
  assert.equal(r.appliedCount,4);
  assert.deepEqual(failedNames(r.steps[0]),['Trusted KYC entity']);
  assert.equal(r.transferredBaseUnits,(250n*U).toString());
  assert.deepEqual(r.trusted,['entity-b']);
  assert.equal(KYC_ENTITIES['entity-a'].name,'KYC entity A');
  assert.equal(KYC_ENTITIES['entity-b'].name,'KYC entity B');
});

test('basic KYC checks the sender only: recipients are never checked, and a self-transfer still needs a certificate',()=>{
  const r=simulateBasicKycSequence(design,RECIPIENT_NOT_CHECKED);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,false,true,false,true,true]);
  assert.equal(r.appliedCount,4);
  // Pending is on no list anywhere in this module — the transfer to it
  // passes on the sender's certificate alone, and no step anywhere in the
  // sequence carries a recipient check.
  for(const s of r.steps) if(s.kind==='transfer') assert.ok(!s.checks.some(c=>/recipient/i.test(c.name)), s.checks.map(c=>c.name).join(','));
  assert.deepEqual(failedNames(r.steps[1]),['Certificate still valid']);
  assert.deepEqual(failedNames(r.steps[3]),['Transfers not paused']);
  assert.equal(r.transferredBaseUnits,(200n*U).toString());
  const self=simulateBasicKycSequence(design,[{kind:'transfer',from:'issuer',to:'issuer',amount:'10',cert:'missing',entity:'entity-a'}]);
  assert.equal(self.steps[0].allowed,false, 'unlike KYC extended, there is no recipient check for a self-transfer to skip — the sender certificate is still required');
});

test('each modeled certificate state fails exactly the checks the single-shot lab names',()=>{
  const cases={
    'bad-signature':['Certificate signature'],
    'wrong-sender':['Certificate names this sender'],
    expired:['Certificate still valid'],
    missing:['Trusted KYC entity','Certificate signature','Certificate names this sender','Certificate still valid'],
  };
  for(const [cert,fails] of Object.entries(cases)) {
    const r=simulateBasicKycSequence(design,[{kind:'transfer',from:'issuer',to:'approved',amount:'10',cert,entity:'entity-a'}]);
    assert.equal(r.steps[0].allowed,false,cert);
    assert.deepEqual(failedNames(r.steps[0]),fails,cert);
    // And the sequence verdicts are the single-shot lab's own verdicts.
    const single=simulateSubstandardTransfer('kyc',{certPresent:cert!=='missing',certTrustedIssuer:true,certSignatureValid:cert!=='bad-signature'&&cert!=='missing',certNamesSender:cert!=='wrong-sender'&&cert!=='missing',certExpired:cert==='expired',paused:false});
    assert.deepEqual(r.steps[0].checks.slice(1).map(c=>c.name),single.checks.map(c=>c.name),cert);
  }
});

test('trust and pause updates are idempotent state changes, recorded as applied',()=>{
  const r=simulateBasicKycSequence(design,[
    {kind:'trust',entity:'entity-a',trusted:true},
    {kind:'trust',entity:'entity-b',trusted:false},
    {kind:'pause',paused:false},
    {kind:'pause',paused:true},
    {kind:'pause',paused:true},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,true,true,true]);
  assert.match(r.steps[0].checks[0].detail,/already on the modeled trusted-entity list/);
  assert.match(r.steps[1].checks[0].detail,/already off the modeled trusted-entity list/);
  assert.match(r.steps[4].checks[0].detail,/already paused/);
  assert.deepEqual(r.trusted,['entity-a']);
  assert.equal(r.paused,true);
});

test('only the module checks are modeled: generic toggles do not gate this lab',()=>{
  const hostile={...design,allowlist:true,limit:'10',paused:true,identity:true};
  const r=simulateBasicKycSequence(hostile,[
    {kind:'transfer',from:'issuer',to:'pending',amount:'250',cert:'valid',entity:'entity-a'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true]);
  assert.equal(r.balances.pending,(250n*U).toString());
});

test('a blocked funding transfer leaves a knock-on balance failure downstream',()=>{
  const r=simulateBasicKycSequence(design,[
    {kind:'trust',entity:'entity-a',trusted:false},
    {kind:'transfer',from:'issuer',to:'approved',amount:'250',cert:'valid',entity:'entity-a'},
    {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid',entity:'entity-a'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,false,false]);
  assert.deepEqual(failedNames(r.steps[2]),['Sender balance','Trusted KYC entity']);
  assert.equal(r.transferredBaseUnits,'0');
});

test('modeled balances always sum to the designed supply',()=>{
  for(const steps of [TRUST_REVOKED,SECOND_ENTITY,RECIPIENT_NOT_CHECKED]) {
    const r=simulateBasicKycSequence(design,steps);
    assert.equal(sumBalances(r),1000000n*U);
    for(const s of r.steps) assert.equal(Object.values(s.balancesAfter).reduce((a,v)=>a+BigInt(v),0n),1000000n*U);
  }
});

test('malformed steps are blocked steps, not throws; a malformed sequence throws',()=>{
  const r=simulateBasicKycSequence(design,[
    {kind:'teleport',from:'issuer',to:'approved',amount:'1'},
    {kind:'transfer',from:'issuer',to:'nobody',amount:'1',cert:'valid',entity:'entity-a'},
    {kind:'transfer',from:'issuer',to:'approved',amount:'-5',cert:'valid',entity:'entity-a'},
    {kind:'transfer',from:'issuer',to:'approved',amount:'1',cert:'untrusted',entity:'entity-a'},
    {kind:'transfer',from:'issuer',to:'approved',amount:'1',cert:'valid',entity:'entity-z'},
    {kind:'trust',entity:'entity-z',trusted:true},
    {kind:'pause',paused:'yes'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[false,false,false,false,false,false,false]);
  assert.equal(r.steps[0].checks[0].name,'Known step kind');
  assert.equal(r.steps[1].checks[0].name,'Known accounts');
  assert.equal(r.steps[2].checks[0].name,'Valid amount');
  assert.equal(r.steps[3].checks[0].name,'Known certificate state');
  assert.match(r.steps[3].checks[0].detail,/no untrusted state here/);
  assert.equal(r.steps[4].checks[0].name,'Known certificate signer');
  assert.equal(r.steps[5].checks[0].name,'Known entity and update');
  assert.equal(r.steps[6].checks[0].name,'Pause update');
  assert.throws(()=>simulateBasicKycSequence(design,[]),/between 1 and 12/);
  assert.throws(()=>simulateBasicKycSequence(design,Array(13).fill({kind:'pause',paused:true})),/between 1 and 12/);
  assert.equal(MAX_BASIC_KYC_STEPS,12);
  assert.throws(()=>simulateBasicKycSequence(design,[null]),/Lifecycle step 1/);
});

test('an invalid design reports invalid with no steps evaluated',()=>{
  const r=simulateBasicKycSequence({...design,ticker:'bad ticker!'},TRUST_REVOKED);
  assert.equal(r.invalid,true);
  assert.deepEqual(r.steps,[]);
  assert.equal(r.appliedCount,0);
  assert.deepEqual(r.trusted,['entity-a']);
  assert.equal(sumBalances(r),1000000n*U);
});
