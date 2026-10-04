import test from 'node:test';
import assert from 'node:assert/strict';
import {cardanoWallets,midnightWallets,connectCardano,connectMidnight,refreshCardano,getChainTip} from '../src/services.js';
import {encodeAddress} from '../src/cardano.js';

const address=encodeAddress(Uint8Array.from([0,...Array(56).fill(10)]));
test('wallet discovery ignores non-wallet properties and unsupported Midnight APIs',()=>{
  assert.equal(cardanoWallets({cardano:{nami:{name:'Nami',enable(){}},other:{}}}).length,1);
  assert.equal(midnightWallets({midnight:{old:{apiVersion:'3.0',connect(){}},new:{apiVersion:'4.0.1',name:'Lace',connect(){}}}}).length,1);
});
test('Cardano connection rejects wrong network and detects changed accounts',async()=>{
  let networkId=0,current=address;
  const provider={name:'Test wallet',enable:async()=>({getNetworkId:async()=>networkId,getChangeAddress:async()=>current})};
  const wallet=await connectCardano(provider,'preview');assert.equal(wallet.address,address);
  await assert.rejects(connectCardano(provider,'mainnet'),/Switch your wallet/);
  current=encodeAddress(Uint8Array.from([0,...Array(56).fill(11)]));await assert.rejects(refreshCardano(wallet,'preview'),/changed/);
  networkId=1;await assert.rejects(refreshCardano(wallet,'preview'));
});
test('Midnight connection checks v4 status and reads only public address',async()=>{
  let requested;let status={status:'connected',networkId:'preview'};
  const provider={name:'Midnight test',apiVersion:'4.0.1',connect:async(n)=>{requested=n;return{getConnectionStatus:async()=>status,getUnshieldedAddress:async()=>({unshieldedAddress:'mn_addr_preview1test'})};}};
  const wallet=await connectMidnight(provider,'preview');assert.equal(requested,'preview');assert.equal(wallet.address,'mn_addr_preview1test');
  status={status:'connected',networkId:'mainnet'};await assert.rejects(connectMidnight(provider,'preview'),/not Preview/);
  status={status:'disconnected'};await assert.rejects(connectMidnight(provider,'preview'));
});
test('unavailable or malformed live data is rejected instead of replaced with fixtures',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>({ok:true,json:async()=>[]});await assert.rejects(getChainTip('preview'));
    globalThis.fetch=async()=>({ok:false,status:503});await assert.rejects(getChainTip('preview'),/503/);
  }finally{globalThis.fetch=original;}
});
