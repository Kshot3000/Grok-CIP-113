import test from 'node:test';
import assert from 'node:assert/strict';
import {fromTemplate,toUnits,simulateTransfer,makeManifest,parseManifest,validateDesign,creditScenario,checkEligibility} from '../src/domain.js';
import {CONFIG} from '../src/config.js';
import {encodeAddress,decodeAddress,deriveSmartWallet,normalizeWalletAddress} from '../src/cardano.js';

test('exact asset units retain precision and reject unsafe inputs',()=>{
  assert.equal(toUnits('123456789.123456',6),123456789123456n);
  assert.equal(toUnits('0.000001',6),1n);
  for(const bad of ['1e4','-1','1,000','Infinity','NaN','0x20','1.1234567','9223372036854.775808'])assert.throws(()=>toUnits(bad,6));
});
test('transfer model enforces all configured denial paths',()=>{
  const d=fromTemplate();
  assert.equal(simulateTransfer(d,{recipient:'approved',amount:'10000'}).allowed,true);
  assert.equal(simulateTransfer(d,{recipient:'approved',amount:'10000.000001'}).allowed,false);
  assert.equal(simulateTransfer(d,{recipient:'pending',amount:'1'}).allowed,false);
  assert.equal(simulateTransfer(d,{recipient:'blocked',amount:'1'}).allowed,false);
  assert.equal(simulateTransfer({...d,paused:true},{recipient:'approved',amount:'1'}).allowed,false);
  assert.equal(simulateTransfer(d,{recipient:'approved',amount:'0'}).invalid,true);
  assert.equal(simulateTransfer(d,{recipient:'unknown',amount:'1'}).invalid,true);
  assert.equal(simulateTransfer({...d,limitEnabled:false,allowlist:false,identity:false,pausable:false},{recipient:'pending',amount:'25000'}).allowed,true);
});
test('asset name limits count UTF-8 bytes, not characters',()=>{
  assert.ok(validateDesign({...fromTemplate(),tokenName:'🎉'.repeat(9)}).length);
  assert.equal(validateDesign({...fromTemplate(),tokenName:'🎉'.repeat(8)}).length,0);
});
test('manifest round-trips, strips unknown fields, and rejects untrusted shapes',()=>{
  const d=fromTemplate('credit'),manifest=makeManifest(d,'preview');
  assert.equal(manifest.token.initialSupplyBaseUnits,'500000000000');
  assert.equal(manifest.implementation.midnight.proofVerified,false);
  manifest.design.registryApi='https://malicious.example';
  assert.deepEqual(parseManifest(JSON.stringify(manifest)),{design:d,network:'preview'});
  for(const v of ['{}','null','[1,2]',JSON.stringify({...manifest,network:'fake'}),JSON.stringify({...manifest,design:{...d,allowlist:'yes'}})])assert.throws(()=>parseManifest(v));
});
test('credit model correctly identifies collateral shortfalls',()=>{
  const r=creditScenario({principal:50000,rate:8,months:12,collateral:80000,advance:70});
  assert.equal(r.interest,4000);assert.equal(r.total,54000);assert.equal(Math.round(r.ceiling),56000);assert.equal(r.withinLimit,true);
  assert.equal(creditScenario({principal:60000,rate:0,months:6,collateral:80000,advance:70}).withinLimit,false);
  assert.throws(()=>creditScenario({principal:NaN,rate:8,months:12,collateral:100,advance:70}));
});
test('local eligibility fails each threshold independently',()=>{
  const v={score:78,minimum:65,age:28,adult:true,region:true,approved:true};
  assert.equal(checkEligibility(v).eligible,true);
  assert.equal(checkEligibility({...v,score:60}).eligible,false);
  assert.equal(checkEligibility({...v,age:17}).eligible,false);
  assert.equal(checkEligibility({...v,approved:false}).eligible,false);
});
test('user-supplied donation address has a valid mainnet checksum',()=>{
  const d=decodeAddress(CONFIG.donation);assert.equal(d.network,1);assert.equal(d.bytes.length,57);assert.equal(encodeAddress(d.bytes),CONFIG.donation);
});
test('CIP-19 published enterprise address vector decodes and round-trips',()=>{
  const address='addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8';
  const d=decodeAddress(address);assert.equal(d.type,6);assert.equal(d.network,1);assert.equal(encodeAddress(d.bytes),address);
  assert.equal(normalizeWalletAddress(Buffer.from(d.bytes).toString('hex')),address);
  assert.throws(()=>decodeAddress(address.slice(0,-1)+'q'));
  assert.throws(()=>decodeAddress(address.slice(0,9).toUpperCase()+address.slice(9)));
});
test('CIP-113 derivation preserves original payment ownership and network',()=>{
  const bytes=Uint8Array.from([0,...Array(28).fill(17),...Array(28).fill(34)]),owner=encodeAddress(bytes),base='ab'.repeat(28);
  const result=decodeAddress(deriveSmartWallet(owner,base,0));
  assert.equal(result.type,1);assert.equal(result.network,0);
  assert.equal(Buffer.from(result.payment).toString('hex'),base);
  assert.equal(Buffer.from(result.bytes.slice(29)).toString('hex'),'11'.repeat(28));
  assert.notEqual(Buffer.from(result.bytes.slice(29)).toString('hex'),'22'.repeat(28));
  assert.throws(()=>deriveSmartWallet(owner,base,1));assert.throws(()=>deriveSmartWallet(owner,'a'.repeat(55),0));
});
test('script-owned smart wallets use script stake credentials',()=>{
  const owner=encodeAddress(Uint8Array.from([0x70,...Array(28).fill(42)]));
  const result=decodeAddress(deriveSmartWallet(owner,'ab'.repeat(28),0));assert.equal(result.type,3);
});
