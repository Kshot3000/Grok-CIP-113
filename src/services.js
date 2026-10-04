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
// Pure parser for a Koios tx_info response about the pinned Preview
// deployment transaction. Anything other than exactly one row naming the
// pinned hash, in a block, with valid contract execution is rejected — a
// deployment is only ever shown as verified from a response that proves it.
export function parseDeploymentTx(rows, expectedHash) {
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('Koios did not return exactly one record for the deployment transaction.');
  const v=rows[0];
  if(v?.tx_hash!==expectedHash)throw new Error('Koios returned a different transaction than the pinned deployment.');
  if(!Number.isSafeInteger(v.block_height)||v.block_height<=0)throw new Error('The deployment transaction is not confirmed in a block yet.');
  if(!Number.isSafeInteger(v.epoch_no)||v.epoch_no<0)throw new Error('The deployment record has no valid epoch.');
  if(!Number.isFinite(Number(v.tx_timestamp))||Number(v.tx_timestamp)<=0)throw new Error('The deployment record has no valid confirmation time.');
  if(v.valid_contract!==true)throw new Error('Koios does not report valid contract execution for the deployment transaction.');
  return {txHash:v.tx_hash,blockHeight:v.block_height,epoch:v.epoch_no,timestamp:Number(v.tx_timestamp)*1000,validContract:true};
}

// Live verification of the Foundation's pinned Preview reference deployment:
// the platform repository's configuration (fetched fresh) must still match
// the values pinned in src/config.js field by field, AND Koios Preview must
// confirm that exact deployment transaction on chain. Either check failing
// means nothing is reported as verified.
export async function getPreviewDeployment() {
  const reference=await getReference();
  if(reference.scriptHash!==PREVIEW_REFERENCE.scriptHash||reference.protocolPolicy!==PREVIEW_REFERENCE.protocolPolicy)throw new Error('The upstream reference configuration no longer matches the pinned deployment. Review it upstream before trusting this check.');
  const rows=await fetchJson(`${NETWORKS.preview.koios}/tx_info`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_tx_hashes:[PREVIEW_REFERENCE.txHash]})});
  const deployment=parseDeploymentTx(rows,PREVIEW_REFERENCE.txHash);
  return {...deployment,scriptHash:reference.scriptHash,protocolPolicy:reference.protocolPolicy,source:PREVIEW_REFERENCE.source,observed:PREVIEW_REFERENCE.observed,fetchedAt:Date.now()};
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
function assertCardanoApi(api) {
  if(!api||typeof api.getNetworkId!=='function'||typeof api.getChangeAddress!=='function')throw new Error('The wallet did not provide a complete CIP-30 API. Update the wallet or try another one.');
  return api;
}
async function readCardanoState(api,network) {
  const id=await api.getNetworkId();
  // CIP-30 defines exactly two network ids: 0 (testnet) and 1 (mainnet).
  // Anything else is a broken wallet response, not a network to switch to.
  if(id!==0&&id!==1)throw new Error('The wallet reported an unrecognised network. Reconnect and try again.');
  if(id!==NETWORKS[network].id)throw new Error(`Switch your wallet to ${NETWORKS[network].name}${network==='mainnet'?'':' testnet'} and reconnect.`);
  const address=normalizeWalletAddress(await api.getChangeAddress());
  if(decodeAddress(address).network!==id)throw new Error('Wallet address and reported network do not match.');
  return {id,address};
}
export async function connectCardano(provider,network) {
  const api=assertCardanoApi(await provider.enable());
  const {id,address}=await readCardanoState(api,network);
  return {name:provider.name,api,networkId:id,address,connectedAt:Date.now()};
}
export async function refreshCardano(wallet,network) {
  const {id,address}=await readCardanoState(assertCardanoApi(wallet.api),network);
  if(id!==wallet.networkId||address!==wallet.address)throw new Error('Wallet account or network changed. Reconnect to continue.');
  return wallet;
}
async function readMidnightAddress(api) {
  if(!api||typeof api.getUnshieldedAddress!=='function')throw new Error('The wallet did not provide a complete Midnight API. Update the wallet or try another one.');
  // Never fetch balances or secret material. Read only the public unshielded address.
  const result=await api.getUnshieldedAddress();
  const address=typeof result==='string'?result:result?.unshieldedAddress;
  if(typeof address!=='string'||!address.startsWith('mn_addr')||address.length<20||address.length>250)throw new Error('The wallet did not provide a valid public address.');
  return address;
}
async function readMidnightState(api,network) {
  if(!api||typeof api.getConnectionStatus!=='function')throw new Error('The wallet did not provide a complete Midnight API. Update the wallet or try another one.');
  const status=await api.getConnectionStatus();
  // Compare against the network's Midnight id from the NETWORKS table, never
  // against the app's network key — the two coincide today by convention only.
  if(status?.status!=='connected')throw new Error('Midnight wallet is not connected.');
  if(status.networkId!==NETWORKS[network].midnight)throw new Error(`Midnight wallet is connected to ${status.networkId??'an unknown network'}, not ${NETWORKS[network].name}. Switch networks in the wallet and reconnect.`);
  return status;
}
export async function connectMidnight(provider,network) {
  if(!/^4\./.test(provider.apiVersion??''))throw new Error('Use a Midnight wallet with connector API v4.');
  const api=await provider.connect(NETWORKS[network].midnight);
  const status=await readMidnightState(api,network);
  const address=await readMidnightAddress(api);
  return {name:provider.name,api,address,network:NETWORKS[network].midnight,networkId:status.networkId,version:provider.apiVersion};
}
export async function refreshMidnight(wallet,network) {
  await readMidnightState(wallet.api,network);
  const address=await readMidnightAddress(wallet.api);
  if(address!==wallet.address)throw new Error('Midnight account changed. Reconnect to continue.');
  return wallet;
}
