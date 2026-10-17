import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMidnightAddress, buildMidnightAddress, verifyMidnightAddress } from '../src/services.js';

// Build/verify fixtures: the payloads are the exact 32 bytes the pinned
// Bech32m addresses in midnight-address.test.mjs decode to (computed
// mechanically against inspectMidnightAddress before being pinned here),
// so building from a payload must reproduce its address byte for byte.
const PREVIEW='mn_addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps966y6d';
const PREVIEW_PAYLOAD='2b3bfd0ca098bad8776723b1f177d0427b56fa650dcc65b76c9dec45ccd49683';
const PREPROD='mn_addr_preprod1rlzxf8u3z20m8hyr5e7rx2gsjep34u0m49eaft8fw4lere6fncksc3uwrn';
const PREPROD_PAYLOAD='1fc4649f91129fb3dc83a67c33291096431af1fba973d4ace9757f91e7499e2d';
const MAINNET='mn_addr_mainnet1zfrhu7mjhgkvzt0rcsv3p9xq2263qcxmhp8phycmh2uj6a4gjgyqhzaxx4';
const MAINNET_PAYLOAD='12477e7b72ba2cc12de3c4191094c052b51060dbb84e1b931bbab92d76a89208';
const UNDEPLOYED='mn_addr_undeployed1ngm76ke88qek9kvfdkrld7js5p0t9r70kdks0ycqnr77q2kg0w9smh83jd';
const UNDEPLOYED_PAYLOAD='9a37ed5b27383362d9896d87f6fa50a05eb28fcfb36d07930098fde02ac87b8b';
const NO_SEGMENT='mn_addr19jxnzqe6q24gfy075aj5aeles6p8j7u3eatc6565ytlnj539scuqctyym4';
const NO_SEGMENT_PAYLOAD='2c8d31033a02aa8491fea7654ee7f98682797b91cf578d535422ff3952258638';
const DOC_EXAMPLE='mn_addr1asujt0dayj4pelgq97wv75hjhscqv9epmzzpapkf8sy8c87jhh9s6e0fs3';
const DOC_PAYLOAD='ec3925bdbd24aa1cfd002f9ccf52f2bc30061721d8841e86c93c087c1fd2bdcb';
const PREVIEW_2='mn_addr_preview1efyxlaf955mjl4ttv2an5yt0fgjgfhdrg99xvkcdv6qrp5syp8yscl8dmr';
// The preview payload rebuilt under another segment / no segment (computed
// mechanically against buildMidnightAddress before being pinned here).
const PREVIEW_PAYLOAD_AS_PREPROD='mn_addr_preprod19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps9my5fs';
const PREVIEW_PAYLOAD_NO_SEGMENT='mn_addr19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps70sx28';
const SHIELDED='mn_shield-addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps9s8s5g';

test('inspecting an address now also states its payload hex, byte for byte',()=>{
  const info=inspectMidnightAddress(PREVIEW);
  assert.equal(info.payloadHex,PREVIEW_PAYLOAD);
  assert.equal(info.payloadBytes,32);
});

test('building from each pinned payload reproduces its address exactly, on every segment and none',()=>{
  for(const [payload,network,address] of [
    [PREVIEW_PAYLOAD,'preview',PREVIEW],[PREPROD_PAYLOAD,'preprod',PREPROD],
    [MAINNET_PAYLOAD,'mainnet',MAINNET],[UNDEPLOYED_PAYLOAD,'undeployed',UNDEPLOYED],
    [NO_SEGMENT_PAYLOAD,null,NO_SEGMENT],[DOC_PAYLOAD,null,DOC_EXAMPLE],
  ]){
    const built=buildMidnightAddress(payload,network);
    assert.equal(built.address,address);
    assert.equal(built.network,network);
    assert.equal(built.payloadHex,payload);
    assert.equal(built.checksum,'bech32m');
  }
});

test('every built address inspects back to exactly its inputs',()=>{
  for(const network of ['preview','preprod','mainnet','undeployed',null]){
    const built=buildMidnightAddress(PREVIEW_PAYLOAD,network);
    const info=inspectMidnightAddress(built.address);
    assert.equal(info.payloadHex,PREVIEW_PAYLOAD);
    assert.equal(info.network,network);
    assert.equal(info.address,built.address);
  }
});

test('building accepts an uppercase payload and a blank network as no segment',()=>{
  assert.equal(buildMidnightAddress(PREVIEW_PAYLOAD.toUpperCase(),'preview').address,PREVIEW);
  assert.equal(buildMidnightAddress(NO_SEGMENT_PAYLOAD,'').address,NO_SEGMENT);
  assert.equal(buildMidnightAddress(NO_SEGMENT_PAYLOAD).address,NO_SEGMENT);
});

