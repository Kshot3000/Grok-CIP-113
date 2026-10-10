import { NETWORKS, PREVIEW_REFERENCE } from './config.js';
import { normalizeWalletAddress, decodeAddress, inspectAddress, inspectRewardAddress } from './cardano.js';

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
// Pure parser for the Foundation registry indexer's protocols response
// (GET /api/v1/registry/protocols on the per-network programmabletokens.xyz
// indexers). Every field a record must carry is validated and hex is
// canonicalised to lowercase; a record missing a field, or carrying one in
// a shape the indexer never sends, is refused whole — PRISM shows no
// deployment it could not read in full, and never repairs a record into a
// plausible-looking one.
export function parseRegistryProtocols(rows) {
  if(!Array.isArray(rows))throw new Error('Unexpected registry response.');
  return rows.map(v=>{
    if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid registry deployment record.');
    if(!Number.isSafeInteger(v.protocolParamsId)||v.protocolParamsId<0)throw new Error('Invalid registry deployment record: protocol parameters ID.');
    if(!Number.isSafeInteger(v.tokenCount)||v.tokenCount<0)throw new Error('Invalid registry deployment record: token count.');
    if(!Number.isSafeInteger(v.slot)||v.slot<0)throw new Error('Invalid registry deployment record: slot.');
    if(!(/^[a-f0-9]{56}$/i).test(v.registryNodePolicyId??''))throw new Error('Invalid registry deployment record: registry node policy ID.');
    if(!(/^[a-f0-9]{56}$/i).test(v.progLogicScriptHash??''))throw new Error('Invalid registry deployment record: programmable logic script hash.');
    if(!(/^[a-f0-9]{64}$/i).test(v.txHash??''))throw new Error('Invalid registry deployment record: deployment transaction.');
    return {protocolParamsId:v.protocolParamsId,registryNodePolicyId:v.registryNodePolicyId.toLowerCase(),progLogicScriptHash:v.progLogicScriptHash.toLowerCase(),tokenCount:v.tokenCount,slot:v.slot,txHash:v.txHash.toLowerCase()};
  });
}

// Cross-check the indexer's Preview view against the deployment pinned in
// src/config.js from the Foundation platform's own configuration: the
// pinned bootstrap transaction must be in the list, and the programmable
// logic hash the indexer reports for it must equal the pinned script hash.
// The indexer is a source, not an authority — on Preview PRISM can prove
// the record it shows is the pinned reference deployment, and says so only
// when both halves match. Other networks have no pin to check against and
// report null: no check was run, which is not the same as a check passing.
export function registryReferenceCheck(network, protocols) {
  if(network!=='preview')return null;
  const record=(protocols??[]).find(v=>v.txHash===PREVIEW_REFERENCE.txHash);
  if(!record)return {present:false,scriptHashMatches:false,txHash:PREVIEW_REFERENCE.txHash};
  return {present:true,scriptHashMatches:record.progLogicScriptHash===PREVIEW_REFERENCE.scriptHash,txHash:PREVIEW_REFERENCE.txHash};
}

// Live read of one network's CIP-113 registry deployments from the
// Foundation's hosted indexer for that network (NETWORKS[network]
// .registryApi — the same indexer family the platform's own frontend
// reads). Read-only; the response is parsed strictly and, on Preview,
// cross-checked against the pinned reference before anything is shown.
export async function getRegistry(network) {
  const net=NETWORKS[network];
  if(!net)throw new Error('Unknown network — choose a network before reading its registry.');
  const origin=new URL(net.registryApi);
  if(origin.protocol!=='https:')throw new Error('The registry API must use HTTPS.');
  const rows=await fetchJson(`${origin.href.replace(/\/$/,'')}/api/v1/registry/protocols`);
  const protocols=parseRegistryProtocols(rows);
  return {network,indexer:origin.origin,protocols,reference:registryReferenceCheck(network,protocols),fetchedAt:Date.now()};
}
// The registry's terminal value: thirty bytes of 0xff — the same sentinel
// the registry node datum model uses (domain.js REGISTRY_SENTINEL_NEXT).
// Deliberately 30 bytes, not 28, so it sorts after every 28-byte policy ID.
export const REGISTRY_TERMINAL_NEXT = 'ff'.repeat(30);
const HEX28 = /^[a-f0-9]{56}$/i;
const hex28OrEmpty = v => v === '' || HEX28.test(v ?? '');

