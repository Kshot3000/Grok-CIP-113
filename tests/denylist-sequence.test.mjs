import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,simulateDenylistSequence,MAX_DENYLIST_STEPS} from '../src/domain.js';

const design=fromTemplate('stable'); // freeze-and-seize, supply 1,000,000 PDC, 6 decimals
const failedNames=s=>s.checks.filter(c=>!c.pass).map(c=>c.name);
const sumBalances=r=>Object.values(r.balances).reduce((a,v)=>a+BigInt(v),0n);

const LIFECYCLE=[
  {kind:'transfer',from:'issuer',to:'approved',amount:'250'},
  {kind:'denylist',account:'approved',listed:true},
  {kind:'transfer',from:'approved',to:'issuer',amount:'100'},
  {kind:'transfer',from:'issuer',to:'approved',amount:'100'},
  {kind:'seize',actor:'authorised',holder:'approved',amount:'150'},
  {kind:'denylist',account:'approved',listed:false},
  {kind:'transfer',from:'approved',to:'issuer',amount:'100'},
];

test('a holder listed mid-lifecycle loses both transfer directions, then seizure applies',()=>{
  const r=simulateDenylistSequence(design,LIFECYCLE);
  assert.equal(r.invalid,false);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,false,false,true,true,true]);
  assert.equal(r.appliedCount,5);
  // The outbound transfer fails only on the sender check; the inbound only on the recipient check.
  assert.deepEqual(failedNames(r.steps[2]),['Sender not denylisted']);
  assert.deepEqual(failedNames(r.steps[3]),['Recipient not denylisted']);
  // Balances: funded 250, seized 150 back to the issuer, final 100 returned after removal.
  assert.equal(r.balances.approved,'0');
  assert.equal(r.balances.issuer,(1000000n*1000000n).toString());
  assert.equal(r.transferredBaseUnits,(350n*1000000n).toString());
  assert.equal(r.seizedBaseUnits,(150n*1000000n).toString());
  assert.deepEqual(r.denylisted,[]);
});

test('the denylist as it stands at each step is what later steps are checked against',()=>{
  const r=simulateDenylistSequence(design,LIFECYCLE);
  assert.deepEqual(r.steps[0].denylistedAfter,[]);
  assert.deepEqual(r.steps[1].denylistedAfter,['approved']);
  assert.deepEqual(r.steps[4].denylistedAfter,['approved']);
  assert.deepEqual(r.steps[5].denylistedAfter,[]);
  // The seizure step's own snapshot shows the seized balance already moved to the issuer.
  assert.equal(r.steps[4].balancesAfter.approved,(100n*1000000n).toString());
  assert.equal(r.steps[4].balancesAfter.issuer,(999900n*1000000n).toString());
});

test('seizure is impossible before listing and ends again on removal',()=>{
  const before=simulateDenylistSequence(design,[
    {kind:'transfer',from:'issuer',to:'approved',amount:'250'},
    {kind:'seize',actor:'authorised',holder:'approved',amount:'250'},
  ]);
  assert.equal(before.steps[1].allowed,false);
  assert.deepEqual(failedNames(before.steps[1]),['Holder is denylisted']);
  const afterRemoval=simulateDenylistSequence(design,[
    {kind:'transfer',from:'issuer',to:'approved',amount:'200'},
    {kind:'denylist',account:'approved',listed:true},
    {kind:'seize',actor:'authorised',holder:'approved',amount:'75'},
    {kind:'denylist',account:'approved',listed:false},
    {kind:'seize',actor:'authorised',holder:'approved',amount:'125'},
    {kind:'transfer',from:'approved',to:'issuer',amount:'125'},
  ]);
  assert.deepEqual(afterRemoval.steps.map(s=>s.allowed),[true,true,true,true,false,true]);
  assert.deepEqual(failedNames(afterRemoval.steps[4]),['Holder is denylisted']);
  assert.equal(afterRemoval.balances.approved,'0');
});

test('seizure checks fail independently: authority and holder balance',()=>{
  const stranger=simulateDenylistSequence(design,[
    {kind:'transfer',from:'issuer',to:'approved',amount:'100'},
    {kind:'denylist',account:'approved',listed:true},
    {kind:'seize',actor:'other',holder:'approved',amount:'100'},
  ]);
  assert.equal(stranger.steps[2].allowed,false);
  assert.deepEqual(failedNames(stranger.steps[2]),['Authorised issuer action']);
  const tooMuch=simulateDenylistSequence(design,[
    {kind:'transfer',from:'issuer',to:'approved',amount:'100'},
    {kind:'denylist',account:'approved',listed:true},
    {kind:'seize',actor:'authorised',holder:'approved',amount:'101'},
  ]);
  assert.equal(tooMuch.steps[2].allowed,false);
  assert.deepEqual(failedNames(tooMuch.steps[2]),['Holder balance']);
  assert.equal(tooMuch.balances.approved,(100n*1000000n).toString());
});

