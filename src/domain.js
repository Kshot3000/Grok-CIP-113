import { CONFIG, TEMPLATES, NETWORKS } from './config.js';

export const MAX_ASSET = 9223372036854775807n;
export const PARTICIPANTS = Object.freeze({
  approved:{ name:'Approved member', allowed:true, credential:true, frozen:false },
  pending:{ name:'Pending verification', allowed:false, credential:false, frozen:false },
  blocked:{ name:'Frozen member', allowed:true, credential:true, frozen:true },
});

export function fromTemplate(id='rwa') {
  const t=TEMPLATES.find(t=>t.id===id) ?? TEMPLATES[0];
  return { template:t.id, tokenName:t.tokenName, ticker:t.ticker, decimals:t.decimals, supply:t.supply, limit:t.limit, allowlist:t.allowlist, limitEnabled:t.limitEnabled, pausable:t.pausable, identity:t.identity, substandard:t.substandard ?? 'generic', paused:false };
}

export function toUnits(value, decimals=6) {
  const s=String(value).trim();
  if (!Number.isInteger(decimals)||decimals<0||decimals>6) throw new Error('Decimals must be between 0 and 6.');
  if (!/^\d+(\.\d+)?$/.test(s) || s.length>40) throw new Error('Enter a positive decimal amount, without commas or exponents.');
  const [whole,fraction='']=s.split('.');
  if(fraction.length>decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const n=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
  if(n>MAX_ASSET) throw new Error('Amount exceeds the supported signed 64-bit asset limit.');
  return n;
}

export function validateDesign(d) {
  const errors=[];
  if(typeof d?.tokenName!=='string'||!d.tokenName.trim()||new TextEncoder().encode(d.tokenName.trim()).length>32) errors.push('Asset name must contain 1–32 UTF-8 bytes.');
  if(typeof d?.ticker!=='string'||!(/^[A-Z][A-Z0-9]{1,7}$/).test(d.ticker)) errors.push('Ticker must use 2–8 uppercase letters or digits and start with a letter.');
  if(!Number.isInteger(d?.decimals)||d.decimals<0||d.decimals>6) errors.push('Choose 0–6 decimal places.');
  for(const k of ['allowlist','limitEnabled','pausable','identity','paused']) if(typeof d?.[k]!=='boolean') errors.push(`Invalid ${k} setting.`);
  if(!TEMPLATES.some(t=>t.id===d?.template)) errors.push('Unknown template.');
  if(!SUBSTANDARDS.some(s=>s.id===d?.substandard)) errors.push('Unknown substandard module.');
  try { if(toUnits(d.supply,d.decimals)<=0n) errors.push('Supply must be greater than zero.'); } catch(e) { errors.push(`Supply: ${e.message}`); }
  if(d?.limitEnabled) try { const cap=toUnits(d.limit,d.decimals); if(cap<=0n||cap>toUnits(d.supply,d.decimals)) errors.push('Transfer limit must be positive and no larger than supply.'); } catch(e) {errors.push(`Transfer limit: ${e.message}`);}
  return [...new Set(errors)];
}

export function simulateTransfer(design, input) {
  const invalid=validateDesign(design);
  const checks=[];
  const participant=PARTICIPANTS[input.recipient];
  let amount=0n;
  try { amount=toUnits(input.amount,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); }
  catch(e) {invalid.push(e.message);}
  if(!participant) invalid.push('Select a supported test participant.');
  if(invalid.length) return {allowed:false, invalid:true, checks:[{name:'Valid design and amount',pass:false,detail:invalid.join(' ')}]};
  checks.push({name:'Available supply',pass:amount<=toUnits(design.supply,design.decimals),detail:'Test amount must fit within the designed supply. No wallet balance is implied.'});
  checks.push({name:'Transfer access',pass:!design.allowlist||participant.allowed,detail:design.allowlist?'Recipient must be on the modeled allowlist.':'Open access is enabled.'});
  checks.push({name:'Transfer limit',pass:!design.limitEnabled||amount<=toUnits(design.limit,design.decimals),detail:design.limitEnabled?`Up to ${design.limit} ${design.ticker} per modeled transfer.`:'No per-transfer cap is modeled.'});
  checks.push({name:'Issuer controls',pass:!design.pausable||(!design.paused&&!participant.frozen),detail:design.pausable?(design.paused?'Issuer has paused all transfers.':participant.frozen?'This test participant is frozen.':'Transfers are active and the recipient is not frozen.'):'Pause and freeze controls are disabled.'});
  checks.push({name:'Eligibility requirement',pass:!design.identity||participant.credential,detail:design.identity?'Test participant must have modeled eligibility. This is not a verified credential or Midnight proof.':'No eligibility credential is required by this model.'});
  return {allowed:checks.every(c=>c.pass),invalid:false,checks};
}

// CIP-113 Layer-3 substandards, modeled from the Cardano Foundation reference
// platform (checked 2026-10-04). These are local models of the documented
// validator checks — nothing here reads an on-chain denylist, verifies a real
// certificate signature, or consults a real allowlist.
export const SUBSTANDARDS = Object.freeze([
  { id:'generic', name:'PRISM generic rules', short:'Generic rules', source:null,
    summary:'PRISM’s own rule toggles — allowlist, transfer cap, issuer pause/freeze, and modeled eligibility. A design aid, not a Foundation reference module.' },
  { id:'freeze-seize', name:'Freeze-and-seize', short:'Freeze-and-seize', source:`${CONFIG.platform}/tree/main/src/modules/freeze-and-seize`,
    summary:'Foundation reference module for regulated tokens: an on-chain denylist is consulted on every transfer, and authorised issuers can freeze or seize tokens held by denylisted credentials.' },
  { id:'kyc', name:'KYC (sender certificate)', short:'KYC', source:`${CONFIG.platform}/tree/main/docs/modules/kyc`,
    summary:'Foundation reference module: every transfer must carry a fresh certificate, signed by a trusted KYC entity, proving the sender was verified. Recipients are not checked.' },
  { id:'kyc-extended', name:'KYC extended (sender + recipient)', short:'KYC extended', source:`${CONFIG.platform}/tree/main/docs/modules/kyc-extended`,
    summary:'Everything in basic KYC, plus the recipient must appear in the issuer’s allowlist — anchored on chain by a Merkle Patricia Forestry root fingerprint — with an unexpired entry. Self-transfers skip the recipient check.' },
]);
export const substandardById = id => SUBSTANDARDS.find(s=>s.id===id);

function boolFields(input, fields) {
  if(!input||typeof input!=='object') throw new Error('Choose a substandard scenario.');
  for(const f of fields) if(typeof input[f]!=='boolean') throw new Error(`Scenario field ${f} must be true or false.`);
}

export function simulateSubstandardTransfer(substandard, s={}) {
  if(substandard==='freeze-seize') {
    boolFields(s,['senderDenylisted','recipientDenylisted']);
    const checks=[
      {name:'Sender not denylisted',pass:!s.senderDenylisted,detail:s.senderDenylisted?'The sender credential appears in the modeled on-chain denylist (a sorted linked list, checked with a covering-node proof). The reference validator rejects the transfer.':'Sender credential is absent from the modeled denylist.'},
      {name:'Recipient not denylisted',pass:!s.recipientDenylisted,detail:s.recipientDenylisted?'The recipient credential appears in the modeled on-chain denylist. Freeze-and-seize checks both parties, not just the sender.':'Recipient credential is absent from the modeled denylist.'},
    ];
    return {allowed:checks.every(c=>c.pass),checks};
  }
  if(substandard==='kyc'||substandard==='kyc-extended') {
    boolFields(s,['certPresent','certTrustedIssuer','certSignatureValid','certNamesSender','certExpired','paused']);
    const checks=[
      {name:'Trusted KYC entity',pass:s.certPresent&&s.certTrustedIssuer,detail:!s.certPresent?'No KYC certificate is attached to the modeled transfer.':s.certTrustedIssuer?'The certificate signer is in the issuer’s modeled trusted-entity list.':'The certificate signer is not in the issuer’s trusted-entity list.'},
      {name:'Certificate signature',pass:s.certPresent&&s.certSignatureValid,detail:!s.certPresent?'There is no certificate whose signature could verify.':s.certSignatureValid?'The modeled certificate signature verifies against the trusted entity’s key.':'The certificate signature does not verify.'},
      {name:'Certificate names this sender',pass:s.certPresent&&s.certNamesSender,detail:!s.certPresent?'There is no certificate naming any sender.':s.certNamesSender?'The certificate is bound to the sender spending the token.':'The certificate names a different wallet; a certificate cannot be borrowed.'},
      {name:'Certificate still valid',pass:s.certPresent&&!s.certExpired,detail:!s.certPresent?'There is no certificate with a validity window.':s.certExpired?'The certificate has expired. Certificates are short-lived (the reference walkthrough uses about 30 days) and are not revoked retroactively — expiry is the cutoff.':'The transaction deadline falls within the certificate’s validity window.'},
      {name:'Transfers not paused',pass:!s.paused,detail:s.paused?'The issuer pause flag in the modeled global state is set; every transfer fails while it is set.':'The modeled global state is not paused.'},
    ];
    if(substandard==='kyc-extended') {
      boolFields(s,['recipientAllowlisted','recipientEntryExpired','selfTransfer']);
      checks.push(
        {name:'Recipient in allowlist',pass:s.selfTransfer||s.recipientAllowlisted,detail:s.selfTransfer?'Self-transfer: the reference module skips the recipient check when sender and recipient are the same wallet.':s.recipientAllowlisted?'A modeled inclusion proof reconstructs the on-chain allowlist fingerprint.':'No valid inclusion proof against the modeled allowlist fingerprint (a Merkle Patricia Forestry root).'},
        {name:'Recipient entry current',pass:s.selfTransfer||(s.recipientAllowlisted&&!s.recipientEntryExpired),detail:s.selfTransfer?'Self-transfer: no recipient entry is consulted.':!s.recipientAllowlisted?'There is no allowlist entry whose expiry could be checked.':s.recipientEntryExpired?'The allowlist entry’s validity window (TTL) has elapsed; expired members are pruned by the issuer’s publisher.':'The allowlist entry is within its validity window.'},
      );
    }
    return {allowed:checks.every(c=>c.pass),checks};
  }
  throw new Error('Choose a modeled reference substandard (freeze-and-seize, KYC, or KYC extended). Generic PRISM rules are evaluated by the transfer simulator.');
}

export function simulateSeizure(s={}) {
  boolFields(s,['actorAuthorised','holderDenylisted']);
  const checks=[
    {name:'Authorised issuer action',pass:s.actorAuthorised,detail:s.actorAuthorised?'The actor is a modeled authorised party for this token.':'Only authorised parties may invoke freeze or seizure in the reference module; it is a third-party action, not a holder action.'},
    {name:'Holder is denylisted',pass:s.holderDenylisted,detail:s.holderDenylisted?'The holder credential is on the modeled denylist, so its tokens may be frozen or seized.':'Freeze and seizure apply only to denylisted credentials; a holder in good standing cannot be seized.'},
  ];
  return {allowed:checks.every(c=>c.pass),checks};
}

export function makeManifest(design, network) {
  const errors=validateDesign(design);
  if(errors.length) throw new Error(errors.join(' '));
  if(!NETWORKS[network]) throw new Error('Unknown network.');
  return {
    kind:'prism.cip113-design', version:1, createdAt:new Date().toISOString(), network,
    design:{...design}, token:{name:design.tokenName.trim(),ticker:design.ticker,decimals:design.decimals,initialSupplyBaseUnits:toUnits(design.supply,design.decimals).toString()},
    status:'design-only',
    implementation:{standard:'CIP-113',standardStatus:'Proposed',source:CONFIG.cip,reference:CONFIG.platform,
      substandard:{id:design.substandard,name:substandardById(design.substandard).name,reference:substandardById(design.substandard).source,modeledLocally:true},
      required:['Reviewed issuance and transfer validators','Registered token policy and protocol deployment','Validated state and transaction builders','Independent security review'],
      midnight:{mode:design.identity?'planned-eligibility-attestation':'none',proofVerified:false,bridgeDeployed:false},
      realfi:{affiliation:false,productIssued:false},
    },
    note:'This is a PRISM design manifest, not a CIP-defined datum, Plutus blueprint, policy ID, transaction, compliance certification, or deployed asset.',
  };
}

// Application-specific preview of the design information a CIP-113 registry
// entry would need to describe. This is NOT a CIP-defined datum: it carries no
// policy ID, no Plutus Data / CBOR encoding, no registry-node position, and no
// on-chain proof — those exist only after reviewed validators are deployed and
// a real registry node is created by the pinned reference implementation.
// Deterministic by design (no timestamp), so two exports of the same design
// can be diffed field by field.
export function registryDatumPreview(design, network) {
  const errors=validateDesign(design);
  if(errors.length) throw new Error(errors.join(' '));
  if(!NETWORKS[network]) throw new Error('Unknown network.');
  const sub=substandardById(design.substandard);
  return {
    kind:'prism.registry-datum-preview', previewVersion:1,
    applicationSpecific:true, cipDatum:false, registeredOnChain:false,
    network,
    token:{name:design.tokenName.trim(),ticker:design.ticker,decimals:design.decimals,initialSupplyBaseUnits:toUnits(design.supply,design.decimals).toString()},
    transferPolicy:{
      access:design.allowlist?'allowlist':'open',
      perTransferLimitBaseUnits:design.limitEnabled?toUnits(design.limit,design.decimals).toString():null,
      issuerPauseModeled:design.pausable,
      eligibilityRequired:design.identity,
    },
    substandard:{id:design.substandard,name:sub.name,reference:sub.source,modeledLocally:true},
    registryFieldsStillRequired:[
      'Token policy ID, issued by reviewed and deployed validators',
      'Registry node position and membership / non-membership proofs from the live deployment',
      'Protocol parameters and programmable-logic base script hash of the target deployment',
      'Datum encoding (Plutus Data / CBOR) produced by the pinned reference implementation',
    ],
    note:'This preview is a PRISM design aid, not a CIP-113 registry datum, Plutus blueprint, policy ID, or on-chain registration. PRISM does not register, mint, or deploy anything. A developer must implement the token with the pinned Foundation reference implementation, create the registry entry on a test network, and verify it independently before any production use.',
  };
}

export function parseManifest(raw) {
  if(typeof raw!=='string'||raw.length>100000) throw new Error('Choose a PRISM JSON file under 100 KB.');
  let m;
  try { m=JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  if(m?.kind!=='prism.cip113-design'||m.version!==1||!NETWORKS[m.network]) throw new Error('This is not a supported PRISM design manifest.');
  if(!m.design||typeof m.design!=='object'||Array.isArray(m.design)) throw new Error('This manifest has no design section.');
  // Amounts must arrive as decimal strings. A JSON number would already have
  // lost precision before this code runs (JSON.parse rounds past 2^53), which
  // would silently change the designed supply in a tool whose promise is
  // BigInt-exact amounts — so numbers are rejected, never converted.
  for(const k of ['supply','limit']) if(typeof m.design[k]!=='string') throw new Error(`Design ${k} must be a decimal string, not a JSON ${Array.isArray(m.design[k])?'array':typeof m.design[k]}. Re-export the design from PRISM.`);
  // Canonicalise incidental whitespace so the imported design, its token
  // summary, and the preview all describe the same asset.
  const rawDesign={...m.design,
    tokenName:typeof m.design.tokenName==='string'?m.design.tokenName.trim():m.design.tokenName,
    supply:m.design.supply.trim(), limit:m.design.limit.trim()};
  // Manifests written before substandards existed default to the generic rule set.
  if(rawDesign.substandard===undefined) rawDesign.substandard='generic';
  const errors=validateDesign(rawDesign);
  if(errors.length) throw new Error(errors.join(' '));
  // The token summary is a second copy of the design's identity. If the two
  // copies disagree, the file was edited after export — reject it instead of
  // silently importing one copy and re-exporting the other.
  if(!m.token||typeof m.token!=='object'||Array.isArray(m.token)) throw new Error('This manifest is missing its token summary. Re-export the design from PRISM.');
  const expected={name:rawDesign.tokenName,ticker:rawDesign.ticker,decimals:rawDesign.decimals,initialSupplyBaseUnits:toUnits(rawDesign.supply,rawDesign.decimals).toString()};
  for(const k of Object.keys(expected)) if(m.token[k]!==expected[k]) throw new Error(`Manifest token summary does not match its design (${k}). The file may have been edited after export — re-export it from PRISM.`);
  // Honesty claims are verified, not trusted. Sections written by every PRISM
  // export may be absent in a hand-trimmed file, but when present they must
  // not claim a deployment, a verified proof, an affiliation, or a standard
  // status PRISM cannot back. (The design's substandard is authoritative;
  // implementation is descriptive metadata.)
  if(m.status!==undefined&&m.status!=='design-only') throw new Error('This manifest claims a status other than design-only. PRISM designs are not deployed assets — re-export it from PRISM.');
  const impl=m.implementation;
  if(impl!==undefined) {
    if(!impl||typeof impl!=='object'||Array.isArray(impl)) throw new Error('This manifest has a malformed implementation section.');
    if(impl.standard!==undefined&&impl.standard!=='CIP-113') throw new Error('This manifest names a standard other than CIP-113.');
    if(impl.standardStatus!==undefined&&impl.standardStatus!=='Proposed') throw new Error('This manifest claims a CIP-113 status other than Proposed, which does not match the published specification.');
    for(const [section,key,label] of [['midnight','proofVerified','a verified Midnight proof'],['midnight','bridgeDeployed','a deployed Midnight bridge'],['realfi','affiliation','a RealFi affiliation'],['realfi','productIssued','an issued RealFi product']]) {
      const v=impl[section]?.[key];
      if(v!==undefined&&v!==false) throw new Error(`This manifest claims ${label}, which PRISM cannot back. Re-export it from PRISM.`);
    }
  }
  // Whitelist fields; imported objects never become app configuration or API endpoints.
  const design={};
  for(const k of Object.keys(fromTemplate())) design[k]=rawDesign[k];
  return {design,network:m.network};
}

export function creditScenario({principal,rate,months,collateral,advance}) {
  const v=[principal,rate,months,collateral,advance].map(Number);
  if(v.some(x=>!Number.isFinite(x))||v[0]<=0||v[0]>1e12||v[1]<0||v[1]>100||v[2]<1||v[2]>360||v[3]<=0||v[3]>1e12||v[4]<1||v[4]>100) throw new Error('Use positive principal and collateral, 0–100% APR, 1–360 months, and a 1–100% advance rate.');
  const [p,r,m,c,a]=v, interest=p*(r/100)*(m/12), ceiling=c*a/100;
  return {interest,total:p+interest,ceiling,ltv:p/c*100,headroom:ceiling-p,withinLimit:p<=ceiling};
}

export function checkEligibility({score,minimum,age,adult,region,approved}) {
  if(![score,minimum,age].every(Number.isFinite)||score<0||score>100||minimum<0||minimum>100||age<0||age>120) throw new Error('Use scores between 0 and 100 and an age between 0 and 120.');
  const checks=[{name:'Score threshold',pass:score>=minimum},{name:'Age threshold',pass:!adult||age>=18},{name:'Region requirement',pass:!region||approved}];
  return {eligible:checks.every(x=>x.pass),checks};
}