// Pure parser for the Foundation registry indexer's tokens response
// (GET /api/v1/registry/tokens on the same per-network indexers). Each
// group names its protocol deployment (registry node policy + programmable
// logic base hash) and carries that deployment's registered token nodes in
// chain order — the origin node is NOT part of this response; the nodes
// listed are exactly the registered tokens. Every field is validated and
// hex canonicalised; a node's key must be a 28-byte policy ID and its next
// either the following 28-byte key or the 30-byte terminal sentinel. The
// four logic scripts and the global-state policy are each either a 28-byte
// hash or empty — empty is a meaning, not a defect (an empty unfracking
// script forbids unfracking for that policy; an empty global-state policy
// expects no global-state reference input). A malformed group or node
// refuses the whole response, never a partial chain.
export function parseRegistryTokens(rows) {
  if(!Array.isArray(rows))throw new Error('Unexpected registry tokens response.');
  return rows.map(g=>{
    if(!g||typeof g!=='object'||Array.isArray(g))throw new Error('Invalid registry token group.');
    const pp=g.protocolParams;
    if(!pp||typeof pp!=='object'||Array.isArray(pp))throw new Error('Invalid registry token group: protocol parameters.');
    if(!(HEX28).test(pp.registryNodePolicyId??''))throw new Error('Invalid registry token group: registry node policy ID.');
    if(!(HEX28).test(pp.programmableLogicBaseScriptHash??''))throw new Error('Invalid registry token group: programmable logic base script hash.');
    if(!Array.isArray(g.registryNodes))throw new Error('Invalid registry token group: registry nodes.');
    const registryNodes=g.registryNodes.map(n=>{
      if(!n||typeof n!=='object'||Array.isArray(n))throw new Error('Invalid registry node record.');
      if(!(HEX28).test(n.key??''))throw new Error('Invalid registry node record: key.');
      const next=String(n.next??'').toLowerCase();
      if(!((HEX28).test(next)||next===REGISTRY_TERMINAL_NEXT))throw new Error('Invalid registry node record: next.');
      for(const [field,label] of [['mintingLogicScript','minting logic script'],['transferLogicScript','transfer logic script'],['thirdPartyTransferLogicScript','third-party logic script'],['unfrackingLogicScript','unfracking logic script'],['globalStatePolicyId','global state policy ID']]) {
        if(!hex28OrEmpty(n[field]))throw new Error(`Invalid registry node record: ${label}.`);
      }
      return {key:n.key.toLowerCase(),next,mintingLogicScript:String(n.mintingLogicScript).toLowerCase(),transferLogicScript:String(n.transferLogicScript).toLowerCase(),thirdPartyTransferLogicScript:String(n.thirdPartyTransferLogicScript).toLowerCase(),unfrackingLogicScript:String(n.unfrackingLogicScript).toLowerCase(),globalStatePolicyId:String(n.globalStatePolicyId).toLowerCase()};
    });
    return {protocolParams:{registryNodePolicyId:pp.registryNodePolicyId.toLowerCase(),programmableLogicBaseScriptHash:pp.programmableLogicBaseScriptHash.toLowerCase()},registryNodes};
  });
}

// Verify one parsed token group as a registry CHAIN, and cross-check it
// against the deployments list from the protocols endpoint — two indexer
// endpoints that must agree before PRISM calls a list verified. The chain
// itself: keys strictly ascending (bytewise, which is lexicographic on
// canonical lowercase hex — duplicates fail this too), every node's next
// naming the following node's key, and the last node terminating at the
// 30-byte sentinel. The cross-check: a protocols record with the group's
// registry node policy must exist, its programmable-logic hash must equal
// the group's base hash, and its indexed token count must equal the number
// of nodes listed. An empty group is a chain that verifies nothing: every
// chain verdict is false, never a vacuous pass.
export function registryChainCheck(group, protocols) {
  const nodes=group?.registryNodes??[];
  const protocol=(protocols??[]).find(v=>v.registryNodePolicyId===group?.protocolParams?.registryNodePolicyId)??null;
  const sorted=nodes.length>0&&nodes.every((n,i)=>i===0||nodes[i-1].key<n.key);
  const linked=nodes.length>0&&nodes.every((n,i)=>i===nodes.length-1||n.next===nodes[i+1].key);
  const terminatesAtSentinel=nodes.length>0&&nodes[nodes.length-1].next===REGISTRY_TERMINAL_NEXT;
  const protocolFound=protocol!==null;
  const logicMatches=protocolFound&&protocol.progLogicScriptHash===group.protocolParams.programmableLogicBaseScriptHash;
  const countMatches=protocolFound&&protocol.tokenCount===nodes.length;
  return {registryNodePolicyId:group?.protocolParams?.registryNodePolicyId??null,nodeCount:nodes.length,sorted,linked,terminatesAtSentinel,protocolFound,logicMatches,countMatches,ok:sorted&&linked&&terminatesAtSentinel&&protocolFound&&logicMatches&&countMatches};
}

