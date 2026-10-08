import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,simulateKycSequence,MAX_KYC_STEPS} from '../src/domain.js';

const design=fromTemplate('rwa'); // KYC extended, supply 1,000,000 PRA, 6 decimals
const failedNames=s=>s.checks.filter(c=>!c.pass).map(c=>c.name);
const sumBalances=r=>Object.values(r.balances).reduce((a,v)=>a+BigInt(v),0n);
const U=1000000n;

const ENTRY_EXPIRES=[
  {kind:'allowlist',account:'approved',listed:true},
  {kind:'allowlist',account:'pending',listed:true},
  {kind:'transfer',from:'issuer',to:'approved',amount:'250',cert:'valid'},
  {kind:'allowlist',account:'approved',listed:true,expired:true},
  {kind:'transfer',from:'issuer',to:'approved',amount:'100',cert:'valid'},
  {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid'},
  {kind:'allowlist',account:'approved',listed:true,expired:false},
  {kind:'transfer',from:'issuer',to:'approved',amount:'100',cert:'valid'},
];
const CERT_AND_PAUSE=[
  {kind:'allowlist',account:'approved',listed:true},
  {kind:'allowlist',account:'issuer',listed:true},
  {kind:'transfer',from:'issuer',to:'approved',amount:'250',cert:'valid'},
  {kind:'transfer',from:'approved',to:'issuer',amount:'100',cert:'expired'},
  {kind:'pause',paused:true},
  {kind:'transfer',from:'approved',to:'issuer',amount:'100',cert:'valid'},
  {kind:'pause',paused:false},
  {kind:'transfer',from:'approved',to:'issuer',amount:'100',cert:'valid'},
];
const NEVER_LISTED=[
  {kind:'allowlist',account:'approved',listed:true},
  {kind:'transfer',from:'issuer',to:'approved',amount:'200',cert:'valid'},
  {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid'},
  {kind:'transfer',from:'issuer',to:'issuer',amount:'50',cert:'valid'},
  {kind:'allowlist',account:'pending',listed:true},
  {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid'},
];

test('an entry expiring mid-lifecycle blocks the same transfer its renewal restores',()=>{
  const r=simulateKycSequence(design,ENTRY_EXPIRES);
  assert.equal(r.invalid,false);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,true,true,false,true,true,true]);
  assert.equal(r.appliedCount,7);
  // The blocked transfer carries a valid certificate and a listed recipient:
  // it fails on the entry's expiry alone.
  assert.deepEqual(failedNames(r.steps[4]),['Recipient entry current']);
  // Expiry is a recipient-side state: the expired holder can still SEND to a
  // current recipient in the same sequence.
  assert.equal(r.steps[5].allowed,true);
  assert.equal(r.transferredBaseUnits,(450n*U).toString());
  assert.equal(r.balances.issuer,(999650n*U).toString());
  assert.equal(r.balances.approved,(250n*U).toString());
  assert.equal(r.balances.pending,(100n*U).toString());
  assert.deepEqual(r.allowlist,{approved:{expired:false},pending:{expired:false}});
  assert.equal(r.paused,false);
});

test('the allowlist and pause as they stand at each step are what later steps are checked against',()=>{
  const r=simulateKycSequence(design,ENTRY_EXPIRES);
  assert.deepEqual(r.steps[0].allowlistAfter,{approved:{expired:false}});
  assert.deepEqual(r.steps[3].allowlistAfter.approved,{expired:true});
  assert.deepEqual(r.steps[6].allowlistAfter.approved,{expired:false});
  assert.equal(r.steps[4].balancesAfter.approved,(250n*U).toString(), 'the blocked transfer moved nothing');
  const p=simulateKycSequence(design,CERT_AND_PAUSE);
  assert.equal(p.steps[4].pausedAfter,true);
  assert.equal(p.steps[6].pausedAfter,false);
});

test('a certificate expiring and a pause each block independently, in sequence',()=>{
  const r=simulateKycSequence(design,CERT_AND_PAUSE);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,true,false,true,false,true,true]);
  assert.equal(r.appliedCount,6);
  assert.deepEqual(failedNames(r.steps[3]),['Certificate still valid']);
  assert.deepEqual(failedNames(r.steps[5]),['Transfers not paused']);
  assert.equal(r.transferredBaseUnits,(350n*U).toString());
  assert.equal(r.balances.approved,(150n*U).toString());
  assert.equal(r.balances.issuer,(999850n*U).toString());
});

test('a never-listed recipient fails both recipient checks; a self-transfer skips them',()=>{
  const r=simulateKycSequence(design,NEVER_LISTED);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,false,true,true,true]);
  assert.equal(r.appliedCount,5);
  assert.deepEqual(failedNames(r.steps[2]),['Recipient in allowlist','Recipient entry current']);
  // The issuer is not on the modeled allowlist at all, yet its self-transfer
  // passes: the reference module skips the recipient check for self-transfers.
  assert.equal(r.steps[3].allowed,true);
  assert.equal(r.balances.issuer,(999800n*U).toString(), 'a self-transfer moves the balance out and back');
  assert.equal(r.transferredBaseUnits,(350n*U).toString());
});