test('a blocked transfer leaves balances unchanged and later steps see the knock-on',()=>{
  const r=simulateDenylistSequence(design,[
    {kind:'denylist',account:'approved',listed:true},
    {kind:'transfer',from:'issuer',to:'approved',amount:'250'},
    {kind:'transfer',from:'approved',to:'issuer',amount:'100'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,false,false]);
  // Step 3 is blocked on balance (the funding never arrived) as well as on the sender listing.
  assert.deepEqual(failedNames(r.steps[2]),['Sender balance','Sender not denylisted']);
  assert.equal(r.balances.approved,'0');
  assert.equal(r.transferredBaseUnits,'0');
});

test('denylist updates are idempotent state changes, recorded as applied',()=>{
  const r=simulateDenylistSequence(design,[
    {kind:'denylist',account:'pending',listed:true},
    {kind:'denylist',account:'pending',listed:true},
    {kind:'denylist',account:'blocked',listed:false},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true,true]);
  assert.match(r.steps[1].checks[0].detail,/already on the modeled denylist/);
  assert.match(r.steps[2].checks[0].detail,/already off the modeled denylist/);
  assert.deepEqual(r.denylisted,['pending']);
});

test('only the module checks are modeled: generic toggles do not gate this lab',()=>{
  // The stable design's generic layer would refuse this transfer three ways:
  // the allowlist excludes the pending participant, the design is paused,
  // and the generic model freezes the blocked participant. The freeze-and-
  // seize module checks none of those — it checks the denylist only.
  const paused={...design,paused:true};
  const r=simulateDenylistSequence(paused,[
    {kind:'transfer',from:'issuer',to:'pending',amount:'100'},
    {kind:'transfer',from:'issuer',to:'blocked',amount:'100'},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[true,true]);
  assert.equal(r.balances.pending,(100n*1000000n).toString());
});

test('modeled balances always sum to the designed supply',()=>{
  for(const steps of [LIFECYCLE,[{kind:'transfer',from:'issuer',to:'approved',amount:'250'},{kind:'denylist',account:'approved',listed:true},{kind:'seize',actor:'authorised',holder:'approved',amount:'250'}]]) {
    const r=simulateDenylistSequence(design,steps);
    assert.equal(sumBalances(r),1000000n*1000000n);
    for(const s of r.steps) assert.equal(Object.values(s.balancesAfter).reduce((a,v)=>a+BigInt(v),0n),1000000n*1000000n);
  }
});

test('malformed steps are blocked steps, not throws; a malformed sequence throws',()=>{
  const r=simulateDenylistSequence(design,[
    {kind:'teleport',from:'issuer',to:'approved',amount:'1'},
    {kind:'transfer',from:'issuer',to:'nobody',amount:'1'},
    {kind:'transfer',from:'issuer',to:'approved',amount:'-5'},
    {kind:'seize',actor:'authorised',holder:'nobody',amount:'1'},
    {kind:'denylist',account:'nobody',listed:true},
  ]);
  assert.deepEqual(r.steps.map(s=>s.allowed),[false,false,false,false,false]);
  assert.equal(r.steps[0].checks[0].name,'Known step kind');
  assert.equal(r.steps[1].checks[0].name,'Known accounts');
  assert.equal(r.steps[2].checks[0].name,'Valid amount');
  assert.throws(()=>simulateDenylistSequence(design,[]),/between 1 and 12/);
  assert.throws(()=>simulateDenylistSequence(design,Array(13).fill({kind:'denylist',account:'approved',listed:true})),/between 1 and 12/);
  assert.equal(MAX_DENYLIST_STEPS,12);
  assert.throws(()=>simulateDenylistSequence(design,[null]),/Lifecycle step 1/);
});

test('an invalid design reports invalid with no steps evaluated',()=>{
  const r=simulateDenylistSequence({...design,ticker:'bad ticker!'},LIFECYCLE);
  assert.equal(r.invalid,true);
  assert.deepEqual(r.steps,[]);
  assert.equal(r.appliedCount,0);
  // As in the other sequence labs, the ledger still initialises from the
  // (parseable) designed supply; no step is evaluated against it.
  assert.equal(sumBalances(r),1000000n*1000000n);
});
