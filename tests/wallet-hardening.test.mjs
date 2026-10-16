import test from 'node:test';
import assert from 'node:assert/strict';
import {connectCardano,refreshCardano,connectMidnight,refreshMidnight} from '../src/services.js';
import {encodeAddress} from '../src/cardano.js';
import {NETWORKS} from '../src/config.js';

const testnetAddress=encodeAddress(Uint8Array.from([0,...Array(56).fill(10)]));
const mainnetAddress=encodeAddress(Uint8Array.from([1,...Array(56).fill(10)])); // header: type 0, network 1

function cardanoProvider({networkId=0,address=testnetAddress,api=null}={}) {
  return {name:'Hardening wallet',enable:async()=>api??{getNetworkId:async()=>networkId,getChangeAddress:async()=>address}};
}

test('Cardano connection names the expected network instead of a vague testnet hint',async()=>{
  await assert.rejects(connectCardano(cardanoProvider({networkId:0}),'mainnet'),/Switch your wallet to Mainnet/);
  await assert.rejects(connectCardano(cardanoProvider({networkId:1,address:mainnetAddress}),'preview'),/Switch your wallet to Preview testnet/);
  const w=await connectCardano(cardanoProvider({networkId:1,address:mainnetAddress}),'mainnet');
  assert.equal(w.networkId,1);assert.equal(w.address,mainnetAddress);
});

test('Cardano connection rejects malformed network ids and incomplete wallet APIs',async()=>{
  for(const bad of [2,-1,'0',null,undefined,NaN]) {
    const provider={name:'Bad id wallet',enable:async()=>({getNetworkId:async()=>bad,getChangeAddress:async()=>testnetAddress})};
    await assert.rejects(connectCardano(provider,'preview'),/unrecognised network/);
  }
  await assert.rejects(connectCardano(cardanoProvider({api:{getNetworkId:async()=>0}}),'preview'),/complete CIP-30 API/);
  await assert.rejects(connectCardano(cardanoProvider({api:{}}),'preview'),/complete CIP-30 API/);
  const wallet=await connectCardano(cardanoProvider(),'preview');
  wallet.api={getChangeAddress:async()=>testnetAddress}; // getNetworkId removed after connect
  await assert.rejects(refreshCardano(wallet,'preview'),/complete CIP-30 API/);
});

test('Cardano refresh still detects a same-network account change',async()=>{
  let current=testnetAddress;
  const provider={name:'Swap wallet',enable:async()=>({getNetworkId:async()=>0,getChangeAddress:async()=>current})};
  const wallet=await connectCardano(provider,'preview');
  await refreshCardano(wallet,'preview'); // unchanged: resolves
  current=encodeAddress(Uint8Array.from([0,...Array(56).fill(99)]));
  await assert.rejects(refreshCardano(wallet,'preview'),/account or network changed/);
});

// Valid Bech32m fixtures: each payload is a fixed 32-byte test value with a
// correctly computed Bech32m checksum for its HRP — the strict inspector in
// services.js verifies the checksum, so a hand-typed string cannot pass.
const MIDNIGHT_FIXTURES=Object.freeze({preview:'mn_addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps966y6d',preprod:'mn_addr_preprod1rlzxf8u3z20m8hyr5e7rx2gsjep34u0m49eaft8fw4lere6fncksc3uwrn',mainnet:'mn_addr_mainnet1zfrhu7mjhgkvzt0rcsv3p9xq2263qcxmhp8phycmh2uj6a4gjgyqhzaxx4'});
function midnightProvider({status={status:'connected',networkId:'preview'},address='mn_addr_preview19val6r9qnzadsam8ywclza7sgfa4d7n9phxxtdmvnhkytnx5j6ps966y6d'}={}) {
  const api={getConnectionStatus:async()=>status,getUnshieldedAddress:async()=>({unshieldedAddress:address})};
  return {provider:{name:'Midnight hardening',apiVersion:'4.2.0',connect:async()=>api},api};
}

test('Midnight refresh verifies status against the NETWORKS midnight id for every network',async()=>{
  for(const key of Object.keys(NETWORKS)) {
    const {provider,api}=midnightProvider({status:{status:'connected',networkId:NETWORKS[key].midnight},address:MIDNIGHT_FIXTURES[key]});
    const wallet=await connectMidnight(provider,key);
    assert.equal(wallet.networkId,NETWORKS[key].midnight);
    await refreshMidnight(wallet,key); // unchanged session resolves
    api.getConnectionStatus=async()=>({status:'connected',networkId:'elsewhere'});
    await assert.rejects(refreshMidnight(wallet,key),/not .*\. Switch networks/);
    api.getConnectionStatus=async()=>({status:'disconnected',networkId:NETWORKS[key].midnight});
    await assert.rejects(refreshMidnight(wallet,key),/not connected/);
  }
});

test('Midnight refresh detects an account change the old status-only check missed',async()=>{
  const {provider,api}=midnightProvider();
  const wallet=await connectMidnight(provider,'preview');
  api.getUnshieldedAddress=async()=>({unshieldedAddress:'mn_addr_preview1efyxlaf955mjl4ttv2an5yt0fgjgfhdrg99xvkcdv6qrp5syp8yscl8dmr'});
  await assert.rejects(refreshMidnight(wallet,'preview'),/Midnight account changed/);
});

test('Midnight connection rejects malformed public addresses and incomplete APIs',async()=>{
  for(const bad of ['not-an-address','mn_addr_short','',123,null]) {
    const {provider}=midnightProvider({address:bad});
    await assert.rejects(connectMidnight(provider,'preview'));
  }
  const incomplete={name:'Broken',apiVersion:'4.0.0',connect:async()=>({getConnectionStatus:async()=>({status:'connected',networkId:'preview'})})};
  await assert.rejects(connectMidnight(incomplete,'preview'),/complete Midnight API/);
});