test('the same payload under another segment builds that segment\u2019s address, sharing the data part',()=>{
  assert.equal(buildMidnightAddress(PREVIEW_PAYLOAD,'preprod').address,PREVIEW_PAYLOAD_AS_PREPROD);
  assert.equal(buildMidnightAddress(PREVIEW_PAYLOAD,null).address,PREVIEW_PAYLOAD_NO_SEGMENT);
});

test('a payload that is not exactly 32 bytes is refused with its byte count',()=>{
  assert.throws(()=>buildMidnightAddress('ab'.repeat(31),'preview'),/31 bytes/);
  assert.throws(()=>buildMidnightAddress('ab'.repeat(33),'preview'),/33 bytes/);
  assert.throws(()=>buildMidnightAddress('','preview'),/0 bytes/);
});

test('a non-hex or odd-length payload is refused as hex, never padded',()=>{
  assert.throws(()=>buildMidnightAddress('zz'+PREVIEW_PAYLOAD.slice(2),'preview'),/must be hex/);
  assert.throws(()=>buildMidnightAddress(PREVIEW_PAYLOAD.slice(0,63),'preview'),/must be hex/);
});

test('an unknown network segment is refused by name',()=>{
  assert.throws(()=>buildMidnightAddress(PREVIEW_PAYLOAD,'testnet'),/Unknown Midnight network segment "testnet"/);
});

test('verify: an address built from the claimed payload and network matches on both positions',()=>{
  const r=verifyMidnightAddress(PREVIEW,PREVIEW_PAYLOAD,'preview');
  assert.equal(r.match,true);
  assert.equal(r.payloadMatch,true);
  assert.equal(r.networkMatch,true);
  assert.equal(r.builtAddress,PREVIEW);
});

test('verify: a different payload on the same network fails the payload verdict alone',()=>{
  const r=verifyMidnightAddress(PREVIEW_2,PREVIEW_PAYLOAD,'preview');
  assert.equal(r.match,false);
  assert.equal(r.payloadMatch,false);
  assert.equal(r.networkMatch,true);
  assert.equal(r.builtAddress,PREVIEW);
});

test('verify: the same payload claimed on another network fails the network verdict alone',()=>{
  const r=verifyMidnightAddress(PREVIEW,PREVIEW_PAYLOAD,'preprod');
  assert.equal(r.match,false);
  assert.equal(r.payloadMatch,true);
  assert.equal(r.networkMatch,false);
  assert.equal(r.builtAddress,PREVIEW_PAYLOAD_AS_PREPROD);
});

test('verify: a network claimed for a segment-less address fails the network verdict alone',()=>{
  const r=verifyMidnightAddress(NO_SEGMENT,NO_SEGMENT_PAYLOAD,'preview');
  assert.equal(r.match,false);
  assert.equal(r.payloadMatch,true);
  assert.equal(r.networkMatch,false);
  assert.equal(r.network,null);
  assert.equal(r.claimedNetwork,'preview');
});

test('verify: a segment-less claim matches a segment-less address and no other',()=>{
  const ok=verifyMidnightAddress(NO_SEGMENT,NO_SEGMENT_PAYLOAD,null);
  assert.equal(ok.match,true);
  const r=verifyMidnightAddress(PREVIEW,PREVIEW_PAYLOAD,null);
  assert.equal(r.match,false);
  assert.equal(r.networkMatch,false);
  assert.equal(r.builtAddress,PREVIEW_PAYLOAD_NO_SEGMENT);
});

test('verify: an uppercase candidate verifies and normalises to lowercase',()=>{
  const r=verifyMidnightAddress(PREVIEW.toUpperCase(),PREVIEW_PAYLOAD,'preview');
  assert.equal(r.match,true);
  assert.equal(r.address,PREVIEW);
});

test('verify: an undecodable candidate or an unbuildable claim is refused, not scored as a mismatch',()=>{
  assert.throws(()=>verifyMidnightAddress(SHIELDED,PREVIEW_PAYLOAD,'preview'),/unshielded/);
  assert.throws(()=>verifyMidnightAddress(PREVIEW.slice(0,-1)+'q',PREVIEW_PAYLOAD,'preview'),/Bech32m checksum/);
  assert.throws(()=>verifyMidnightAddress(PREVIEW,'ab'.repeat(31),'preview'),/31 bytes/);
  assert.throws(()=>verifyMidnightAddress(PREVIEW,PREVIEW_PAYLOAD,'testnet'),/Unknown Midnight network segment/);
});
