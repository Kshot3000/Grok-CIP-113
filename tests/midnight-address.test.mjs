import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMidnightAddress,connectMidnight,refreshMidnight} from '../src/services.js';

// Valid Bech32m fixtures: every payload is a fixed 32-byte test value with a
// correctly computed Bech32m checksum for its HRP (verified against the
// BIP-350 polymod constant 0x2bc830a3 before being pinned here). The strict
// inspector verifies the checksum, so no hand-typed string can pass.
const PREVIEW='mn_addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps966y6d';
const PREVIEW_2='mn_addr_preview1efyxlaf955mjl4ttv2an5yt0fgjgfhdrg99xvkcdv6qrp5syp8yscl8dmr';
const PREPROD='mn_addr_preprod1rlzxf8u3z20m8hyr5e7rx2gsjep34u0m49eaft8fw4lere6fncksc3uwrn';
const MAINNET='mn_addr_mainnet1zfrhu7mjhgkvzt0rcsv3p9xq2263qcxmhp8phycmh2uj6a4gjgyqhzaxx4';
const UNDEPLOYED='mn_addr_undeployed1ngm76ke88qek9kvfdkrld7js5p0t9r70kdks0ycqnr77q2kg0w9smh83jd';
const NO_SEGMENT='mn_addr19jxnzqe6q24gfy075aj5aeles6p8j7u3eatc6565ytlnj539scuqctyym4';
// A real-format example published in Midnight.js material: HRP carries no
// network segment, payload is 32 bytes, checksum is Bech32m (not Bech32).
const DOC_EXAMPLE='mn_addr1asujt0dayj4pelgq97wv75hjhscqv9epmzzpapkf8sy8c87jhh9s6e0fs3';
const SHIELDED='mn_shield-addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps9s8s5g';
const DUST='mn_dust_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6psx68zcn';
const SHORT_PAYLOAD='mn_addr_preview19val6r9qnzadsam8ywclza7sggsednpk';
const LONG_PAYLOAD='mn_addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6pjkwlapjsf3wkcwanj8v03wlgyyk62a4y';

test('a valid segmented address verifies and states the network its HRP encodes',()=>{
  for(const [address,network] of [[PREVIEW,'preview'],[PREPROD,'preprod'],[MAINNET,'mainnet'],[UNDEPLOYED,'undeployed']]){
    const info=inspectMidnightAddress(address);
    assert.equal(info.address,address);
    assert.equal(info.network,network);
    assert.equal(info.payloadBytes,32);
    assert.equal(info.checksum,'bech32m');
  }
});

test('an address whose HRP carries no segment verifies with network null, never a guessed one',()=>{
  for(const address of [NO_SEGMENT,DOC_EXAMPLE]){
    const info=inspectMidnightAddress(address);
    assert.equal(info.network,null);
    assert.equal(info.hrp,'mn_addr');
    assert.equal(info.payloadBytes,32);
  }
});

test('a single altered character fails the Bech32m checksum',()=>{
  const mutated=PREVIEW.slice(0,-1)+'q';
  assert.notEqual(mutated,PREVIEW);
  assert.throws(()=>inspectMidnightAddress(mutated),/Bech32m checksum/);
});

test('a character outside the Bech32 charset is refused before the checksum is judged',()=>{
  const bad=PREVIEW.replace('9val','9vai'); // 'i' is not in the Bech32 charset
  assert.throws(()=>inspectMidnightAddress(bad),/valid public address/);
});

test('mixed case is refused; the all-uppercase form verifies and normalises to lowercase',()=>{
  assert.throws(()=>inspectMidnightAddress('Mn'+PREVIEW.slice(2)),/mixed-case/);
  const info=inspectMidnightAddress(PREVIEW.toUpperCase());
  assert.equal(info.address,PREVIEW);
  assert.equal(info.network,'preview');
});

test('shielded and dust addresses are refused: this reader takes unshielded addresses only',()=>{
  assert.throws(()=>inspectMidnightAddress(SHIELDED),/unshielded/);
  assert.throws(()=>inspectMidnightAddress(DUST),/unshielded/);
});

test('a valid checksum on the wrong payload length is refused: unshielded payloads are 32 bytes',()=>{
  assert.throws(()=>inspectMidnightAddress(SHORT_PAYLOAD),/32-byte/);
  assert.throws(()=>inspectMidnightAddress(LONG_PAYLOAD),/32-byte/);
});

test('non-strings, empties and unknown network segments are refused',()=>{
  for(const bad of ['',123,null,undefined,'mn_addr_testnet19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps966y6d']) {
    assert.throws(()=>inspectMidnightAddress(bad));
  }
});

function providerFor(address,{status={status:'connected',networkId:'preview'},stringForm=false}={}) {
  const api={getConnectionStatus:async()=>status,getUnshieldedAddress:async()=>stringForm?address:{unshieldedAddress:address}};
  return {provider:{name:'Midnight address test',apiVersion:'4.0.1',connect:async()=>api},api};
}

test('connect refuses an address whose encoded network contradicts the connected network',async()=>{
  const {provider}=providerFor(PREPROD);
  await assert.rejects(connectMidnight(provider,'preview'),/address is for preprod, not Preview/);
});

test('connect accepts a segment-less address and reports addressNetwork null',async()=>{
  const {provider}=providerFor(NO_SEGMENT);
  const wallet=await connectMidnight(provider,'preview');
  assert.equal(wallet.address,NO_SEGMENT);
  assert.equal(wallet.addressNetwork,null);
});

test('connect records the encoded network and accepts the plain-string address form',async()=>{
  const {provider}=providerFor(PREVIEW,{stringForm:true});
  const wallet=await connectMidnight(provider,'preview');
  assert.equal(wallet.address,PREVIEW);
  assert.equal(wallet.addressNetwork,'preview');
});

test('connect refuses a bad-checksum address with the checksum named',async()=>{
  const {provider}=providerFor(PREVIEW.slice(0,-1)+'q');
  await assert.rejects(connectMidnight(provider,'preview'),/Bech32m checksum/);
});

test('refresh still detects an account change between two valid addresses',async()=>{
  const {provider,api}=providerFor(PREVIEW);
  const wallet=await connectMidnight(provider,'preview');
  api.getUnshieldedAddress=async()=>({unshieldedAddress:PREVIEW_2});
  await assert.rejects(refreshMidnight(wallet,'preview'),/Midnight account changed/);
});