const NODE_FIELDS = ['mintingLogicScript','transferLogicScript','thirdPartyTransferLogicScript','unfrackingLogicScript','globalStatePolicyId'];
const NODE_FIELD_LABELS = {mintingLogicScript:'minting logic script',transferLogicScript:'transfer logic script',thirdPartyTransferLogicScript:'third-party logic script',unfrackingLogicScript:'unfracking logic script',globalStatePolicyId:'global state policy ID'};
function parseRegistryNode(n, allowOrigin) {
  if(!n||typeof n!=='object'||Array.isArray(n))throw new Error('Invalid registry node record.');
  const isOrigin = allowOrigin && n.key === '';
  if(!isOrigin && !(HEX28).test(n.key??''))throw new Error('Invalid registry node record: key.');
  const next=String(n.next??'').toLowerCase();
  if(!((HEX28).test(next)||next===REGISTRY_TERMINAL_NEXT))throw new Error('Invalid registry node record: next.');
  for(const field of NODE_FIELDS) {
    if(isOrigin) { if(n[field]!=='')throw new Error(`Invalid registry node record: origin node carries a ${NODE_FIELD_LABELS[field]}.`); }
    else if(!hex28OrEmpty(n[field]))throw new Error(`Invalid registry node record: ${NODE_FIELD_LABELS[field]}.`);
  }
  return {key:isOrigin?'':n.key.toLowerCase(),next,mintingLogicScript:String(n.mintingLogicScript).toLowerCase(),transferLogicScript:String(n.transferLogicScript).toLowerCase(),thirdPartyTransferLogicScript:String(n.thirdPartyTransferLogicScript).toLowerCase(),unfrackingLogicScript:String(n.unfrackingLogicScript).toLowerCase(),globalStatePolicyId:String(n.globalStatePolicyId).toLowerCase()};
}
function parseRegistryGroupParams(g) {
  const pp=g?.protocolParams;
  if(!pp||typeof pp!=='object'||Array.isArray(pp))throw new Error('Invalid registry token group: protocol parameters.');
  if(!(HEX28).test(pp.registryNodePolicyId??''))throw new Error('Invalid registry token group: registry node policy ID.');
  if(!(HEX28).test(pp.programmableLogicBaseScriptHash??''))throw new Error('Invalid registry token group: programmable logic base script hash.');
  return {registryNodePolicyId:pp.registryNodePolicyId.toLowerCase(),programmableLogicBaseScriptHash:pp.programmableLogicBaseScriptHash.toLowerCase()};
}

// Pure parser for the Foundation registry indexer's nodes/all response
// (GET /api/v1/registry/nodes/all?protocolParamsId=<id> on the same
// per-network indexers — the endpoint the platform's own frontend client
// names for a full registry walk). Unlike /registry/tokens, this response
// INCLUDES the head of the chain: the origin node, keyed by the empty
// bytestring, carrying no logic of its own (all five logic / global-state
// fields empty — a non-empty one is refused, because an origin that
// carries logic is not the origin the spec defines), pointing at the
// first registered token — or straight at the 30-byte terminal sentinel
// when the registry is empty. An empty-key node anywhere but the head, a
// group with no nodes at all (no origin to walk from), and any malformed
// node refuse the whole response, exactly as the tokens parser refuses.
export function parseRegistryNodesAll(rows) {
  if(!Array.isArray(rows))throw new Error('Unexpected registry walk response.');
  return rows.map(g=>{
    if(!g||typeof g!=='object'||Array.isArray(g))throw new Error('Invalid registry walk group.');
    const protocolParams=parseRegistryGroupParams(g);
    if(!Array.isArray(g.registryNodes)||g.registryNodes.length===0)throw new Error('Invalid registry walk group: registry nodes — the origin node is missing.');
    const registryNodes=g.registryNodes.map((n,i)=>parseRegistryNode(n,i===0));
    return {protocolParams,registryNodes};
  });
}