test('each modeled certificate state fails exactly the checks the single-shot lab names',()=>{
  const cases={
    untrusted:['Trusted KYC entity'],
    'bad-signature':['Certificate signature'],
    'wrong-sender':['Certificate names this sender'],
    expired:['Certificate still valid'],
    missing:['Trusted KYC entity','Certificate signature','Certificate names this sender','Certificate still valid'],
  };
  for(const [cert,fails] of Object.entries(cases)) {
    const r=simulateKycSequence(design,[
      {kind:'allowlist',account:'approved',listed:true},
      {kind:'transfer',from:'issuer',to:'approved',amount:'10',cert},
    ]);
    assert.equal(r.steps[1].allowed,false,cert);
    assert.deepEqual(failedNames(r.steps[1]),fails,cert);
  }
});

test('a blocked funding transfer leaves a knock-on balance failure downstream',()=>{
  const r=simulateKycSequence(design,[
    {kind:'allowlist',account:'approved',listed:true},
    {kind:'pause',paused:true},
    {kind:'transfer',from:'issuer',to:'approved',amount:'250',cert:'valid'},
    {kind:'pause',paused:false},
    {kind:'transfer',from:'approved',to:'pending',amount:'100',cert:'valid'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,false,true,false]);
  // The onward transfer fails on balance (the funding never arrived) as well
  // as on the recipient entry (pending was never listed).
  assert.deepEqual(failedNames(r.steps[4]),['Sender balance','Recipient in allowlist','Recipient entry current']);
  assert.equal(r.balances.approved,'0');
  assert.equal(r.transferredBaseUnits,'0');
});

test('allowlist and pause updates are idempotent state changes, recorded as applied',()=>{
  const r=simulateKycSequence(design,[
    {kind:'allowlist',account:'pending',listed:true},
    {kind:'allowlist',account:'pending',listed:true},
    {kind:'allowlist',account:'blocked',listed:false},
    {kind:'pause',paused:false},
    {kind:'pause',paused:true},
    {kind:'pause',paused:true},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,true,true,true,true]);
  assert.match(r.steps[1].checks[0].detail,/already on the modeled allowlist/);
  assert.match(r.steps[2].checks[0].detail,/was not on the modeled allowlist/);
  assert.match(r.steps[3].checks[0].detail,/already unpaused|were already/);
  assert.match(r.steps[5].checks[0].detail,/already paused/);
  assert.deepEqual(r.allowlist,{pending:{expired:false}});
  assert.equal(r.paused,true);
});

test('only the module checks are modeled: generic toggles do not gate this lab',()=>{
  // The design's generic layer is set against this transfer three ways: its
  // allowlist toggle is off but that layer is not this lab's list, its
  // per-transfer cap is 10 PRA, and its generic pause flag is set. The
  // KYC-extended module checks none of those — it checks the sender
  // certificate, ITS recipient allowlist, and ITS global pause, which
  // starts unset in this lab whatever the design's generic flag says.
  const hostile={...design,allowlist:false,limit:'10',paused:true};
  const r=simulateKycSequence(hostile,[
    {kind:'allowlist',account:'approved',listed:true},
    {kind:'transfer',from:'issuer',to:'approved',amount:'250',cert:'valid'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true]);
  assert.equal(r.balances.approved,(250n*U).toString());
});

test('modeled balances always sum to the designed supply',()=>{
  for(const steps of [ENTRY_EXPIRES,CERT_AND_PAUSE,NEVER_LISTED]) {
    const r=simulateKycSequence(design,steps);
    assert.equal(sumBalances(r),1000000n*U);
    for(const s of r.steps) assert.equal(Object.values(s.balancesAfter).reduce((a,v)=>a+BigInt(v),0n),1000000n*U);
  }
});

test('malformed steps are blocked steps, not throws; a malformed sequence throws',()=>{
  const r=simulateKycSequence(design,[
    {kind:'teleport',from:'issuer',to:'approved',amount:'1'},
    {kind:'transfer',from:'issuer',to:'nobody',amount:'1',cert:'valid'},
    {kind:'transfer',from:'issuer',to:'approved',amount:'-5',cert:'valid'},
    {kind:'transfer',from:'issuer',to:'approved',amount:'1',cert:'golden'},
    {kind:'allowlist',account:'nobody',listed:true},
    {kind:'pause',paused:'yes'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[false,false,false,false,false,false]);
  assert.equal(r.steps[0].checks[0].name,'Known step kind');
  assert.equal(r.steps[1].checks[0].name,'Known accounts');
  assert.equal(r.steps[2].checks[0].name,'Valid amount');
  assert.equal(r.steps[3].checks[0].name,'Known certificate state');
  assert.equal(r.steps[4].checks[0].name,'Known account and update');
  assert.equal(r.steps[5].checks[0].name,'Pause update');
  assert.throws(()=>simulateKycSequence(design,[]),/between 1 and 12/);
  assert.throws(()=>simulateKycSequence(design,Array(13).fill({kind:'pause',paused:true})),/between 1 and 12/);
  assert.equal(MAX_KYC_STEPS,12);
  assert.throws(()=>simulateKycSequence(design,[null]),/Lifecycle step 1/);
});

test('an invalid design reports invalid with no steps evaluated',()=>{
  const r=simulateKycSequence({...design,ticker:'bad ticker!'},ENTRY_EXPIRES);
  assert.equal(r.invalid,true);
  assert.deepEqual(r.steps,[]);
  assert.equal(r.appliedCount,0);
  assert.equal(sumBalances(r),1000000n*U);
});
