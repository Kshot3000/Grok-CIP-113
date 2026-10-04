import { CONFIG, NETWORKS, PREVIEW_REFERENCE } from './config.js';
import { normalizeWalletAddress, decodeAddress } from './cardano.js';

export async function fetchJson(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000),credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error(`Source returned HTTP ${response.status}. Try again shortly.`);
  return response.json();
}
export async function getChainTip(network) {
  const rows=await fetchJson(`${NETWORKS[network].koios}/tip`),v=rows?.[0];
  if(!v||!Number.isSafeInteger(Number(v.block_no))||!Number.isFinite(Number(v.block_time))||!Number.isFinite(Number(v.epoch_no))||!Number.isFinite(Number(v.abs_slot)))throw new Error('The network returned an unexpected response.');
  return {block:Number(v.block_no),epoch:Number(v.epoch_no),slot:Number(v.abs_slot),time:Number(v.block_time)*1000,hash:v.hash,fetchedAt:Date.now()};
}
export async function getReference() {
  const rows=await fetchJson(PREVIEW_REFERENCE.raw);
  if(!Array.isArray(rows))throw new Error('Unexpected deployment reference.');
  const r=rows.find(v=>v.txHash===PREVIEW_REFERENCE.txHash);
  if(r?.schemaVersion!==3||!(/^[a-f0-9]{56}$/).test(r?.programmableLogicBase?.scriptHash))throw new Error('The pinned reference changed or is unavailable. Review the upstream deployment before continuing.');
  return {...PREVIEW_REFERENCE,scriptHash:r.programmableLogicBase.scriptHash,protocolPolicy:r.protocolParams.policyId,fetchedAt:Date.now()};
}
export async function queryAsset(network,policy,nameHex) {
  if(!/^[a-f0-9]{56}$/i.test(policy))throw new Error('Policy ID must be 56 hexadecimal characters.');
  if(!/^(?:[a-f0-9]{2}){0,32}$/i.test(nameHex))throw new Error('Asset name must contain 0–32 bytes of even-length hexadecimal.');
  const data=await fetchJson(`${NETWORKS[network].koios}/asset_info`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_asset_list:[[policy.toLowerCase(),nameHex.toLowerCase()]]})});
  if(!Array.isArray(data))throw new Error('Unexpected asset response.');
  return data[0]??null;
}
export async function getRegistry() {
  if(!CONFIG.registryApi)throw new Error('No registry indexer is configured. Connect a Foundation-compatible backend in src/config.js.');
  const origin=new URL(CONFIG.registryApi);
  if(origin.protocol!=='https:')throw new Error('The registry API must use HTTPS.');
  const result=await fetchJson(`${origin.href.replace(/\/$/,'')}/api/v1/registry/protocols`);
  if(!Array.isArray(result))throw new Error('Unexpected registry response.');
  return result.map(v=>{if(!Number.isInteger(v.protocolParamsId)||!Number.isInteger(v.tokenCount)||!(/^[a-f0-9]{56}$/).test(v.registryNodePolicyId))throw new Error('Invalid registry deployment record.');return v;});
}
export function cardanoWallets(root=globalThis) {
  return Object.entries(root.cardano??{}).filter(([,w])=>w&&typeof w.enable==='function'&&typeof w.name==='string').map(([id,w])=>({id,name:w.name,provider:w}));
}
export function midnightWallets(root=globalThis) {
  return Object.entries(root.midnight??{}).filter(([,w])=>w&&typeof w.connect==='function'&&/^4\./.test(w.apiVersion??'')).map(([id,w])=>({id,name:w.name??id,provider:w}));
}
export async function connectCardano(provider,network) {
  const api=await provider.enable(),id=await api.getNetworkId();
  if(id!==NETWORKS[network].id)throw new Error(`Switch your wallet to ${network==='mainnet'?'Mainnet':'a test network'} and reconnect.`);
  const address=normalizeWalletAddress(await api.getChangeAddress());
  if(decodeAddress(address).network!==id)throw new Error('Wallet address and reported network do not match.');
  return {name:provider.name,api,networkId:id,address,connectedAt:Date.now()};
}
export async function refreshCardano(wallet,network) {
  const id=await wallet.api.getNetworkId(),address=normalizeWalletAddress(await wallet.api.getChangeAddress());
  if(id!==NETWORKS[network].id||decodeAddress(address).network!==id||address!==wallet.address)throw new Error('Wallet account or network changed. Reconnect to continue.');
  return wallet;
}
export async function connectMidnight(provider,network) {
  if(!/^4\./.test(provider.apiVersion??''))throw new Error('Use a Midnight wallet with connector API v4.');
  const api=await provider.connect(NETWORKS[network].midnight),status=await api.getConnectionStatus();
  if(status?.networkId!==NETWORKS[network].midnight||status?.status!=='connected')throw new Error('Midnight wallet is not connected to the selected network.');
  // Never fetch balances or secret material. Read only the public unshielded address.
  const result=await api.getUnshieldedAddress();
  const address=typeof result==='string'?result:result?.unshieldedAddress;
  if(typeof address!=='string'||!address.startsWith('mn_addr'))throw new Error('The wallet did not provide a valid public address.');
  return {name:provider.name,api,address,network,version:provider.apiVersion};
}