// Verify one parsed nodes/all group as a FULL registry walk — the head
// the tokens endpoint cannot show, plus the chain it can, plus agreement
// between the two reads. The walk itself: an origin node at the head
// carrying no logic, its next naming the first token key (or the
// terminal sentinel for an empty registry — an origin-only walk that
// terminates IS a complete walk of an empty registry, verified as such,
// not a vacuous pass: the head and its termination were both checked).
// The token nodes after the head must satisfy registryChainCheck itself
// (validate-once — the walk reuses the chain verdicts rather than
// restating them) and must agree NODE FOR NODE, every field, with the
// tokens endpoint's group for the same deployment: two reads of one
// chain that disagree anywhere fail the walk, however tidy each looks
// alone. When no tokens group was supplied to compare (its own read
// failed upstream), tokensAgree is null — not compared — and the walk
// verdict says so instead of claiming the cross-check ran.
export function registryWalkCheck(walkGroup, tokensGroup, protocols) {
  const nodes=walkGroup?.registryNodes??[];
  const origin=nodes[0]??null;
  const tokenNodes=nodes.slice(1);
  const hasOrigin=!!origin&&origin.key==='';
  const originCarriesNoLogic=hasOrigin&&NODE_FIELDS.every(f=>origin[f]==='');
  const originLinked=hasOrigin&&(tokenNodes.length?origin.next===tokenNodes[0].key:origin.next===REGISTRY_TERMINAL_NEXT);
  const chain=registryChainCheck({protocolParams:walkGroup?.protocolParams,registryNodes:tokenNodes},protocols);
  const matched=tokensGroup&&tokensGroup.protocolParams?.registryNodePolicyId===walkGroup?.protocolParams?.registryNodePolicyId?tokensGroup:null;
  const tokensCompared=matched!==null;
  const nodesEqual=(a,b)=>!!a&&!!b&&a.key===b.key&&a.next===b.next&&NODE_FIELDS.every(f=>a[f]===b[f]);
  const tokensAgree=!tokensCompared?null:(matched.registryNodes.length===tokenNodes.length&&matched.registryNodes.every((n,i)=>nodesEqual(n,tokenNodes[i])));
  const chainOk=tokenNodes.length?chain.sorted&&chain.linked&&chain.terminatesAtSentinel:true;
  const ok=hasOrigin&&originCarriesNoLogic&&originLinked&&chainOk&&chain.protocolFound&&chain.logicMatches&&chain.countMatches&&tokensAgree!==false;
  return {registryNodePolicyId:walkGroup?.protocolParams?.registryNodePolicyId??null,nodeCount:nodes.length,tokenCount:tokenNodes.length,hasOrigin,originCarriesNoLogic,originLinked,sorted:tokenNodes.length?chain.sorted:true,linked:tokenNodes.length?chain.linked:true,terminatesAtSentinel:tokenNodes.length?chain.terminatesAtSentinel:originLinked,protocolFound:chain.protocolFound,logicMatches:chain.logicMatches,countMatches:chain.countMatches,tokensCompared,tokensAgree,ok};
}

// Live read of one deployment's FULL registry walk (origin included)
// from the same Foundation indexer. The registry endpoints are keyed by
// the NUMERIC protocol parameters ID that only the protocols endpoint
// reports, so the caller passes the id from that list — an id that is
// not a non-negative integer is refused before any fetch, because a
// wrong id returns an empty or unrelated walk that looks like an empty
// registry. Read-only; strictly parsed; cross-checked against both the
// tokens groups and the deployments list the caller already read.
export async function getRegistryNodesAll(network, protocolParamsId, tokensGroups, protocols) {
  const net=NETWORKS[network];
  if(!net)throw new Error('Unknown network — choose a network before reading its registry.');
  if(!Number.isSafeInteger(protocolParamsId)||protocolParamsId<0)throw new Error('A registry walk needs the deployment’s protocol parameters ID from the deployments list.');
  const origin=new URL(net.registryApi);
  if(origin.protocol!=='https:')throw new Error('The registry API must use HTTPS.');
  const rows=await fetchJson(`${origin.href.replace(/\/$/,'')}/api/v1/registry/nodes/all?protocolParamsId=${protocolParamsId}`);
  const groups=parseRegistryNodesAll(rows);
  return {network,indexer:origin.origin,protocolParamsId,groups,walks:groups.map(g=>registryWalkCheck(g,(tokensGroups??[]).find(t=>t.protocolParams.registryNodePolicyId===g.protocolParams.registryNodePolicyId)??null,protocols)),fetchedAt:Date.now()};
}
// Live read of one network's registered token nodes from the same
// Foundation indexer getRegistry reads, cross-checked against that
// endpoint's deployments list. Read-only; strictly parsed.
export async function getRegistryTokens(network, protocols) {
  const net=NETWORKS[network];
  if(!net)throw new Error('Unknown network — choose a network before reading its registry.');
  const origin=new URL(net.registryApi);
  if(origin.protocol!=='https:')throw new Error('The registry API must use HTTPS.');
  const rows=await fetchJson(`${origin.href.replace(/\/$/,'')}/api/v1/registry/tokens`);
  const groups=parseRegistryTokens(rows);
  return {network,indexer:origin.origin,groups,chains:groups.map(g=>registryChainCheck(g,protocols)),fetchedAt:Date.now()};
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
// Pure summary of the addresses a connected wallet chose to share via the
// optional CIP-30 list methods. Everything is decoded locally; an entry that
// cannot be decoded is counted as unreadable and skipped — one malformed
// entry never fails the summary, and a list the wallet did not provide is
// reported as unavailable (null counts), never guessed. The CIP-113
// smart-wallet shape count follows the address inspector's rule: shape is
// reported as shape only, never as deployment membership.
export function summarizeWalletAddresses({changeAddress,usedAddresses=null,unusedAddresses=null,rewardAddresses=null}={},networkId) {
  const change=inspectAddress(normalizeWalletAddress(changeAddress));
  const scan=(list)=>{
    if(!Array.isArray(list))return null;
    const seen=new Map();let unreadable=0;
    for(const raw of list){
      try{const info=inspectAddress(normalizeWalletAddress(raw));if(!seen.has(info.address))seen.set(info.address,info);}
      catch{unreadable++;}
    }
    return {total:list.length,infos:[...seen.values()],unreadable};
  };
  const used=scan(usedAddresses),unused=scan(unusedAddresses);
  const paymentInfos=[change,...(used?.infos??[]),...(unused?.infos??[])];
  const wrongNetwork=paymentInfos.filter((info,i)=>i>0&&info.network!==networkId).length;
  let rewards=null;
  if(Array.isArray(rewardAddresses)){
    const parsed=[];let unreadable=0,wrongNet=0;
    for(const raw of rewardAddresses){
      try{const info=inspectRewardAddress(raw);parsed.push(info);if(info.network!==networkId)wrongNet++;}
      catch{unreadable++;}
    }
    rewards={total:rewardAddresses.length,parsed:parsed.length,unreadable,wrongNetwork:wrongNet,
      stakeMatchesChange:change.stake&&parsed.length?parsed.every(info=>info.hash===change.stake.hash):null};
  }
  return {
    networkId,
    lists:{used:used!==null,unused:unused!==null,rewards:rewards!==null},
    change:{address:change.address,kind:change.kind,stakeHash:change.stake?.hash??null},
    usedCount:used?used.infos.length:null,
    unusedCount:unused?unused.infos.length:null,
    baseCount:used?used.infos.filter(info=>info.kind==='Base').length:null,
    enterpriseCount:used?used.infos.filter(info=>info.kind==='Enterprise').length:null,
    smartWalletShapeCount:used?used.infos.filter(info=>info.smartWalletShape).length:null,
    changeListedAsUsed:used?used.infos.some(info=>info.address===change.address):null,
    distinctStakeCredentials:new Set(paymentInfos.filter(info=>info.stake).map(info=>info.stake.hash)).size,
    wrongNetwork,
    unreadable:(used?.unreadable??0)+(unused?.unreadable??0),
    rewards,
  };
}
// Reads the optional CIP-30 address lists after a connection. Each list is
// feature-detected and read independently: a wallet that lacks a method —
// or errors on it — leaves that list unavailable instead of failing the
// connection. Returns null when the wallet offers none of the list methods.
async function readAddressBook(api,changeAddress,networkId) {
  const lists={changeAddress,usedAddresses:null,unusedAddresses:null,rewardAddresses:null};
  let offered=false;
  for(const [key,method] of [['usedAddresses','getUsedAddresses'],['unusedAddresses','getUnusedAddresses'],['rewardAddresses','getRewardAddresses']]){
    if(typeof api[method]!=='function')continue;
    offered=true;
    try{const value=await api[method]();if(Array.isArray(value))lists[key]=value;}catch{/* unavailable list, not a failed connection */}
  }
  if(!offered)return null;
  try{return summarizeWalletAddresses(lists,networkId);}catch{return null;}
}
export async function connectCardano(provider,network) {
  const api=assertCardanoApi(await provider.enable());
  const {id,address}=await readCardanoState(api,network);
  const addressBook=await readAddressBook(api,address,id);
  return {name:provider.name,api,networkId:id,address,addressBook,connectedAt:Date.now()};
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
