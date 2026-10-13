import { CONFIG, TEMPLATES, NETWORKS } from './config.js';
import { blake2b, hexToBytes, bytesToHex } from './cardano.js';

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


// A local design review: deterministic findings about a design's own
// internal coherence, computed only from the design itself — rule coverage,
// whether the per-transfer cap can ever bind, the pause state the design
// would start in, how the generic toggles line up with the chosen CIP-113
// substandard's documented checks, and exact supply arithmetic against the
// signed 64-bit asset ceiling. This is a design aid, NOT a security audit:
// it reads no chain state, reviews no validator code, and a clean review
// never means a design is safe or deployable.
export function auditDesign(design) {
  const errors=validateDesign(design);
  const counts={blocker:0,warning:0,note:0,ok:0};
  const findings=[];
  const add=(id,level,title,detail)=>{findings.push({id,level,title,detail});counts[level]++;};
  if(errors.length) {
    add('validity','blocker','Design is not yet well-formed',errors.join(' '));
    return {invalid:true,errors,ready:false,counts,findings};
  }
  add('validity','ok','Design is well-formed','Every field passes the studio\u2019s validation: name, ticker, decimals, exact supply, and a transfer limit no larger than the supply.');
  const supply=toUnits(design.supply,design.decimals);
  const active=['allowlist','limitEnabled','pausable','identity'].filter(k=>design[k]).length;
  if(active===0&&design.substandard==='generic') add('rule-coverage','warning','No transfer rules are active','All four generic rules are off and the substandard is PRISM\u2019s generic rule set, so this design behaves like an ordinary native token \u2014 the CIP-113 framework would add transfer cost without enforcing anything. Turn on at least one rule or choose a reference substandard.');
  else if(active===0) add('rule-coverage','note','Generic toggles are all off','The chosen substandard module carries its own documented checks, modeled separately in the Test tab \u2014 the four generic toggles are not what enforces them.');
  else add('rule-coverage','ok',`${active} of 4 generic rules are active`,'Allowlist, transfer limit, issuer controls, and eligibility are the generic layers a modeled transfer is checked against in the Test tab.');
  if(design.limitEnabled) {
    const cap=toUnits(design.limit,design.decimals);
    if(cap===supply) add('cap-effectiveness','warning','The transfer cap can never block a transfer','The cap equals the entire designed supply, and no single modeled transfer can exceed the supply \u2014 so the cap passes every transfer it could ever see. Lower it below the supply for it to bind.');
    else {
      const hundredths=cap*10000n/supply;
      const pct=hundredths===0n?'<0.01':`${hundredths/100n}.${String(hundredths%100n).padStart(2,'0')}`;
      add('cap-effectiveness','ok',`Transfer cap is ${pct}% of the designed supply`,`One modeled transfer can move at most ${formatUnits(cap,design.decimals)} ${design.ticker} of ${formatUnits(supply,design.decimals)} ${design.ticker}. The cap is per transfer, not cumulative \u2014 the sequence lab shows repeated transfers each passing under it.`);
    }
  } else add('cap-effectiveness','note','No per-transfer cap','A single modeled transfer can move an account\u2019s whole balance (up to the designed supply). Add a transfer limit if large single moves should be impossible by design.');
  if(design.paused) add('pause-state','warning','This design starts paused','The issuer-pause flag is set in the design itself, so every modeled transfer is blocked until it is cleared. That is the right default for a staged launch only if it is deliberate.');
  else if(design.pausable) add('pause-state','ok','Issuer controls are armed and not paused','Pause and freeze checks are modeled, and the design does not start paused.');
  else add('pause-state','note','No issuer pause or freeze control','With issuer controls off, the generic model has no way to halt transfers or freeze a participant after launch. Regulated designs usually keep this control; the freeze-and-seize substandard\u2019s denylist is a separate mechanism, modeled in the Test tab.');
  if(design.substandard==='kyc-extended'&&!design.allowlist) add('substandard-alignment','warning','KYC extended expects a recipient allowlist','The extended module\u2019s documented recipient check is an issuer allowlist entry, but the generic allowlist toggle is off \u2014 the two layers disagree about who may receive. Turn the allowlist on, or model the recipient check only in the substandard lab and say so in the design notes.');
  if(design.substandard==='kyc'&&design.allowlist) add('substandard-alignment','note','Basic KYC checks the sender only','The documented basic-KYC module verifies the sender\u2019s certificate and does not check recipients. Recipients in this design are gated by PRISM\u2019s generic allowlist toggle instead \u2014 a separate layer from the substandard\u2019s own checks.');
  if(design.identity&&!design.allowlist) add('eligibility-scope','note','Eligibility is required, distribution is open','Any modeled participant holding an eligibility credential can receive, from anyone \u2014 the design checks who a recipient is, not who may send to them. Pair eligibility with the allowlist if distribution itself must be restricted.');
  if(supply*10n>MAX_ASSET*9n) add('supply-headroom','warning','Supply sits near the signed 64-bit ceiling',`The designed supply is ${supply.toString()} base units (${formatUnits(supply,design.decimals)} ${design.ticker} at ${design.decimals} decimals) \u2014 over 90% of the ${MAX_ASSET.toString()} base-unit maximum this studio models. There is almost no headroom above it.`);
  if(design.decimals===0) add('divisibility','note','This token is indivisible','With 0 decimals every transfer, cap, and balance is a whole number of tokens \u2014 there is no fractional amount to model, and the transfer tests reject one.');
  return {invalid:false,errors:[],ready:counts.blocker===0,counts,findings};
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

// Ledger accounts for the transfer-sequence model: the issuer starts holding
// the full designed supply and the three fictional participants start at
// zero. The issuer is a modeled account like any other — it is on the
// allowlist and holds a modeled eligibility credential, and it is never
// frozen — so sequences can also model tokens flowing back to the issuer.
export const LEDGER_ACCOUNTS = Object.freeze({
  issuer:{ name:'Issuer (initial holder)', allowed:true, credential:true, frozen:false },
  ...PARTICIPANTS,
});

// Exact decimal rendering of a BigInt base-unit amount. No Number conversion
// anywhere, so amounts past 2^53 render digit-for-digit; trailing fractional
// zeros are trimmed ('1.500000' at 6 decimals renders as '1.5').
export function formatUnits(baseUnits, decimals=6) {
  if(typeof baseUnits!=='bigint') throw new Error('Base units must be a BigInt.');
  if(!Number.isInteger(decimals)||decimals<0||decimals>6) throw new Error('Decimals must be between 0 and 6.');
  const negative=baseUnits<0n, abs=negative?-baseUnits:baseUnits, scale=10n**BigInt(decimals);
  const whole=abs/scale, fraction=abs%scale;
  const rendered=fraction===0n||decimals===0?whole.toString():`${whole}.${fraction.toString().padStart(decimals,'0').replace(/0+$/,'')}`;
  return negative?`-${rendered}`:rendered;
}

// A sequence of modeled transfers against a running ledger — the studio's
// single-transfer checks, applied in order, where one step changes the
// balances the next step is checked against. A blocked step leaves every
// balance unchanged and later steps are still evaluated, so a designer can
// see the knock-on effect of a denial (an onward transfer from an account
// that never received its funding fails on balance, not on surprise).
// Local simulation only: the ledger is fictional, no wallet is read, and
// nothing here executes a validator or produces a transaction.
export function simulateTransferSequence(design, transfers) {
  const errors=validateDesign(design);
  let supply=0n;
  try { supply=toUnits(design.supply,design.decimals); } catch { /* An invalid design reports its errors below; the ledger stays at zero. */ }
  const balances={};
  for(const k of Object.keys(LEDGER_ACCOUNTS)) balances[k]=k==='issuer'?supply:0n;
  const finish=steps=>({
    invalid:errors.length>0, errors,
    steps,
    balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),
    transferredBaseUnits:steps.filter(s=>s.allowed).reduce((sum,s)=>sum+BigInt(s.amountBaseUnits),0n).toString(),
    appliedCount:steps.filter(s=>s.allowed).length,
  });
  if(errors.length) return finish([]);
  if(!Array.isArray(transfers)||transfers.length<1||transfers.length>12) throw new Error('A transfer sequence needs between 1 and 12 modeled transfers.');
  const steps=transfers.map((t,i)=>{
    if(!t||typeof t!=='object'||Array.isArray(t)) throw new Error(`Transfer ${i+1} must describe a sender, a recipient, and an amount.`);
    let amount=null, amountError='';
    try { amount=toUnits(t.amount,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); }
    catch(e) { amountError=e.message; }
    if(amountError) return {from:t.from,to:t.to,amount:String(t.amount??''),amountBaseUnits:null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:amountError}]};
    const from=LEDGER_ACCOUNTS[t.from], to=LEDGER_ACCOUNTS[t.to];
    if(!from||!to) return {from:t.from,to:t.to,amount:String(t.amount),amountBaseUnits:amount.toString(),allowed:false,checks:[{name:'Known accounts',pass:false,detail:'Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.'}]};
    const checks=[
      {name:'Sender balance',pass:balances[t.from]>=amount,detail:balances[t.from]>=amount?`The modeled sender holds ${formatUnits(balances[t.from],design.decimals)} ${design.ticker} when this step runs.`:`The modeled sender holds only ${formatUnits(balances[t.from],design.decimals)} ${design.ticker} when this step runs — earlier steps in the sequence count.`},
      {name:'Transfer access',pass:!design.allowlist||to.allowed,detail:design.allowlist?'Recipient must be on the modeled allowlist.':'Open access is enabled.'},
      {name:'Transfer limit',pass:!design.limitEnabled||amount<=toUnits(design.limit,design.decimals),detail:design.limitEnabled?`Up to ${design.limit} ${design.ticker} per modeled transfer — the cap is per transfer, not cumulative.`:'No per-transfer cap is modeled.'},
      {name:'Issuer controls',pass:!design.pausable||(!design.paused&&!from.frozen&&!to.frozen),detail:design.pausable?(design.paused?'Issuer has paused all transfers.':from.frozen?'The sender is frozen.':to.frozen?'The recipient is frozen.':'Transfers are active and neither party is frozen.'):'Pause and freeze controls are disabled.'},
      {name:'Eligibility requirement',pass:!design.identity||to.credential,detail:design.identity?'Recipient must have modeled eligibility. This is not a verified credential or Midnight proof.':'No eligibility credential is required by this model.'},
    ];
    const allowed=checks.every(c=>c.pass);
    if(allowed) { balances[t.from]-=amount; balances[t.to]+=amount; }
    return {from:t.from,to:t.to,amount:String(t.amount),amountBaseUnits:amount.toString(),allowed,checks};
  });
  return finish(steps);
}

// Supply-change (issuance) model: how the designed supply itself would move
// if the issuer minted more of the token or burned some of it. The designed
// supply is an INITIAL supply (that is what the manifest records), so a
// builder needs to reason about it changing — a mint is bounded only by the
// signed 64-bit asset ceiling this studio models, and a burn only by what
// was issued. This is PRISM's generic issuance model, not a Foundation
// substandard module: a real token's issuance delegate defines its own
// authority and bounds, and PRISM reads neither. Transfer rules are NOT
// what gates issuance here — the allowlist, the per-transfer cap, and the
// issuer pause are transfer checks, modeled in the transfer labs above.
// Local simulation only: no tokens are minted or burned, no transaction
// is produced, and no on-chain supply is read.
export function simulateSupplyChange(design, input={}) {
  const invalid=validateDesign(design);
  let amount=0n;
  if(!input||typeof input!=='object'||Array.isArray(input)) invalid.push('Choose a supply change.');
  else {
    if(!['mint','burn'].includes(input.action)) invalid.push('Choose mint or burn.');
    if(!['issuer','other'].includes(input.actor)) invalid.push('Choose who attempts the change.');
    try { amount=toUnits(input.amount,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); }
    catch(e) { invalid.push(e.message); }
  }
  if(invalid.length) return {allowed:false,invalid:true,checks:[{name:'Valid design and amount',pass:false,detail:invalid.join(' ')}],action:input?.action??null,amountBaseUnits:null,supplyBeforeBaseUnits:null,supplyAfterBaseUnits:null};
  const supply=toUnits(design.supply,design.decimals);
  const mint=input.action==='mint';
  const after=mint?supply+amount:supply-amount;
  const checks=[
    {name:'Issuance authority',pass:input.actor==='issuer',detail:input.actor==='issuer'?'The modeled issuer holds this design\u2019s issuance authority.':'A non-issuer has no issuance authority in this generic model \u2014 supply changes are an issuer action here. A real token\u2019s issuance logic defines its own authority; this model does not read it.'},
  ];
  if(mint) checks.push({name:'Int64 ceiling headroom',pass:after<=MAX_ASSET,detail:after<=MAX_ASSET?`Minting would raise the modeled supply to ${formatUnits(after,design.decimals)} ${design.ticker} (${after.toString()} base units), within the ${MAX_ASSET.toString()} base-unit ceiling this studio models.`:`Minting ${formatUnits(amount,design.decimals)} ${design.ticker} would raise the modeled supply to ${after.toString()} base units, past the ${MAX_ASSET.toString()} base-unit ceiling this studio models.`});
  else checks.push({name:'Sufficient current supply',pass:amount<=supply,detail:amount<=supply?`Burning would lower the modeled supply to ${formatUnits(after,design.decimals)} ${design.ticker} (${after.toString()} base units).`:`Only ${formatUnits(supply,design.decimals)} ${design.ticker} exists in the modeled supply \u2014 a burn cannot destroy more than was issued.`});
  return {allowed:checks.every(c=>c.pass),invalid:false,checks,action:input.action,amountBaseUnits:amount.toString(),supplyBeforeBaseUnits:supply.toString(),supplyAfterBaseUnits:after>=0n?after.toString():null};
}

// A sequence of supply changes against a running modeled supply — the
// single-change checks above, applied in order, where one step changes the
// supply the next step is checked against. This is what an issuance
// schedule actually looks like: a burn creates headroom under the int64
// ceiling that a later mint can use, and an oversize burn blocked early
// leaves the supply intact for a smaller burn later. A blocked step leaves
// the supply unchanged and later steps are still evaluated, so the
// knock-on effect of a denial is visible. Local simulation only, under
// the same generic issuance model as simulateSupplyChange: no tokens are
// minted or burned, no transaction is produced, and no on-chain supply
// is read.
export function simulateSupplySequence(design, changes) {
  const errors=validateDesign(design);
  let initial=0n;
  try { initial=toUnits(design.supply,design.decimals); } catch { /* An invalid design reports its errors below; the supply stays at zero. */ }
  let running=initial;
  const finish=steps=>({
    invalid:errors.length>0, errors,
    steps,
    initialSupplyBaseUnits:initial.toString(),
    finalSupplyBaseUnits:running.toString(),
    netChangeBaseUnits:(running-initial).toString(),
    appliedCount:steps.filter(s=>s.allowed).length,
  });
  if(errors.length) return finish([]);
  if(!Array.isArray(changes)||changes.length<1||changes.length>12) throw new Error('A supply sequence needs between 1 and 12 modeled changes.');
  const steps=changes.map((c,i)=>{
    if(!c||typeof c!=='object'||Array.isArray(c)) throw new Error(`Supply change ${i+1} must describe an action, an actor, and an amount.`);
    const before=running;
    let amount=null, amountError='';
    try { amount=toUnits(c.amount,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); }
    catch(e) { amountError=e.message; }
    if(amountError) return {action:c.action??null,actor:c.actor??null,amount:String(c.amount??''),amountBaseUnits:null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:amountError}],supplyBeforeBaseUnits:before.toString(),supplyAfterBaseUnits:before.toString()};
    if(!['mint','burn'].includes(c.action)||!['issuer','other'].includes(c.actor)) return {action:c.action??null,actor:c.actor??null,amount:String(c.amount),amountBaseUnits:amount.toString(),allowed:false,checks:[{name:'Known supply change',pass:false,detail:'Each step must be a mint or a burn, attempted by the issuer or by someone else.'}],supplyBeforeBaseUnits:before.toString(),supplyAfterBaseUnits:before.toString()};
    const mint=c.action==='mint';
    const after=mint?before+amount:before-amount;
    const checks=[
      {name:'Issuance authority',pass:c.actor==='issuer',detail:c.actor==='issuer'?'The modeled issuer holds this design\u2019s issuance authority.':'A non-issuer has no issuance authority in this generic model \u2014 supply changes are an issuer action here. A real token\u2019s issuance logic defines its own authority; this model does not read it.'},
    ];
    if(mint) checks.push({name:'Int64 ceiling headroom',pass:after<=MAX_ASSET,detail:after<=MAX_ASSET?`Minting would raise the modeled supply to ${formatUnits(after,design.decimals)} ${design.ticker} (${after.toString()} base units), within the ${MAX_ASSET.toString()} base-unit ceiling this studio models.`:`Minting ${formatUnits(amount,design.decimals)} ${design.ticker} would raise the modeled supply to ${after.toString()} base units, past the ${MAX_ASSET.toString()} base-unit ceiling this studio models.`});
    else checks.push({name:'Sufficient current supply',pass:amount<=before,detail:amount<=before?`Burning would lower the modeled supply to ${formatUnits(after,design.decimals)} ${design.ticker} (${after.toString()} base units).`:`Only ${formatUnits(before,design.decimals)} ${design.ticker} exists in the modeled supply at this step \u2014 earlier steps in the sequence count. A burn cannot destroy more than was issued.`});
    const allowed=checks.every(x=>x.pass);
    if(allowed) running=after;
    return {action:c.action,actor:c.actor,amount:String(c.amount),amountBaseUnits:amount.toString(),allowed,checks,supplyBeforeBaseUnits:before.toString(),supplyAfterBaseUnits:running.toString()};
  });
  return finish(steps);
}

// A combined timeline: transfer steps and supply steps interleaved against
// ONE running modeled state — a ledger of balances plus the supply those
// balances sum to. The two labs above each hold one side fixed (transfers
// keep the designed supply; supply changes track no holder), so neither can
// show the interactions a real issuance lifecycle has: minted tokens become
// transferable in the same timeline, tokens the issuer has distributed are
// no longer the issuer's to burn, and burning the issuer's holding can leave
// a later distribution short. The invariant the model maintains is exact:
// the modeled balances always sum to the modeled supply. Minted tokens enter
// at the issuer (the generic issuance model of the supply labs); a burn
// draws on the issuer's modeled holding — tokens held by other modeled
// accounts are not burned here, which is why a burn can be blocked by the
// issuer's balance even when the total supply would cover it. Transfer steps
// keep the transfer labs' checks (including the per-transfer cap and the
// pause); supply steps keep the supply labs' checks (authority, int64
// ceiling, issued supply) — transfer rules still do not gate issuance, and
// issuance checks do not gate transfers. A blocked step changes nothing and
// later steps are still evaluated. Local simulation only: no tokens are
// minted, burned, or moved, no wallet or on-chain state is read, and no
// transaction is produced.
export const MAX_TIMELINE_STEPS = 12;

export function simulateTimeline(design, steps) {
  const errors=validateDesign(design);
  let initial=0n;
  try { initial=toUnits(design.supply,design.decimals); } catch { /* An invalid design reports its errors below; the state stays at zero. */ }
  let running=initial;
  const balances={};
  for(const k of Object.keys(LEDGER_ACCOUNTS)) balances[k]=k==='issuer'?initial:0n;
  const finish=list=>({
    invalid:errors.length>0, errors,
    steps:list,
    balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),
    initialSupplyBaseUnits:initial.toString(),
    finalSupplyBaseUnits:running.toString(),
    netChangeBaseUnits:(running-initial).toString(),
    transferredBaseUnits:list.filter(s=>s.kind==='transfer'&&s.allowed).reduce((sum,s)=>sum+BigInt(s.amountBaseUnits),0n).toString(),
    appliedCount:list.filter(s=>s.allowed).length,
  });
  if(errors.length) return finish([]);
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_TIMELINE_STEPS) throw new Error(`A timeline needs between 1 and ${MAX_TIMELINE_STEPS} modeled steps.`);
  const list=steps.map((step,i)=>{
    if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error(`Timeline step ${i+1} must describe a transfer or a supply change.`);
    const supplyBefore=running;
    const unchanged={supplyBeforeBaseUnits:supplyBefore.toString(),supplyAfterBaseUnits:supplyBefore.toString()};
    let amount=null, amountError='';
    try { amount=toUnits(step.amount,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); }
    catch(e) { amountError=e.message; }
    if(step.kind==='transfer') {
      if(amountError) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount??''),amountBaseUnits:null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:amountError}],...unchanged};
      const from=LEDGER_ACCOUNTS[step.from], to=LEDGER_ACCOUNTS[step.to];
      if(!from||!to) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed:false,checks:[{name:'Known accounts',pass:false,detail:'Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.'}],...unchanged};
      const checks=[
        {name:'Sender balance',pass:balances[step.from]>=amount,detail:balances[step.from]>=amount?`The modeled sender holds ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs.`:`The modeled sender holds only ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs — earlier steps in the timeline count, including supply changes.`},
        {name:'Transfer access',pass:!design.allowlist||to.allowed,detail:design.allowlist?'Recipient must be on the modeled allowlist.':'Open access is enabled.'},
        {name:'Transfer limit',pass:!design.limitEnabled||amount<=toUnits(design.limit,design.decimals),detail:design.limitEnabled?`Up to ${design.limit} ${design.ticker} per modeled transfer — the cap is per transfer, not cumulative.`:'No per-transfer cap is modeled.'},
        {name:'Issuer controls',pass:!design.pausable||(!design.paused&&!from.frozen&&!to.frozen),detail:design.pausable?(design.paused?'Issuer has paused all transfers.':from.frozen?'The sender is frozen.':to.frozen?'The recipient is frozen.':'Transfers are active and neither party is frozen.'):'Pause and freeze controls are disabled.'},
        {name:'Eligibility requirement',pass:!design.identity||to.credential,detail:design.identity?'Recipient must have modeled eligibility. This is not a verified credential or Midnight proof.':'No eligibility credential is required by this model.'},
      ];
      const allowed=checks.every(c=>c.pass);
      if(allowed) { balances[step.from]-=amount; balances[step.to]+=amount; }
      return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed,checks,...unchanged};
    }
    if(step.kind==='supply') {
      if(amountError) return {kind:'supply',action:step.action??null,actor:step.actor??null,amount:String(step.amount??''),amountBaseUnits:null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:amountError}],...unchanged};
      if(!['mint','burn'].includes(step.action)||!['issuer','other'].includes(step.actor)) return {kind:'supply',action:step.action??null,actor:step.actor??null,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed:false,checks:[{name:'Known supply change',pass:false,detail:'Each supply step must be a mint or a burn, attempted by the issuer or by someone else.'}],...unchanged};
      const mint=step.action==='mint';
      const after=mint?supplyBefore+amount:supplyBefore-amount;
      const checks=[
        {name:'Issuance authority',pass:step.actor==='issuer',detail:step.actor==='issuer'?'The modeled issuer holds this design\u2019s issuance authority.':'A non-issuer has no issuance authority in this generic model \u2014 supply changes are an issuer action here. A real token\u2019s issuance logic defines its own authority; this model does not read it.'},
      ];
      if(mint) checks.push({name:'Int64 ceiling headroom',pass:after<=MAX_ASSET,detail:after<=MAX_ASSET?`Minting would raise the modeled supply to ${formatUnits(after,design.decimals)} ${design.ticker} (${after.toString()} base units), within the ${MAX_ASSET.toString()} base-unit ceiling this studio models. Newly minted tokens enter at the issuer in this model.`:`Minting ${formatUnits(amount,design.decimals)} ${design.ticker} would raise the modeled supply to ${after.toString()} base units, past the ${MAX_ASSET.toString()} base-unit ceiling this studio models.`});
      else checks.push(
        {name:'Sufficient current supply',pass:amount<=supplyBefore,detail:amount<=supplyBefore?`The modeled supply at this step is ${formatUnits(supplyBefore,design.decimals)} ${design.ticker} — earlier steps in the timeline count.`:`Only ${formatUnits(supplyBefore,design.decimals)} ${design.ticker} exists in the modeled supply at this step — earlier steps in the timeline count. A burn cannot destroy more than was issued.`},
        {name:'Issuer balance',pass:balances.issuer>=amount,detail:balances.issuer>=amount?`The issuer holds ${formatUnits(balances.issuer,design.decimals)} ${design.ticker} in the modeled ledger when this step runs; a burn in this model draws on the issuer\u2019s own holding.`:`The issuer holds only ${formatUnits(balances.issuer,design.decimals)} ${design.ticker} in the modeled ledger when this step runs. Tokens already distributed to other modeled accounts are not the issuer\u2019s to burn in this model \u2014 the burn is blocked even though the total supply is ${formatUnits(supplyBefore,design.decimals)} ${design.ticker}.`},
      );
      const allowed=checks.every(c=>c.pass);
      if(allowed) { running=after; if(mint) balances.issuer+=amount; else balances.issuer-=amount; }
      return {kind:'supply',action:step.action,actor:step.actor,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed,checks,supplyBeforeBaseUnits:supplyBefore.toString(),supplyAfterBaseUnits:running.toString()};
    }
    return {kind:step.kind??null,amount:String(step.amount??''),amountBaseUnits:amountError?null:amount.toString(),allowed:false,checks:[{name:'Known timeline step',pass:false,detail:'Each timeline step must be a transfer between modeled accounts or a supply change (a mint or a burn).'}],...unchanged};
  });
  return finish(list);
}

// Editing model for the sequence lab's custom builder. The simulator above
// accepts any well-formed 1–12 step list; these helpers are how the studio
// edits one. Every helper is pure — it returns a new list of new step
// objects and never mutates its input — and validates account names against
// the modeled ledger, so a step the simulator would reject as an unknown
// account can never be constructed here. Amounts stay decimal strings: the
// simulator reports an unrepresentable amount as a blocked step, which is
// the builder's feedback, not an editing error.
export const MAX_SEQUENCE_STEPS = 12;

function checkedStep(step) {
  if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error('A transfer step must describe a sender, a recipient, and an amount.');
  if(!LEDGER_ACCOUNTS[step.from]||!LEDGER_ACCOUNTS[step.to]) throw new Error('Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.');
  if(typeof step.amount!=='string') throw new Error('A transfer amount must be a decimal string.');
  return {from:step.from,to:step.to,amount:step.amount};
}
function checkedSteps(steps) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_SEQUENCE_STEPS) throw new Error(`A transfer sequence needs between 1 and ${MAX_SEQUENCE_STEPS} modeled transfers.`);
  return steps.map(checkedStep);
}
function checkedIndex(steps, index) {
  if(!Number.isInteger(index)||index<0||index>=steps.length) throw new Error('Choose a step in the sequence.');
}
export function copySequenceSteps(steps) { return checkedSteps(steps); }
export function blankSequenceStep() { return {from:'issuer',to:'approved',amount:'100'}; }
export function addSequenceStep(steps, step = blankSequenceStep()) {
  const list = checkedSteps(steps);
  if(list.length>=MAX_SEQUENCE_STEPS) throw new Error(`A transfer sequence holds at most ${MAX_SEQUENCE_STEPS} modeled transfers.`);
  return [...list, checkedStep(step)];
}
export function removeSequenceStep(steps, index) {
  const list = checkedSteps(steps);
  checkedIndex(list, index);
  if(list.length<=1) throw new Error('A transfer sequence needs at least one modeled transfer.');
  return list.filter((_,i)=>i!==index);
}
export function moveSequenceStep(steps, index, direction) {
  const list = checkedSteps(steps);
  checkedIndex(list, index);
  if(direction!==-1&&direction!==1) throw new Error('Move a step one place up or down.');
  const target = index+direction;
  if(target<0||target>=list.length) return list; // Already at the edge: an unchanged copy.
  [list[index],list[target]] = [list[target],list[index]];
  return list;
}
export function updateSequenceStep(steps, index, patch) {
  const list = checkedSteps(steps);
  checkedIndex(list, index);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Describe the change to the step.');
  for(const k of Object.keys(patch)) if(!['from','to','amount'].includes(k)) throw new Error(`A transfer step has no ${k} field.`);
  list[index] = checkedStep({...list[index], ...patch});
  return list;
}

// Editing model for the supply sequence lab's custom builder — the same
// pure-helper discipline as the transfer builder above, for mint/burn steps.
// The simulator accepts any well-formed 1–12 step list; these helpers are how
// the studio edits one. Every helper returns a new list of new step objects
// and never mutates its input, and validates the action and actor against the
// generic issuance model, so a step the simulator would reject as an unknown
// supply change can never be constructed here. Amounts stay decimal strings:
// the simulator reports an unrepresentable amount as a blocked step, which is
// the builder's feedback, not an editing error.
export const MAX_SUPPLY_SEQUENCE_STEPS = 12;

function checkedSupplyStep(step) {
  if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error('A supply step must describe an action, an actor, and an amount.');
  if(!['mint','burn'].includes(step.action)) throw new Error('A supply step must be a mint or a burn.');
  if(!['issuer','other'].includes(step.actor)) throw new Error('A supply step must be attempted by the issuer or by someone else.');
  if(typeof step.amount!=='string') throw new Error('A supply amount must be a decimal string.');
  return {action:step.action,actor:step.actor,amount:step.amount};
}
function checkedSupplySteps(steps) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_SUPPLY_SEQUENCE_STEPS) throw new Error(`A supply sequence needs between 1 and ${MAX_SUPPLY_SEQUENCE_STEPS} modeled changes.`);
  return steps.map(checkedSupplyStep);
}
export function copySupplySteps(steps) { return checkedSupplySteps(steps); }
export function blankSupplyStep() { return {action:'mint',actor:'issuer',amount:'100'}; }
export function addSupplyStep(steps, step = blankSupplyStep()) {
  const list = checkedSupplySteps(steps);
  if(list.length>=MAX_SUPPLY_SEQUENCE_STEPS) throw new Error(`A supply sequence holds at most ${MAX_SUPPLY_SEQUENCE_STEPS} modeled changes.`);
  return [...list, checkedSupplyStep(step)];
}
export function removeSupplyStep(steps, index) {
  const list = checkedSupplySteps(steps);
  checkedIndex(list, index);
  if(list.length<=1) throw new Error('A supply sequence needs at least one modeled change.');
  return list.filter((_,i)=>i!==index);
}
export function moveSupplyStep(steps, index, direction) {
  const list = checkedSupplySteps(steps);
  checkedIndex(list, index);
  if(direction!==-1&&direction!==1) throw new Error('Move a step one place up or down.');
  const target = index+direction;
  if(target<0||target>=list.length) return list; // Already at the edge: an unchanged copy.
  [list[index],list[target]] = [list[target],list[index]];
  return list;
}
export function updateSupplyStep(steps, index, patch) {
  const list = checkedSupplySteps(steps);
  checkedIndex(list, index);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Describe the change to the step.');
  for(const k of Object.keys(patch)) if(!['action','actor','amount'].includes(k)) throw new Error(`A supply step has no ${k} field.`);
  list[index] = checkedSupplyStep({...list[index], ...patch});
  return list;
}

// Editing model for the timeline lab's custom builder — the same pure-helper
// discipline as the two builders above, for a list that mixes BOTH step
// kinds. Every helper returns a new list of new step objects and never
// mutates its input, and validates each step against the kind it carries,
// so a step the timeline simulator would reject as an unknown account or an
// unknown supply change can never be constructed here. The one thing a
// mixed list adds is a kind switch: changing a step's kind converts it,
// keeping its amount and filling the new kind's other fields with that
// kind's defaults (or with fields supplied in the same patch) — a transfer
// step carries no action/actor and a supply step carries no sender or
// recipient, so stale fields from the old kind never survive a switch.
// Amounts stay decimal strings: the simulator reports an unrepresentable
// amount as a blocked step, which is the builder's feedback, not an
// editing error.
function checkedTimelineStep(step) {
  if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error('A timeline step must describe a transfer or a supply change.');
  if(step.kind==='transfer') {
    if(!LEDGER_ACCOUNTS[step.from]||!LEDGER_ACCOUNTS[step.to]) throw new Error('Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.');
    if(typeof step.amount!=='string') throw new Error('A timeline step amount must be a decimal string.');
    return {kind:'transfer',from:step.from,to:step.to,amount:step.amount};
  }
  if(step.kind==='supply') {
    if(!['mint','burn'].includes(step.action)) throw new Error('A supply step must be a mint or a burn.');
    if(!['issuer','other'].includes(step.actor)) throw new Error('A supply step must be attempted by the issuer or by someone else.');
    if(typeof step.amount!=='string') throw new Error('A timeline step amount must be a decimal string.');
    return {kind:'supply',action:step.action,actor:step.actor,amount:step.amount};
  }
  throw new Error('A timeline step must be a transfer or a supply change.');
}
function checkedTimelineSteps(steps) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_TIMELINE_STEPS) throw new Error(`A timeline needs between 1 and ${MAX_TIMELINE_STEPS} modeled steps.`);
  return steps.map(checkedTimelineStep);
}
export function copyTimelineSteps(steps) { return checkedTimelineSteps(steps); }
export function blankTimelineStep(kind = 'transfer') {
  if(kind==='transfer') return {kind:'transfer',from:'issuer',to:'approved',amount:'100'};
  if(kind==='supply') return {kind:'supply',action:'mint',actor:'issuer',amount:'100'};
  throw new Error('A timeline step must be a transfer or a supply change.');
}
export function addTimelineStep(steps, step = blankTimelineStep()) {
  const list = checkedTimelineSteps(steps);
  if(list.length>=MAX_TIMELINE_STEPS) throw new Error(`A timeline holds at most ${MAX_TIMELINE_STEPS} modeled steps.`);
  return [...list, checkedTimelineStep(step)];
}
export function removeTimelineStep(steps, index) {
  const list = checkedTimelineSteps(steps);
  checkedIndex(list, index);
  if(list.length<=1) throw new Error('A timeline needs at least one modeled step.');
  return list.filter((_,i)=>i!==index);
}
export function moveTimelineStep(steps, index, direction) {
  const list = checkedTimelineSteps(steps);
  checkedIndex(list, index);
  if(direction!==-1&&direction!==1) throw new Error('Move a step one place up or down.');
  const target = index+direction;
  if(target<0||target>=list.length) return list; // Already at the edge: an unchanged copy.
  [list[index],list[target]] = [list[target],list[index]];
  return list;
}
export function updateTimelineStep(steps, index, patch) {
  const list = checkedTimelineSteps(steps);
  checkedIndex(list, index);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Describe the change to the step.');
  for(const k of Object.keys(patch)) if(!['kind','from','to','action','actor','amount'].includes(k)) throw new Error(`A timeline step has no ${k} field.`);
  const kind = patch.kind ?? list[index].kind;
  if(kind!=='transfer'&&kind!=='supply') throw new Error('A timeline step must be a transfer or a supply change.');
  const kindFields = kind==='transfer' ? ['from','to'] : ['action','actor'];
  for(const k of Object.keys(patch)) if(k!=='kind'&&k!=='amount'&&!kindFields.includes(k)) throw new Error(`A timeline step has no ${k} field.`);
  // Converting kinds: start from the new kind's blank step (which supplies
  // its defaults), keep the amount the step already had, then apply the
  // patch — fields the old kind carried never leak into the new shape.
  const base = kind===list[index].kind ? list[index] : {...blankTimelineStep(kind), amount:list[index].amount};
  list[index] = checkedTimelineStep({...base, ...patch});
  return list;
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

// Custom scenarios for the SINGLE-SHOT substandard labs. The presets
// each isolate one failure, so a builder cannot ask the question these
// labs exist for in combination: what happens when several things are
// wrong at once — an expired certificate AND a pause AND an unlisted
// recipient — and which checks fail together? The seizure presets have
// the same gap in miniature: three of the four authority/listing
// combinations, with the unauthorised actor facing a clean holder (both
// checks failing at once) missing. A custom scenario is one modeled
// state, not a sequence: each helper validates the scenario against
// EXACTLY the fields its module's simulator reads — every field present,
// boolean, and no others — and returns a new object, so a scenario the
// simulator would reject as malformed can never be constructed here,
// and a field belonging to another module (a recipient entry on basic
// KYC, which never checks recipients) is refused rather than silently
// ignored. Flags are booleans, not strings: an editor maps its choices
// to true/false before calling, and a string flag is refused.
const SUBSTANDARD_SCENARIO_FIELDS = Object.freeze({
  'freeze-seize': Object.freeze(['senderDenylisted', 'recipientDenylisted']),
  kyc: Object.freeze(['certPresent', 'certTrustedIssuer', 'certSignatureValid', 'certNamesSender', 'certExpired', 'paused']),
  'kyc-extended': Object.freeze(['certPresent', 'certTrustedIssuer', 'certSignatureValid', 'certNamesSender', 'certExpired', 'paused', 'recipientAllowlisted', 'recipientEntryExpired', 'selfTransfer']),
});
const SEIZURE_SCENARIO_FIELDS = Object.freeze(['actorAuthorised', 'holderDenylisted']);

export function substandardScenarioFields(substandard) {
  const fields = SUBSTANDARD_SCENARIO_FIELDS[substandard];
  if (!fields) throw new Error('Choose a modeled reference substandard (freeze-and-seize, KYC, or KYC extended). Generic PRISM rules are evaluated by the transfer simulator.');
  return fields;
}

function copyScenario(fields, scenario, label) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new Error(`Choose a ${label} scenario.`);
  for (const k of Object.keys(scenario)) if (!fields.includes(k)) throw new Error(`Scenario field ${k} is not part of the ${label} model.`);
  boolFields(scenario, fields);
  return Object.fromEntries(fields.map(f => [f, scenario[f]]));
}

export function copySubstandardScenario(substandard, scenario) {
  return copyScenario(substandardScenarioFields(substandard), scenario, substandard);
}

export function updateSubstandardScenario(substandard, scenario, field, value) {
  const fields = substandardScenarioFields(substandard);
  const copy = copySubstandardScenario(substandard, scenario);
  if (!fields.includes(field)) throw new Error(`Scenario field ${field} is not part of the ${substandard} model.`);
  if (typeof value !== 'boolean') throw new Error(`Scenario field ${field} must be true or false.`);
  return { ...copy, [field]: value };
}

export function copySeizureScenario(scenario) {
  return copyScenario(SEIZURE_SCENARIO_FIELDS, scenario, 'seizure');
}

export function updateSeizureScenario(scenario, field, value) {
  const copy = copySeizureScenario(scenario);
  if (!SEIZURE_SCENARIO_FIELDS.includes(field)) throw new Error(`Scenario field ${field} is not part of the seizure model.`);
  if (typeof value !== 'boolean') throw new Error(`Scenario field ${field} must be true or false.`);
  return { ...copy, [field]: value };
}

// A freeze-and-seize LIFECYCLE: transfers, denylist updates, and seizures
// in one order, against one running modeled state — a ledger of balances
// plus the denylist those balances are checked against. The single-shot
// models above hold the list fixed (a transfer is checked against a list
// that is simply given; a seizure against a holder who simply is or is
// not listed), so neither can show the lifecycle a regulated token
// actually lives: a holder in good standing receives tokens, is THEN
// denylisted — after which transfers fail in BOTH directions and seizure
// becomes permitted — and is later removed, which restores transfers and
// ends the seizure authority again. Denylist updates are modeled as
// applied state changes (in the reference module the on-chain list is
// maintained by its publisher; the update itself is not a transfer and
// is not gated by the transfer checks). A seizure that is permitted
// moves the amount from the holder to the issuer — tokens seized return
// to the issuer's modeled holding. A blocked step changes nothing and
// later steps are still evaluated, so the knock-on effect of a listing
// is visible. Only the freeze-and-seize module's own checks are modeled
// here (sender/recipient denylist, seizure authority and listing, plus
// the ledger's balances): the design's generic toggles (allowlist,
// per-transfer cap, pause, generic participant freeze) are a separate
// layer, modeled in the transfer labs, and are NOT applied. The modeled
// balances always sum to the designed supply. Local simulation only: no
// on-chain denylist is read, nothing is frozen or seized, and no
// transaction is produced.
export const MAX_DENYLIST_STEPS = 12;
export function simulateDenylistSequence(design, steps) {
  const errors=validateDesign(design);
  let supply=0n;
  try { supply=toUnits(design.supply,design.decimals); } catch { /* An invalid design reports its errors below; the ledger stays at zero. */ }
  const balances={};
  for(const k of Object.keys(LEDGER_ACCOUNTS)) balances[k]=k==='issuer'?supply:0n;
  const denylisted=new Set();
  const finish=evaluated=>({
    invalid:errors.length>0, errors,
    steps:evaluated,
    balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),
    denylisted:[...denylisted],
    transferredBaseUnits:evaluated.filter(s=>s.kind==='transfer'&&s.allowed).reduce((sum,s)=>sum+BigInt(s.amountBaseUnits),0n).toString(),
    seizedBaseUnits:evaluated.filter(s=>s.kind==='seize'&&s.allowed).reduce((sum,s)=>sum+BigInt(s.amountBaseUnits),0n).toString(),
    appliedCount:evaluated.filter(s=>s.allowed).length,
  });
  if(errors.length) return finish([]);
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_DENYLIST_STEPS) throw new Error(`A denylist lifecycle needs between 1 and ${MAX_DENYLIST_STEPS} modeled steps.`);
  const parseAmount=(raw,i)=>{
    try { const amount=toUnits(raw,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); return {amount,error:''}; }
    catch(e) { return {amount:null,error:e.message}; }
  };
  const evaluated=steps.map((step,i)=>{
    if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error(`Lifecycle step ${i+1} must describe a transfer, a denylist update, or a seizure.`);
    const snapshot=()=>({balancesAfter:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),denylistedAfter:[...denylisted]});
    if(step.kind==='denylist') {
      const account=LEDGER_ACCOUNTS[step.account];
      if(!account||typeof step.listed!=='boolean') return {kind:'denylist',account:step.account??null,listed:typeof step.listed==='boolean'?step.listed:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Known account and update',pass:false,detail:'A denylist update must name a modeled ledger account (the issuer, an approved member, a pending member, or a frozen member) and say whether it is being listed or removed.'}],...snapshot()};
      const already=denylisted.has(step.account)===step.listed;
      if(step.listed) denylisted.add(step.account); else denylisted.delete(step.account);
      return {kind:'denylist',account:step.account,listed:step.listed,amount:null,amountBaseUnits:null,allowed:true,checks:[{name:'Denylist update',pass:true,detail:already
        ?`${account.name} was already ${step.listed?'on':'off'} the modeled denylist — the update leaves the list as it stands, and later steps are checked against it.`
        :`${account.name} is ${step.listed?'added to':'removed from'} the modeled denylist. In the reference module the on-chain list is maintained by its publisher; PRISM models the update as a state change, and every later step is checked against the list as it now stands.`}],...snapshot()};
    }
    if(step.kind==='transfer') {
      const {amount,error}=parseAmount(step.amount,i);
      if(error) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount??''),amountBaseUnits:null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:error}],...snapshot()};
      const from=LEDGER_ACCOUNTS[step.from], to=LEDGER_ACCOUNTS[step.to];
      if(!from||!to) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed:false,checks:[{name:'Known accounts',pass:false,detail:'Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.'}],...snapshot()};
      const checks=[
        {name:'Sender balance',pass:balances[step.from]>=amount,detail:balances[step.from]>=amount?`The modeled sender holds ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs.`:`The modeled sender holds only ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs — earlier steps in the lifecycle count.`},
        {name:'Sender not denylisted',pass:!denylisted.has(step.from),detail:denylisted.has(step.from)?'The sender credential appears in the modeled denylist as it stands at this step. The reference validator rejects the transfer.':'Sender credential is absent from the modeled denylist at this step.'},
        {name:'Recipient not denylisted',pass:!denylisted.has(step.to),detail:denylisted.has(step.to)?'The recipient credential appears in the modeled denylist as it stands at this step. Freeze-and-seize checks both parties, not just the sender.':'Recipient credential is absent from the modeled denylist at this step.'},
      ];
      const allowed=checks.every(c=>c.pass);
      if(allowed) { balances[step.from]-=amount; balances[step.to]+=amount; }
      return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed,checks,...snapshot()};
    }
    if(step.kind==='seize') {
      const {amount,error}=parseAmount(step.amount,i);
      if(error) return {kind:'seize',actor:step.actor??null,holder:step.holder??null,amount:String(step.amount??''),amountBaseUnits:null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:error}],...snapshot()};
      const holder=LEDGER_ACCOUNTS[step.holder];
      if(!holder||!['authorised','other'].includes(step.actor)) return {kind:'seize',actor:step.actor??null,holder:step.holder??null,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed:false,checks:[{name:'Known holder and actor',pass:false,detail:'A seizure must name a modeled ledger account as its holder, attempted by an authorised party or by someone else.'}],...snapshot()};
      const checks=[
        {name:'Authorised issuer action',pass:step.actor==='authorised',detail:step.actor==='authorised'?'The actor is a modeled authorised party for this token.':'Only authorised parties may invoke freeze or seizure in the reference module; it is a third-party action, not a holder action.'},
        {name:'Holder is denylisted',pass:denylisted.has(step.holder),detail:denylisted.has(step.holder)?'The holder credential is on the modeled denylist as it stands at this step, so its tokens may be frozen or seized.':'Freeze and seizure apply only to denylisted credentials; a holder in good standing cannot be seized — including a holder who was listed earlier but has since been removed.'},
        {name:'Holder balance',pass:balances[step.holder]>=amount,detail:balances[step.holder]>=amount?`The modeled holder holds ${formatUnits(balances[step.holder],design.decimals)} ${design.ticker} when this step runs.`:`The modeled holder holds only ${formatUnits(balances[step.holder],design.decimals)} ${design.ticker} when this step runs — a seizure cannot take more than the holder holds.`},
      ];
      const allowed=checks.every(c=>c.pass);
      if(allowed) { balances[step.holder]-=amount; balances.issuer+=amount; }
      return {kind:'seize',actor:step.actor,holder:step.holder,amount:String(step.amount),amountBaseUnits:amount.toString(),allowed,checks,...snapshot()};
    }
    return {kind:typeof step.kind==='string'?step.kind:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Known step kind',pass:false,detail:'Each lifecycle step must be a transfer, a denylist update, or a seizure.'}],...snapshot()};
  });
  return finish(evaluated);
}

// Editing model for the denylist lifecycle lab's custom builder — the same
// pure-helper discipline as the timeline builder above, for a list that
// mixes THREE step kinds. Every helper returns a new list of new step
// objects and never mutates its input, and validates each step against the
// kind it carries, so a step the lifecycle simulator would report as a
// blocked unknown can never be constructed here. The one thing a mixed
// list adds is a kind switch: changing a step's kind converts it, keeping
// its amount where both kinds carry one (transfer ↔ seizure) and filling
// the new kind's other fields with that kind's defaults (or with fields
// supplied in the same patch) — a denylist step carries no amount, so
// converting TO one drops the amount, and converting FROM one starts the
// new kind at the default amount unless the patch supplies one; stale
// fields from the old kind never survive a switch. A denylist step's
// listed flag is a boolean, not a string: the editor's two choices map to
// true/false before they reach this helper. Amounts stay decimal strings:
// the simulator reports an unrepresentable amount as a blocked step, which
// is the builder's feedback, not an editing error.
function checkedDenylistStep(step) {
  if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error('A lifecycle step must describe a transfer, a denylist update, or a seizure.');
  if(step.kind==='transfer') {
    if(!LEDGER_ACCOUNTS[step.from]||!LEDGER_ACCOUNTS[step.to]) throw new Error('Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.');
    if(typeof step.amount!=='string') throw new Error('A lifecycle step amount must be a decimal string.');
    return {kind:'transfer',from:step.from,to:step.to,amount:step.amount};
  }
  if(step.kind==='denylist') {
    if(!LEDGER_ACCOUNTS[step.account]) throw new Error('A denylist update must name a modeled ledger account: the issuer, an approved member, a pending member, or a frozen member.');
    if(typeof step.listed!=='boolean') throw new Error('A denylist update must say whether the account is listed or removed.');
    return {kind:'denylist',account:step.account,listed:step.listed};
  }
  if(step.kind==='seize') {
    if(!['authorised','other'].includes(step.actor)) throw new Error('A seizure must be attempted by an authorised party or by someone else.');
    if(!LEDGER_ACCOUNTS[step.holder]) throw new Error('A seizure must name a modeled ledger account as its holder.');
    if(typeof step.amount!=='string') throw new Error('A lifecycle step amount must be a decimal string.');
    return {kind:'seize',actor:step.actor,holder:step.holder,amount:step.amount};
  }
  throw new Error('A lifecycle step must be a transfer, a denylist update, or a seizure.');
}
function checkedDenylistSteps(steps) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_DENYLIST_STEPS) throw new Error(`A denylist lifecycle needs between 1 and ${MAX_DENYLIST_STEPS} modeled steps.`);
  return steps.map(checkedDenylistStep);
}
export function copyDenylistSteps(steps) { return checkedDenylistSteps(steps); }
export function blankDenylistStep(kind = 'transfer') {
  if(kind==='transfer') return {kind:'transfer',from:'issuer',to:'approved',amount:'100'};
  if(kind==='denylist') return {kind:'denylist',account:'approved',listed:true};
  if(kind==='seize') return {kind:'seize',actor:'authorised',holder:'approved',amount:'100'};
  throw new Error('A lifecycle step must be a transfer, a denylist update, or a seizure.');
}
export function addDenylistStep(steps, step = blankDenylistStep()) {
  const list = checkedDenylistSteps(steps);
  if(list.length>=MAX_DENYLIST_STEPS) throw new Error(`A denylist lifecycle holds at most ${MAX_DENYLIST_STEPS} modeled steps.`);
  return [...list, checkedDenylistStep(step)];
}
export function removeDenylistStep(steps, index) {
  const list = checkedDenylistSteps(steps);
  checkedIndex(list, index);
  if(list.length<=1) throw new Error('A denylist lifecycle needs at least one modeled step.');
  return list.filter((_,i)=>i!==index);
}
export function moveDenylistStep(steps, index, direction) {
  const list = checkedDenylistSteps(steps);
  checkedIndex(list, index);
  if(direction!==-1&&direction!==1) throw new Error('Move a step one place up or down.');
  const target = index+direction;
  if(target<0||target>=list.length) return list; // Already at the edge: an unchanged copy.
  [list[index],list[target]] = [list[target],list[index]];
  return list;
}
export function updateDenylistStep(steps, index, patch) {
  const list = checkedDenylistSteps(steps);
  checkedIndex(list, index);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Describe the change to the step.');
  for(const k of Object.keys(patch)) if(!['kind','from','to','account','listed','actor','holder','amount'].includes(k)) throw new Error(`A lifecycle step has no ${k} field.`);
  const kind = patch.kind ?? list[index].kind;
  if(kind!=='transfer'&&kind!=='denylist'&&kind!=='seize') throw new Error('A lifecycle step must be a transfer, a denylist update, or a seizure.');
  const kindFields = kind==='transfer' ? ['from','to','amount'] : kind==='denylist' ? ['account','listed'] : ['actor','holder','amount'];
  for(const k of Object.keys(patch)) if(k!=='kind'&&!kindFields.includes(k)) throw new Error(`A lifecycle step has no ${k} field.`);
  // Converting kinds: start from the new kind's blank step (which supplies
  // its defaults), keep the amount the step already had when both kinds
  // carry one, then apply the patch — fields the old kind carried never
  // leak into the new shape.
  const base = kind===list[index].kind ? list[index] : {...blankDenylistStep(kind), ...(typeof list[index].amount==='string'&&kind!=='denylist' ? {amount:list[index].amount} : {})};
  list[index] = checkedDenylistStep({...base, ...patch});
  return list;
}

// A KYC-extended LIFECYCLE: transfers in one order against one running
// modeled state — a ledger of balances, the issuer's recipient allowlist
// (each entry current or expired), and the module's global pause flag.
// The single-shot model above holds all of that fixed (a transfer is
// checked against an allowlist entry and a pause flag that are simply
// given), so it cannot show the lifecycle a KYC-extended token actually
// lives: a recipient is listed and receives tokens, their entry's TTL
// then elapses — after which the SAME transfer with the SAME valid
// certificate fails on the recipient entry alone — and a renewal makes
// it pass again; a sender's certificate can expire between two
// transfers; and a pause set mid-sequence blocks every transfer until
// it is cleared, whatever their certificates say. Each transfer step
// carries a modeled certificate state (valid, missing, untrusted,
// invalid signature, naming another sender, or expired) — certificates
// are per-transfer in the reference module, so the state travels with
// the step rather than with the account — and the transfer is evaluated
// by the very same simulateSubstandardTransfer checks as the single-shot
// lab, fed with the allowlist entry and pause flag AS THEY STAND at
// that step, so the two labs can never disagree about a check's name or
// verdict. Allowlist and pause updates are modeled as applied state
// changes (in the reference module the allowlist is maintained by its
// publisher and expired entries are pruned; entry expiry is the passage
// of its validity window, modeled here as the step that records it).
// Only the KYC-extended module's own checks are modeled here: the
// design's generic toggles (its own allowlist, per-transfer cap,
// generic pause/freeze, eligibility) are a separate layer, modeled in
// the labs above, and are NOT applied — the module pause in this lab
// starts unset whatever the design's generic pause flag says. The
// modeled balances always sum to the designed supply. Local simulation
// only: no real certificate is read or verified, no signature is
// checked, no on-chain allowlist is consulted, and no transaction is
// produced.
export const MAX_KYC_STEPS = 12;
const KYC_CERT_STATES = Object.freeze({
  valid:{certPresent:true,certTrustedIssuer:true,certSignatureValid:true,certNamesSender:true,certExpired:false},
  missing:{certPresent:false,certTrustedIssuer:false,certSignatureValid:false,certNamesSender:false,certExpired:false},
  untrusted:{certPresent:true,certTrustedIssuer:false,certSignatureValid:true,certNamesSender:true,certExpired:false},
  'bad-signature':{certPresent:true,certTrustedIssuer:true,certSignatureValid:false,certNamesSender:true,certExpired:false},
  'wrong-sender':{certPresent:true,certTrustedIssuer:true,certSignatureValid:true,certNamesSender:false,certExpired:false},
  expired:{certPresent:true,certTrustedIssuer:true,certSignatureValid:true,certNamesSender:true,certExpired:true},
});
export function simulateKycSequence(design, steps) {
  const errors=validateDesign(design);
  let supply=0n;
  try { supply=toUnits(design.supply,design.decimals); } catch { /* An invalid design reports its errors below; the ledger stays at zero. */ }
  const balances={};
  for(const k of Object.keys(LEDGER_ACCOUNTS)) balances[k]=k==='issuer'?supply:0n;
  const allowlist={};
  let paused=false;
  const finish=evaluated=>({
    invalid:errors.length>0, errors,
    steps:evaluated,
    balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),
    allowlist:Object.fromEntries(Object.entries(allowlist).map(([k,v])=>[k,{...v}])),
    paused,
    transferredBaseUnits:evaluated.filter(s=>s.kind==='transfer'&&s.allowed).reduce((sum,s)=>sum+BigInt(s.amountBaseUnits),0n).toString(),
    appliedCount:evaluated.filter(s=>s.allowed).length,
  });
  if(errors.length) return finish([]);
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_KYC_STEPS) throw new Error(`A KYC lifecycle needs between 1 and ${MAX_KYC_STEPS} modeled steps.`);
  const parseAmount=(raw)=>{
    try { const amount=toUnits(raw,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); return {amount,error:''}; }
    catch(e) { return {amount:null,error:e.message}; }
  };
  const evaluated=steps.map((step,i)=>{
    if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error(`Lifecycle step ${i+1} must describe a transfer, an allowlist update, or a pause update.`);
    const snapshot=()=>({balancesAfter:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),allowlistAfter:Object.fromEntries(Object.entries(allowlist).map(([k,v])=>[k,{...v}])),pausedAfter:paused});
    if(step.kind==='allowlist') {
      const account=LEDGER_ACCOUNTS[step.account];
      if(!account||typeof step.listed!=='boolean'||(step.expired!==undefined&&typeof step.expired!=='boolean')) return {kind:'allowlist',account:step.account??null,listed:typeof step.listed==='boolean'?step.listed:null,expired:typeof step.expired==='boolean'?step.expired:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Known account and update',pass:false,detail:'An allowlist update must name a modeled ledger account (the issuer, an approved member, a pending member, or a frozen member), say whether it is being listed or removed, and — when listed — whether its entry is current or expired.'}],...snapshot()};
      const before=allowlist[step.account];
      if(step.listed) {
        const expired=step.expired===true;
        const already=!!before&&before.expired===expired;
        allowlist[step.account]={expired};
        return {kind:'allowlist',account:step.account,listed:true,expired,amount:null,amountBaseUnits:null,allowed:true,checks:[{name:'Allowlist update',pass:true,detail:already
          ?`${account.name} was already on the modeled allowlist with a ${expired?'expired':'current'} entry — the update leaves the entry as it stands, and later steps are checked against it.`
          :before
            ?(expired?`${account.name}'s allowlist entry's validity window (TTL) has elapsed. The entry is still on the modeled list, but the reference validator treats an expired entry as failing the recipient check until the publisher renews or prunes it.`:`${account.name}'s allowlist entry is renewed — its validity window runs again, and later transfers to this recipient are checked against a current entry.`)
            :`${account.name} is added to the modeled allowlist with a ${expired?'already-expired':'current'} entry. In the reference module the on-chain list is anchored by a Merkle Patricia Forestry root maintained by its publisher; PRISM models the update as a state change, and every later step is checked against the list as it now stands.`}],...snapshot()};
      }
      const already=!before;
      delete allowlist[step.account];
      return {kind:'allowlist',account:step.account,listed:false,expired:null,amount:null,amountBaseUnits:null,allowed:true,checks:[{name:'Allowlist update',pass:true,detail:already
        ?`${account.name} was not on the modeled allowlist — the removal leaves the list as it stands, and later steps are checked against it.`
        :`${account.name} is removed from the modeled allowlist. Expired members are pruned by the issuer's publisher in the reference module; a removed recipient fails the recipient check on later transfers.`}],...snapshot()};
    }
    if(step.kind==='pause') {
      if(typeof step.paused!=='boolean') return {kind:'pause',paused:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Pause update',pass:false,detail:'A pause update must say whether the module global state is being paused or unpaused (true or false).'}],...snapshot()};
      const already=paused===step.paused;
      paused=step.paused;
      return {kind:'pause',paused:step.paused,amount:null,amountBaseUnits:null,allowed:true,checks:[{name:'Pause update',pass:true,detail:already
        ?`Transfers were already ${step.paused?'paused':'unpaused'} in the modeled global state — the update leaves it as it stands, and later steps are checked against it.`
        :step.paused?'The issuer pause flag in the modeled global state is set. Every later transfer fails while it is set, whatever its certificate or recipient entry says, until the flag is cleared.':'The issuer pause flag in the modeled global state is cleared. Later transfers are checked on their certificate and recipient entry again.'}],...snapshot()};
    }
    if(step.kind==='transfer') {
      const {amount,error}=parseAmount(step.amount);
      if(error) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount??''),amountBaseUnits:null,cert:step.cert??null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:error}],...snapshot()};
      const from=LEDGER_ACCOUNTS[step.from], to=LEDGER_ACCOUNTS[step.to];
      if(!from||!to) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert??null,allowed:false,checks:[{name:'Known accounts',pass:false,detail:'Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.'}],...snapshot()};
      const cert=KYC_CERT_STATES[step.cert];
      if(!cert) return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert??null,allowed:false,checks:[{name:'Known certificate state',pass:false,detail:'A transfer step must name the modeled certificate it carries: valid, missing, untrusted, bad-signature, wrong-sender, or expired. Certificates are modeled states here — no real certificate is read or verified.'}],...snapshot()};
      const entry=allowlist[step.to];
      const module=simulateSubstandardTransfer('kyc-extended',{...cert,paused,recipientAllowlisted:!!entry,recipientEntryExpired:entry?entry.expired:false,selfTransfer:step.from===step.to});
      const checks=[
        {name:'Sender balance',pass:balances[step.from]>=amount,detail:balances[step.from]>=amount?`The modeled sender holds ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs.`:`The modeled sender holds only ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs — earlier steps in the lifecycle count.`},
        ...module.checks,
      ];
      const allowed=checks.every(c=>c.pass);
      if(allowed) { balances[step.from]-=amount; balances[step.to]+=amount; }
      return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert,allowed,checks,...snapshot()};
    }
    return {kind:typeof step.kind==='string'?step.kind:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Known step kind',pass:false,detail:'Each lifecycle step must be a transfer, an allowlist update, or a pause update.'}],...snapshot()};
  });
  return finish(evaluated);
}

// Editing model for the KYC-extended lifecycle lab's custom builder —
// the same pure-helper discipline as the denylist builder above, for a
// list that mixes THREE step kinds. Every helper returns a new list of
// new step objects and never mutates its input, and validates each step
// against the kind it carries, so a step the lifecycle simulator would
// report as a blocked unknown can never be constructed here. A kind
// switch converts the step: only a transfer carries an amount (and a
// certificate state), so converting TO a transfer starts it at the
// default amount with a valid certificate, and converting FROM one
// drops both — stale fields from the old kind never survive a switch.
// An allowlist step's entry state is conditional in the same way: a
// listed entry carries whether it is current or expired (an entry
// listed without saying is current), while a removal carries no entry
// state at all, so the expired flag is dropped when a step stops
// listing its account and defaulted to current when it starts. The
// listed, expired, and paused flags are booleans, not strings: the
// editor's choices map to true/false before they reach this helper.
// Amounts stay decimal strings: the simulator reports an
// unrepresentable amount as a blocked step, which is the builder's
// feedback, not an editing error.
function checkedKycStep(step) {
  if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error('A lifecycle step must describe a transfer, an allowlist update, or a pause update.');
  if(step.kind==='transfer') {
    if(!LEDGER_ACCOUNTS[step.from]||!LEDGER_ACCOUNTS[step.to]) throw new Error('Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.');
    if(typeof step.amount!=='string') throw new Error('A lifecycle step amount must be a decimal string.');
    if(!KYC_CERT_STATES[step.cert]) throw new Error('A transfer step must name the modeled certificate it carries: valid, missing, untrusted, bad-signature, wrong-sender, or expired.');
    return {kind:'transfer',from:step.from,to:step.to,amount:step.amount,cert:step.cert};
  }
  if(step.kind==='allowlist') {
    if(!LEDGER_ACCOUNTS[step.account]) throw new Error('An allowlist update must name a modeled ledger account: the issuer, an approved member, a pending member, or a frozen member.');
    if(typeof step.listed!=='boolean') throw new Error('An allowlist update must say whether the account is listed or removed.');
    if(!step.listed) return {kind:'allowlist',account:step.account,listed:false};
    if(step.expired!==undefined&&typeof step.expired!=='boolean') throw new Error('A listed entry must say whether it is current or expired.');
    return {kind:'allowlist',account:step.account,listed:true,expired:step.expired===true};
  }
  if(step.kind==='pause') {
    if(typeof step.paused!=='boolean') throw new Error('A pause update must say whether the module global state is being paused or unpaused.');
    return {kind:'pause',paused:step.paused};
  }
  throw new Error('A lifecycle step must be a transfer, an allowlist update, or a pause update.');
}
function checkedKycSteps(steps) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_KYC_STEPS) throw new Error(`A KYC lifecycle needs between 1 and ${MAX_KYC_STEPS} modeled steps.`);
  return steps.map(checkedKycStep);
}
export function copyKycSteps(steps) { return checkedKycSteps(steps); }
export function blankKycStep(kind = 'transfer') {
  if(kind==='transfer') return {kind:'transfer',from:'issuer',to:'approved',amount:'100',cert:'valid'};
  if(kind==='allowlist') return {kind:'allowlist',account:'approved',listed:true,expired:false};
  if(kind==='pause') return {kind:'pause',paused:true};
  throw new Error('A lifecycle step must be a transfer, an allowlist update, or a pause update.');
}
export function addKycStep(steps, step = blankKycStep()) {
  const list = checkedKycSteps(steps);
  if(list.length>=MAX_KYC_STEPS) throw new Error(`A KYC lifecycle holds at most ${MAX_KYC_STEPS} modeled steps.`);
  return [...list, checkedKycStep(step)];
}
export function removeKycStep(steps, index) {
  const list = checkedKycSteps(steps);
  checkedIndex(list, index);
  if(list.length<=1) throw new Error('A KYC lifecycle needs at least one modeled step.');
  return list.filter((_,i)=>i!==index);
}
export function moveKycStep(steps, index, direction) {
  const list = checkedKycSteps(steps);
  checkedIndex(list, index);
  if(direction!==-1&&direction!==1) throw new Error('Move a step one place up or down.');
  const target = index+direction;
  if(target<0||target>=list.length) return list; // Already at the edge: an unchanged copy.
  [list[index],list[target]] = [list[target],list[index]];
  return list;
}
export function updateKycStep(steps, index, patch) {
  const list = checkedKycSteps(steps);
  checkedIndex(list, index);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Describe the change to the step.');
  for(const k of Object.keys(patch)) if(!['kind','from','to','amount','cert','account','listed','expired','paused'].includes(k)) throw new Error(`A lifecycle step has no ${k} field.`);
  const kind = patch.kind ?? list[index].kind;
  if(kind!=='transfer'&&kind!=='allowlist'&&kind!=='pause') throw new Error('A lifecycle step must be a transfer, an allowlist update, or a pause update.');
  const kindFields = kind==='transfer' ? ['from','to','amount','cert'] : kind==='allowlist' ? ['account','listed','expired'] : ['paused'];
  for(const k of Object.keys(patch)) if(k!=='kind'&&!kindFields.includes(k)) throw new Error(`A lifecycle step has no ${k} field.`);
  // Converting kinds: start from the new kind's blank step (which
  // supplies its defaults) and apply the patch — no kind but a transfer
  // carries an amount or a certificate, so nothing is kept across a
  // switch, and fields the old kind carried never leak into the new
  // shape. Within a kind, the checked step drops whatever the new
  // shape does not carry (a removal's expired flag, above all).
  const base = kind===list[index].kind ? list[index] : blankKycStep(kind);
  list[index] = checkedKycStep({...base, ...patch});
  return list;
}

// A BASIC-KYC LIFECYCLE: transfers in one order against one running
// modeled state — a ledger of balances, the issuer's trusted-entity
// list, and the module's global pause flag. The single-shot model and
// the KYC-extended lifecycle hold the trust decision fixed (a
// certificate simply is or is not from a trusted entity), so neither
// can show the lifecycle a basic-KYC token actually lives: a KYC
// entity the issuer trusted is REMOVED from the trusted list — after
// which the same sender's otherwise-valid certificate fails on the
// trusted-entity check alone, because trust is read from the list as
// it stands when the transfer runs, not from when the certificate was
// issued — a second entity is ADDED and its certificates start
// passing, and revoking the first entity does not touch the second's.
// Removal is not retroactive: transfers that already applied stay
// applied. Each transfer carries a modeled certificate state (valid,
// missing, invalid signature, naming another sender, or expired —
// there is deliberately no 'untrusted' state here: whether the
// signer is trusted is exactly the evolving state this lab models)
// and names the modeled entity that signed it; the transfer is then
// evaluated by the very same simulateSubstandardTransfer('kyc')
// checks as the single-shot lab, fed with the signer's trust and the
// pause flag AS THEY STAND at that step, so the two labs can never
// disagree about a check's name or verdict. Basic KYC checks the
// SENDER only: no recipient check exists in this module, so a
// transfer to any modeled recipient — listed nowhere, pending, or
// frozen in the generic layer — passes on its sender certificate
// alone, and a self-transfer still needs a valid certificate (there
// is no recipient check to skip). Only the basic-KYC module's own
// checks are modeled here: the design's generic toggles (its own
// allowlist, per-transfer cap, generic pause/freeze, eligibility)
// are a separate layer, modeled in the labs above, and are NOT
// applied — the module pause in this lab starts unset whatever the
// design's generic pause flag says. The modeled balances always sum
// to the designed supply. Local simulation only: no real certificate
// is read or verified, no signature is checked, no trusted-entity
// list is consulted on chain, and no transaction is produced.
export const MAX_BASIC_KYC_STEPS = 12;
export const KYC_ENTITIES = Object.freeze({
  'entity-a':{ name:'KYC entity A' },
  'entity-b':{ name:'KYC entity B' },
});
const BASIC_KYC_CERT_STATES = Object.freeze({
  valid:{certPresent:true,certSignatureValid:true,certNamesSender:true,certExpired:false},
  missing:{certPresent:false,certSignatureValid:false,certNamesSender:false,certExpired:false},
  'bad-signature':{certPresent:true,certSignatureValid:false,certNamesSender:true,certExpired:false},
  'wrong-sender':{certPresent:true,certSignatureValid:true,certNamesSender:false,certExpired:false},
  expired:{certPresent:true,certSignatureValid:true,certNamesSender:true,certExpired:true},
});
export function simulateBasicKycSequence(design, steps) {
  const errors=validateDesign(design);
  let supply=0n;
  try { supply=toUnits(design.supply,design.decimals); } catch { /* An invalid design reports its errors below; the ledger stays at zero. */ }
  const balances={};
  for(const k of Object.keys(LEDGER_ACCOUNTS)) balances[k]=k==='issuer'?supply:0n;
  const trusted=new Set(['entity-a']);
  let paused=false;
  const finish=evaluated=>({
    invalid:errors.length>0, errors,
    steps:evaluated,
    balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),
    trusted:[...trusted],
    paused,
    transferredBaseUnits:evaluated.filter(s=>s.kind==='transfer'&&s.allowed).reduce((sum,s)=>sum+BigInt(s.amountBaseUnits),0n).toString(),
    appliedCount:evaluated.filter(s=>s.allowed).length,
  });
  if(errors.length) return finish([]);
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_BASIC_KYC_STEPS) throw new Error(`A basic-KYC lifecycle needs between 1 and ${MAX_BASIC_KYC_STEPS} modeled steps.`);
  const parseAmount=(raw)=>{
    try { const amount=toUnits(raw,design.decimals); if(amount<=0n) throw new Error('Amount must be greater than zero.'); return {amount,error:''}; }
    catch(e) { return {amount:null,error:e.message}; }
  };
  const evaluated=steps.map((step,i)=>{
    if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error(`Lifecycle step ${i+1} must describe a transfer, a trust update, or a pause update.`);
    const snapshot=()=>({balancesAfter:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toString()])),trustedAfter:[...trusted],pausedAfter:paused});
    if(step.kind==='trust') {
      const entity=KYC_ENTITIES[step.entity];
      if(!entity||typeof step.trusted!=='boolean') return {kind:'trust',entity:step.entity??null,trusted:typeof step.trusted==='boolean'?step.trusted:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Known entity and update',pass:false,detail:'A trust update must name a modeled KYC entity (KYC entity A or KYC entity B) and say whether it is being trusted or removed from the trusted list.'}],...snapshot()};
      const already=trusted.has(step.entity)===step.trusted;
      if(step.trusted) trusted.add(step.entity); else trusted.delete(step.entity);
      return {kind:'trust',entity:step.entity,trusted:step.trusted,amount:null,amountBaseUnits:null,allowed:true,checks:[{name:'Trust update',pass:true,detail:already
        ?`${entity.name} was already ${step.trusted?'on':'off'} the modeled trusted-entity list — the update leaves the list as it stands, and later steps are checked against it.`
        :step.trusted?`${entity.name} is added to the modeled trusted-entity list. Certificates it signed are checked against the list as it now stands, so its later certificates can pass the trusted-entity check.`:`${entity.name} is removed from the modeled trusted-entity list. Removal is not retroactive — transfers that already applied stay applied — but its later certificates fail the trusted-entity check, however valid they otherwise are.`}],...snapshot()};
    }
    if(step.kind==='pause') {
      if(typeof step.paused!=='boolean') return {kind:'pause',paused:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Pause update',pass:false,detail:'A pause update must say whether the module global state is being paused or unpaused (true or false).'}],...snapshot()};
      const already=paused===step.paused;
      paused=step.paused;
      return {kind:'pause',paused:step.paused,amount:null,amountBaseUnits:null,allowed:true,checks:[{name:'Pause update',pass:true,detail:already
        ?`Transfers were already ${step.paused?'paused':'unpaused'} in the modeled global state — the update leaves it as it stands, and later steps are checked against it.`
        :step.paused?'The issuer pause flag in the modeled global state is set. Every later transfer fails while it is set, whatever its certificate or signer says, until the flag is cleared.':'The issuer pause flag in the modeled global state is cleared. Later transfers are checked on their certificate and signer again.'}],...snapshot()};
    }
    if(step.kind==='transfer') {
      const {amount,error}=parseAmount(step.amount);
      if(error) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount??''),amountBaseUnits:null,cert:step.cert??null,entity:step.entity??null,allowed:false,checks:[{name:'Valid amount',pass:false,detail:error}],...snapshot()};
      const from=LEDGER_ACCOUNTS[step.from], to=LEDGER_ACCOUNTS[step.to];
      if(!from||!to) return {kind:'transfer',from:step.from??null,to:step.to??null,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert??null,entity:step.entity??null,allowed:false,checks:[{name:'Known accounts',pass:false,detail:'Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.'}],...snapshot()};
      const cert=BASIC_KYC_CERT_STATES[step.cert];
      if(!cert) return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert??null,entity:step.entity??null,allowed:false,checks:[{name:'Known certificate state',pass:false,detail:'A transfer step must name the modeled certificate it carries: valid, missing, bad-signature, wrong-sender, or expired. There is no untrusted state here — whether the signer is trusted is read from the modeled trusted-entity list as it stands at this step. Certificates are modeled states here — no real certificate is read or verified.'}],...snapshot()};
      const entity=KYC_ENTITIES[step.entity];
      if(!entity) return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert,entity:step.entity??null,allowed:false,checks:[{name:'Known certificate signer',pass:false,detail:'A transfer step must name the modeled KYC entity that signed its certificate: KYC entity A or KYC entity B. The trusted-entity check reads that signer against the modeled trusted list.'}],...snapshot()};
      const module=simulateSubstandardTransfer('kyc',{...cert,certTrustedIssuer:trusted.has(step.entity),paused});
      const checks=[
        {name:'Sender balance',pass:balances[step.from]>=amount,detail:balances[step.from]>=amount?`The modeled sender holds ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs.`:`The modeled sender holds only ${formatUnits(balances[step.from],design.decimals)} ${design.ticker} when this step runs — earlier steps in the lifecycle count.`},
        ...module.checks,
      ];
      const allowed=checks.every(c=>c.pass);
      if(allowed) { balances[step.from]-=amount; balances[step.to]+=amount; }
      return {kind:'transfer',from:step.from,to:step.to,amount:String(step.amount),amountBaseUnits:amount.toString(),cert:step.cert,entity:step.entity,allowed,checks,...snapshot()};
    }
    return {kind:typeof step.kind==='string'?step.kind:null,amount:null,amountBaseUnits:null,allowed:false,checks:[{name:'Known step kind',pass:false,detail:'Each lifecycle step must be a transfer, a trust update, or a pause update.'}],...snapshot()};
  });
  return finish(evaluated);
}

// Editing model for the basic-KYC lifecycle lab's custom builder — the
// same pure-helper discipline as the KYC-extended builder above, for a
// list that mixes THREE step kinds (transfer, trust update, pause
// update). Every helper returns a new list of new step objects and
// never mutates its input, and validates each step against the kind it
// carries, so a step the lifecycle simulator would report as a blocked
// unknown can never be constructed here — including a transfer whose
// certificate state is 'untrusted': this lab deliberately carries no
// such state (whether the signer is trusted is read from the evolving
// list), and the helper refuses it with that reason. A kind switch
// converts the step, defined per field: the modeled entity is the ONE
// field two kinds carry — a transfer names it as its certificate's
// signer and a trust update names it as its subject — so the entity is
// KEPT across a transfer ↔ trust switch (the same modeled entity in
// both roles), while everything else is dropped or defaulted: only a
// transfer carries an amount and a certificate state, only a trust
// update carries the trusted flag, and only a pause update carries the
// paused flag, so converting to or from a pause starts from that kind's
// defaults throughout, and stale fields never survive a switch. The
// trusted and paused flags are booleans, not strings: the editor's
// choices map to true/false before they reach this helper. Amounts stay
// decimal strings: the simulator reports an unrepresentable amount as a
// blocked step, which is the builder's feedback, not an editing error.
function checkedBasicKycStep(step) {
  if(!step||typeof step!=='object'||Array.isArray(step)) throw new Error('A basic-KYC lifecycle step must describe a transfer, a trust update, or a pause update.');
  if(step.kind==='transfer') {
    if(!LEDGER_ACCOUNTS[step.from]||!LEDGER_ACCOUNTS[step.to]) throw new Error('Sender and recipient must be modeled ledger accounts: the issuer, an approved member, a pending member, or a frozen member.');
    if(typeof step.amount!=='string') throw new Error('A lifecycle step amount must be a decimal string.');
    if(!BASIC_KYC_CERT_STATES[step.cert]) throw new Error('A transfer step must name the modeled certificate it carries: valid, missing, bad-signature, wrong-sender, or expired. There is no untrusted state here — whether the signer is trusted is read from the modeled trusted-entity list as it stands at that step.');
    if(!KYC_ENTITIES[step.entity]) throw new Error('A transfer step must name the modeled KYC entity that signed its certificate: KYC entity A or KYC entity B.');
    return {kind:'transfer',from:step.from,to:step.to,amount:step.amount,cert:step.cert,entity:step.entity};
  }
  if(step.kind==='trust') {
    if(!KYC_ENTITIES[step.entity]) throw new Error('A trust update must name a modeled KYC entity: KYC entity A or KYC entity B.');
    if(typeof step.trusted!=='boolean') throw new Error('A trust update must say whether the entity is being trusted or removed from the trusted list.');
    return {kind:'trust',entity:step.entity,trusted:step.trusted};
  }
  if(step.kind==='pause') {
    if(typeof step.paused!=='boolean') throw new Error('A pause update must say whether the module global state is being paused or unpaused.');
    return {kind:'pause',paused:step.paused};
  }
  throw new Error('A basic-KYC lifecycle step must describe a transfer, a trust update, or a pause update.');
}
function checkedBasicKycSteps(steps) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_BASIC_KYC_STEPS) throw new Error(`A basic-KYC lifecycle needs between 1 and ${MAX_BASIC_KYC_STEPS} modeled steps.`);
  return steps.map(checkedBasicKycStep);
}
export function copyBasicKycSteps(steps) { return checkedBasicKycSteps(steps); }
export function blankBasicKycStep(kind = 'transfer') {
  if(kind==='transfer') return {kind:'transfer',from:'issuer',to:'approved',amount:'100',cert:'valid',entity:'entity-a'};
  if(kind==='trust') return {kind:'trust',entity:'entity-a',trusted:true};
  if(kind==='pause') return {kind:'pause',paused:true};
  throw new Error('A basic-KYC lifecycle step must describe a transfer, a trust update, or a pause update.');
}
export function addBasicKycStep(steps, step = blankBasicKycStep()) {
  const list = checkedBasicKycSteps(steps);
  if(list.length>=MAX_BASIC_KYC_STEPS) throw new Error(`A basic-KYC lifecycle holds at most ${MAX_BASIC_KYC_STEPS} modeled steps.`);
  return [...list, checkedBasicKycStep(step)];
}
export function removeBasicKycStep(steps, index) {
  const list = checkedBasicKycSteps(steps);
  checkedIndex(list, index);
  if(list.length<=1) throw new Error('A basic-KYC lifecycle needs at least one modeled step.');
  return list.filter((_,i)=>i!==index);
}
export function moveBasicKycStep(steps, index, direction) {
  const list = checkedBasicKycSteps(steps);
  checkedIndex(list, index);
  if(direction!==-1&&direction!==1) throw new Error('Move a step one place up or down.');
  const target = index+direction;
  if(target<0||target>=list.length) return list; // Already at the edge: an unchanged copy.
  [list[index],list[target]] = [list[target],list[index]];
  return list;
}
export function updateBasicKycStep(steps, index, patch) {
  const list = checkedBasicKycSteps(steps);
  checkedIndex(list, index);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Describe the change to the step.');
  for(const k of Object.keys(patch)) if(!['kind','from','to','amount','cert','entity','trusted','paused'].includes(k)) throw new Error(`A lifecycle step has no ${k} field.`);
  const kind = patch.kind ?? list[index].kind;
  if(kind!=='transfer'&&kind!=='trust'&&kind!=='pause') throw new Error('A basic-KYC lifecycle step must describe a transfer, a trust update, or a pause update.');
  const kindFields = kind==='transfer' ? ['from','to','amount','cert','entity'] : kind==='trust' ? ['entity','trusted'] : ['paused'];
  for(const k of Object.keys(patch)) if(k!=='kind'&&!kindFields.includes(k)) throw new Error(`A lifecycle step has no ${k} field.`);
  // Converting kinds: start from the new kind's blank step (which
  // supplies its defaults), keep the modeled entity when both kinds
  // carry one (transfer ↔ trust — the signer becomes the subject and
  // back), then apply the patch — a patch naming an entity overrides
  // the kept one, and fields the old kind carried never leak into the
  // new shape.
  const bothCarryEntity = kind!==list[index].kind && kind!=='pause' && list[index].kind!=='pause';
  const base = kind===list[index].kind ? list[index] : {...blankBasicKycStep(kind), ...(bothCarryEntity ? {entity:list[index].entity} : {})};
  list[index] = checkedBasicKycStep({...base, ...patch});
  return list;
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
export const REGISTRY_FIELDS_STILL_REQUIRED = Object.freeze([
  'Token policy ID, issued by reviewed and deployed validators',
  'Registry node position and membership / non-membership proofs from the live deployment',
  'Protocol parameters and programmable-logic base script hash of the target deployment',
  'Datum encoding (Plutus Data / CBOR) produced by the pinned reference implementation',
]);
export const REGISTRY_PREVIEW_NOTE = 'This preview is a PRISM design aid, not a CIP-113 registry datum, Plutus blueprint, policy ID, or on-chain registration. PRISM does not register, mint, or deploy anything. A developer must implement the token with the pinned Foundation reference implementation, create the registry entry on a test network, and verify it independently before any production use.';

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
    registryFieldsStillRequired:[...REGISTRY_FIELDS_STILL_REQUIRED],
    note:REGISTRY_PREVIEW_NOTE,
  };
}

// Verify a registry-datum preview file someone was handed, the checking
// counterpart to the export above. The preview is a developer handoff: it
// travels without the design it came from, so until now an edited copy —
// one claiming to BE a CIP datum or an on-chain registration, carrying an
// inflated supply, naming a different substandard, or quietly dropping
// the Plutus Data / CBOR item from the still-required list — could not be
// checked in PRISM at all. This parser applies the manifest discipline to
// the preview format: amounts must be canonical exact decimal strings (a
// JSON number has already lost precision at parse time and a leading-zero
// string is not the form PRISM exports — both rejected, never converted),
// the honesty flags must state exactly what a preview is, the
// substandard section must match PRISM's catalog field by field, the
// still-required list and the note must match the canonical text when
// present, and no section or field PRISM never writes may appear — a
// policyId or cbor field smuggled into a preview is precisely the claim
// this check exists to refuse. Hand-trimmed files may omit the flags,
// the still-required list, or the note (absent is tolerated, as in the
// manifest parser), but nothing present may contradict the canonical
// values. The return is a freshly built canonical preview containing
// only the fields PRISM writes, in export order — verifying imports
// nothing, registers nothing, and changes no design.
function previewAmount(value, label) {
  if(typeof value!=='string') throw new Error(`Registry preview ${label} must be an exact decimal string, not a JSON ${Array.isArray(value)?'array':typeof value}. Re-export the preview from PRISM.`);
  if(!/^\d+$/.test(value)||BigInt(value).toString()!==value) throw new Error(`Registry preview ${label} is not a canonical decimal string. Re-export the preview from PRISM.`);
  const n=BigInt(value);
  if(n<=0n) throw new Error(`Registry preview ${label} must be greater than zero.`);
  if(n>MAX_ASSET) throw new Error(`Registry preview ${label} exceeds the supported signed 64-bit asset limit.`);
  return value;
}
function noUnknownKeys(section, allowed, label) {
  for(const k of Object.keys(section)) if(!allowed.includes(k)) throw new Error(`This registry preview has an unexpected ${label} field (${k}). PRISM previews never carry one — re-export it from PRISM.`);
}

export function parseRegistryDatumPreview(raw) {
  if(typeof raw!=='string'||raw.length>100000) throw new Error('Choose a PRISM JSON file under 100 KB.');
  let p;
  try { p=JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  if(p?.kind!=='prism.registry-datum-preview'||p.previewVersion!==1||!NETWORKS[p.network]) throw new Error('This is not a supported PRISM registry preview.');
  noUnknownKeys(p,['kind','previewVersion','applicationSpecific','cipDatum','registeredOnChain','network','token','transferPolicy','substandard','registryFieldsStillRequired','note'],'top-level');
  if(p.applicationSpecific!==undefined&&p.applicationSpecific!==true) throw new Error('This preview claims it is not application-specific. A PRISM registry preview is application-specific design information, not a CIP datum.');
  if(p.cipDatum!==undefined&&p.cipDatum!==false) throw new Error('This preview claims to be a CIP-113 registry datum. A PRISM preview never is — re-export it from PRISM.');
  if(p.registeredOnChain!==undefined&&p.registeredOnChain!==false) throw new Error('This preview claims an on-chain registration, which PRISM cannot back. PRISM registers nothing — re-export it from PRISM.');
  if(!p.token||typeof p.token!=='object'||Array.isArray(p.token)) throw new Error('This registry preview is missing its token section. Re-export the preview from PRISM.');
  noUnknownKeys(p.token,['name','ticker','decimals','initialSupplyBaseUnits'],'token');
  if(typeof p.token.name!=='string'||p.token.name!==p.token.name.trim()||!p.token.name||new TextEncoder().encode(p.token.name).length>32) throw new Error('Registry preview token name must be 1–32 UTF-8 bytes, exactly as exported (no padding).');
  if(typeof p.token.ticker!=='string'||!(/^[A-Z][A-Z0-9]{1,7}$/).test(p.token.ticker)) throw new Error('Registry preview ticker must use 2–8 uppercase letters or digits and start with a letter.');
  if(!Number.isInteger(p.token.decimals)||p.token.decimals<0||p.token.decimals>6) throw new Error('Registry preview decimals must be between 0 and 6.');
  const supply=previewAmount(p.token.initialSupplyBaseUnits,'initial supply');
  if(!p.transferPolicy||typeof p.transferPolicy!=='object'||Array.isArray(p.transferPolicy)) throw new Error('This registry preview is missing its transfer policy section. Re-export the preview from PRISM.');
  noUnknownKeys(p.transferPolicy,['access','perTransferLimitBaseUnits','issuerPauseModeled','eligibilityRequired'],'transfer policy');
  if(!['allowlist','open'].includes(p.transferPolicy.access)) throw new Error('Registry preview transfer access must be allowlist or open.');
  for(const k of ['issuerPauseModeled','eligibilityRequired']) if(typeof p.transferPolicy[k]!=='boolean') throw new Error(`Registry preview transfer policy ${k} must be true or false.`);
  let limit=null;
  if(p.transferPolicy.perTransferLimitBaseUnits!==null) {
    limit=previewAmount(p.transferPolicy.perTransferLimitBaseUnits,'per-transfer limit');
    if(BigInt(limit)>BigInt(supply)) throw new Error('Registry preview per-transfer limit is larger than its initial supply. The file may have been edited after export — re-export it from PRISM.');
  }
  if(!p.substandard||typeof p.substandard!=='object'||Array.isArray(p.substandard)) throw new Error('This registry preview is missing its substandard section. Re-export the preview from PRISM.');
  noUnknownKeys(p.substandard,['id','name','reference','modeledLocally'],'substandard');
  const sub=substandardById(p.substandard.id);
  if(!sub) throw new Error('This registry preview names an unknown substandard module. Re-export the preview from PRISM.');
  const expectedSub={id:sub.id,name:sub.name,reference:sub.source,modeledLocally:true};
  for(const k of Object.keys(expectedSub)) if(p.substandard[k]!==expectedSub[k]) throw new Error(`Registry preview substandard does not match PRISM's catalog (${k}). The file may have been edited after export — re-export it from PRISM.`);
  if(p.registryFieldsStillRequired!==undefined) {
    if(!Array.isArray(p.registryFieldsStillRequired)||p.registryFieldsStillRequired.length!==REGISTRY_FIELDS_STILL_REQUIRED.length||p.registryFieldsStillRequired.some((v,i)=>v!==REGISTRY_FIELDS_STILL_REQUIRED[i])) throw new Error('Registry preview still-required list does not match the fields every PRISM preview names. The file may have been edited after export — re-export it from PRISM.');
  }
  if(p.note!==undefined&&p.note!==REGISTRY_PREVIEW_NOTE) throw new Error('Registry preview note does not match the note every PRISM preview carries. The file may have been edited after export — re-export it from PRISM.');
  return {
    kind:'prism.registry-datum-preview', previewVersion:1,
    applicationSpecific:true, cipDatum:false, registeredOnChain:false,
    network:p.network,
    token:{name:p.token.name,ticker:p.token.ticker,decimals:p.token.decimals,initialSupplyBaseUnits:supply},
    transferPolicy:{access:p.transferPolicy.access,perTransferLimitBaseUnits:limit,issuerPauseModeled:p.transferPolicy.issuerPauseModeled,eligibilityRequired:p.transferPolicy.eligibilityRequired},
    substandard:{...expectedSub},
    registryFieldsStillRequired:[...REGISTRY_FIELDS_STILL_REQUIRED],
    note:REGISTRY_PREVIEW_NOTE,
  };
}

// The fields a registry-preview comparison judges, in the order
// differences are reported. The preview carries amounts only as exact
// base-unit strings (there is no display-supply field to double-count),
// and the substandard is ONE field (its id — the name and reference are
// catalog-derived, so counting them separately would triple-count a
// single change). The honesty flags, the still-required list, and the
// note are NOT fields here: the verifier canonicalises them (a file
// stating them wrongly is refused, one omitting them is completed), so
// by the time a file reaches comparison they are identical on both
// sides by construction — they are what the file IS, not how the
// designs differ.
export const REGISTRY_COMPARE_FIELDS = Object.freeze([
  ['network','Network'],
  ['tokenName','Token name'],
  ['ticker','Ticker'],
  ['decimals','Decimals'],
  ['supplyBaseUnits','Initial supply (base units)'],
  ['access','Transfer access'],
  ['perTransferLimit','Per-transfer limit (base units)'],
  ['issuerPauseModeled','Issuer pause modeled'],
  ['eligibilityRequired','Eligibility required'],
  ['substandard','CIP-113 substandard'],
]);

// Compare a handed registry-datum preview file against the preview of
// the design currently open, WITHOUT registering or importing anything —
// the comparison counterpart to parseRegistryDatumPreview, as
// diffDesignFile is to verifyManifest. Verifying a preview (v1.75) says
// whether it is a genuine PRISM preview; this says how the design it
// describes differs from yours, which is the question a reviewer's copy
// actually raises: did the supply move, or the transfer policy too?
// The file runs exactly the verifier's checks first — this calls
// parseRegistryDatumPreview itself, so a file that would fail
// verification fails comparison with the same reason, refused whole and
// never partially compared (validate-once). The current side is built
// by the exporter itself (registryDatumPreview), and the verifier's
// return is already the canonical preview in export shape, so both
// sides are the same shape from the same two builders and comparison
// can never disagree with verification or with the export on screen
// about what a preview says. Amounts compare as the exact base-unit
// strings both builders write — a supply past 2^53 compares bit-for-bit.
// The current design must itself be valid and its network known, or
// there is nothing sound to compare against. The return carries the two
// canonical previews and the differences — a preview describes a design
// but IS not one: it carries no design object, so comparing can never
// become a quiet import either.
export function diffRegistryDatumPreview(raw, currentDesign, currentNetwork) {
  if(!NETWORKS[currentNetwork]) throw new Error('Unknown current network — choose a network before comparing.');
  if(!currentDesign||typeof currentDesign!=='object'||Array.isArray(currentDesign)) throw new Error('There is no current design to compare against.');
  const currentErrors=validateDesign(currentDesign);
  if(currentErrors.length) throw new Error(`Your current design cannot be compared yet: ${currentErrors.join(' ')}`);
  const filePreview=parseRegistryDatumPreview(raw);
  const currentPreview=registryDatumPreview(currentDesign,currentNetwork);
  const valueOf=(p,field)=>{
    switch(field){
      case 'network': return p.network;
      case 'tokenName': return p.token.name;
      case 'ticker': return p.token.ticker;
      case 'decimals': return p.token.decimals;
      case 'supplyBaseUnits': return p.token.initialSupplyBaseUnits;
      case 'access': return p.transferPolicy.access;
      case 'perTransferLimit': return p.transferPolicy.perTransferLimitBaseUnits;
      case 'issuerPauseModeled': return p.transferPolicy.issuerPauseModeled;
      case 'eligibilityRequired': return p.transferPolicy.eligibilityRequired;
      case 'substandard': return p.substandard.id;
      default: return undefined;
    }
  };
  const differences=[];
  for(const [field,label] of REGISTRY_COMPARE_FIELDS) {
    const file=valueOf(filePreview,field);
    const current=valueOf(currentPreview,field);
    if(file!==current) differences.push({field,label,file,current});
  }
  return {
    network:filePreview.network,
    currentNetwork,
    same:differences.length===0,
    compared:REGISTRY_COMPARE_FIELDS.length,
    differences,
    filePreview,
    currentPreview,
  };
}

// CIP-113 registry proofs, planned locally against a modeled registry list.
//
// A transfer spending programmable tokens must carry, for each DISTINCT
// policy it touches, one registry proof, and the proofs list must be in the
// policies' lexicographic order (spec: "RegistryProof Requirements"). A
// policy that IS registered is proved by its own RegistryNode
// (TokenExists); a policy that is NOT is proved by the "covering node" —
// the node whose key is the largest key still less than the policy and
// whose `next` is greater than the policy (TokenDoesNotExist) — after which
// the asset is treated as an ordinary native token. Policy IDs are 28-byte
// bytestrings; for equal-length lowercase hex, string order IS byte order.
//
// The registry list itself is validated as the on-chain list is built:
// every key exactly 28 bytes, no key twice, strictly increasing — a list
// that breaks those invariants is REFUSED, never silently sorted or
// deduplicated, because sortedness is the property the proofs rest on.
// The queried policies are the planner's own input, so duplicates there
// collapse to the one distinct proof the spec requires and the output is
// ordered lexicographically whatever order they were asked in.
//
// Boundary honesty: a policy sorting before the first key, after the last
// key, or into an empty list has NO covering node in the list given, so it
// is reported as unprovable in this model — a real registry carries those
// cases on nodes this list does not contain (its origin/terminal nodes),
// which are deployment data this local model does not invent.
function registryPolicyId(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a policy ID string of 56 hexadecimal characters.`);
  const v = value.trim().toLowerCase();
  if (!/^[a-f0-9]{56}$/.test(v)) throw new Error(`${label} is not a 28-byte policy ID (56 hexadecimal characters) — ${value.trim().length} characters given.`);
  return v;
}

export function planRegistryProofs(registryKeys, queriedPolicies) {
  if (!Array.isArray(registryKeys)) throw new Error('The registry list must be an array of policy IDs.');
  if (!Array.isArray(queriedPolicies)) throw new Error('The policies to prove must be an array of policy IDs.');
  const keys = registryKeys.map((k, i) => registryPolicyId(k, `Registry key ${i + 1}`));
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] === keys[i - 1]) throw new Error(`Registry keys must be unique: ${keys[i]} appears more than once — a sorted linked list holds each policy once.`);
    if (keys[i] < keys[i - 1]) throw new Error(`Registry keys must be sorted in lexicographic (byte) order: ${keys[i]} comes after ${keys[i - 1]} in the list but sorts before it.`);
  }
  const distinct = [...new Set(queriedPolicies.map((q, i) => registryPolicyId(q, `Policy to prove ${i + 1}`)))].sort();
  const proofs = distinct.map(policy => {
    const at = keys.indexOf(policy);
    if (at !== -1) return { policy, status: 'registered', proofType: 'TokenExists', nodeIndex: at, nodeKey: policy, nextKey: keys[at + 1] ?? null, reason: null };
    if (!keys.length) return { policy, status: 'unprovable', proofType: null, nodeIndex: null, nodeKey: null, nextKey: null, reason: 'empty-registry' };
    if (policy < keys[0]) return { policy, status: 'unprovable', proofType: null, nodeIndex: null, nodeKey: null, nextKey: null, reason: 'before-first' };
    if (policy > keys[keys.length - 1]) return { policy, status: 'unprovable', proofType: null, nodeIndex: null, nodeKey: null, nextKey: null, reason: 'after-last' };
    let cover = 0;
    while (cover + 1 < keys.length && keys[cover + 1] < policy) cover++;
    return { policy, status: 'unregistered', proofType: 'TokenDoesNotExist', nodeIndex: cover, nodeKey: keys[cover], nextKey: keys[cover + 1], reason: null };
  });
  return {
    keys,
    registrySize: keys.length,
    queriedCount: distinct.length,
    proofs,
    registeredCount: proofs.filter(p => p.status === 'registered').length,
    unregisteredCount: proofs.filter(p => p.status === 'unregistered').length,
    unprovableCount: proofs.filter(p => p.status === 'unprovable').length,
  };
}

// CIP-113 registry proof list verification, checked locally against the
// same modeled registry list the planner plans against.
//
// A transfer's proofs list must satisfy three requirements at once (spec:
// "RegistryProof Requirements"): COMPLETENESS — one proof for each distinct
// policy the transaction touches; ORDERING — the list order matches the
// policies' lexicographic ordering; CORRECTNESS — each proof accurately
// represents its policy's registration status (TokenExists naming the node
// whose key IS the policy, at that node's index; TokenDoesNotExist naming
// the covering node: the largest key below the policy, whose next is above
// it, at that node's index).
//
// The expected proofs are the planner's own output (planRegistryProofs), so
// planning and verification can never disagree about what a correct proof
// is. A claimed proof is checked POSITION BY POSITION — proof type, node
// index, node key, and next key (when the claim states one) each get their
// own verdict — because they fail individually: a TokenExists proof naming
// the right node at the wrong index is a different reference input, and a
// covering node whose stated next does not pass the policy proves nothing.
//
// Refusal vs mismatch, as in PRISM's other verifiers: a claimed proof that
// cannot be read at all (a policy or node key that is not a 28-byte ID, an
// unknown proof type, a node index that is not a non-negative integer) is
// REFUSED with the reason, never scored as a wrong proof — conflating the
// two would send a builder re-checking nodes when the claim itself is
// malformed. A well-formed claim that names the wrong node, type, or index
// is a MISMATCH, with the correct proof shown.
//
// Boundary honesty carries over from the planner: a policy the modeled
// list cannot prove (before the first key, after the last, empty list) is
// reported UNVERIFIABLE IN THIS MODEL whether or not a proof is claimed
// for it — a real registry carries those cases on its origin/terminal
// nodes, deployment data this model does not invent, so no claimed proof
// for such a policy can be confirmed or refuted from the list given.
export function verifyRegistryProofs(registryKeys, queriedPolicies, claimedProofs) {
  const plan = planRegistryProofs(registryKeys, queriedPolicies);
  if (!Array.isArray(claimedProofs)) throw new Error('The claimed proofs must be an array of proof entries.');
  const claimed = claimedProofs.map((entry, i) => {
    const label = `Claimed proof ${i + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} must be an object naming a policy, a proof type, a node index, and a node key.`);
    const policy = registryPolicyId(entry.policy, `${label}'s policy`);
    if (entry.proofType !== 'TokenExists' && entry.proofType !== 'TokenDoesNotExist') throw new Error(`${label}'s proof type must be TokenExists or TokenDoesNotExist — ${JSON.stringify(entry.proofType)} given.`);
    if (!Number.isInteger(entry.nodeIndex) || entry.nodeIndex < 0) throw new Error(`${label}'s node index must be a non-negative integer — ${JSON.stringify(entry.nodeIndex)} given, refused rather than rounded.`);
    const nodeKey = registryPolicyId(entry.nodeKey, `${label}'s node key`);
    const nextKey = entry.nextKey === undefined || entry.nextKey === null ? null : registryPolicyId(entry.nextKey, `${label}'s next key`);
    return { policy, proofType: entry.proofType, nodeIndex: entry.nodeIndex, nodeKey, nextKey };
  });
  const expectedByPolicy = new Map(plan.proofs.map(p => [p.policy, p]));
  const firstClaimByPolicy = new Map();
  const duplicates = [];
  for (const c of claimed) {
    if (firstClaimByPolicy.has(c.policy)) duplicates.push(c.policy);
    else firstClaimByPolicy.set(c.policy, c);
  }
  const missing = [], extra = [], perProof = [];
  for (const c of claimed) if (!expectedByPolicy.has(c.policy) && !extra.includes(c.policy)) extra.push(c.policy);
  for (const expected of plan.proofs) {
    const claim = firstClaimByPolicy.get(expected.policy) ?? null;
    if (expected.status === 'unprovable') {
      perProof.push({ policy: expected.policy, status: 'unverifiable', expected, claimed: claim, verdicts: null });
      continue;
    }
    if (!claim) { missing.push(expected.policy); perProof.push({ policy: expected.policy, status: 'missing', expected, claimed: null, verdicts: null }); continue; }
    const verdicts = {
      proofType: claim.proofType === expected.proofType,
      nodeIndex: claim.nodeIndex === expected.nodeIndex,
      nodeKey: claim.nodeKey === expected.nodeKey,
      nextKey: claim.nextKey === null ? 'not-stated' : claim.nextKey === expected.nextKey,
    };
    const correct = verdicts.proofType && verdicts.nodeIndex && verdicts.nodeKey && verdicts.nextKey !== false;
    perProof.push({ policy: expected.policy, status: correct ? 'correct' : 'incorrect', expected, claimed: claim, verdicts });
  }
  // Ordering is judged on the claimed sequence as given: the spec requires
  // the list itself to be in the policies' lexicographic order, so any
  // adjacent pair out of order (a duplicate is out of order with itself)
  // fails it, at the first offending position.
  let firstOutOfOrder = null;
  for (let i = 1; i < claimed.length; i++) {
    if (claimed[i].policy <= claimed[i - 1].policy) { firstOutOfOrder = i; break; }
  }
  const completeness = { complete: missing.length === 0 && extra.length === 0 && duplicates.length === 0, missing, extra, duplicates };
  const ordering = { ordered: firstOutOfOrder === null, firstOutOfOrder };
  const unverifiableCount = perProof.filter(p => p.status === 'unverifiable').length;
  const correctCount = perProof.filter(p => p.status === 'correct').length;
  const incorrectCount = perProof.filter(p => p.status === 'incorrect').length;
  const valid = completeness.complete && ordering.ordered && incorrectCount === 0 && unverifiableCount === 0;
  return {
    registrySize: plan.registrySize,
    queriedCount: plan.queriedCount,
    claimedCount: claimed.length,
    valid,
    completeness,
    ordering,
    perProof,
    correctCount,
    incorrectCount,
    missingCount: missing.length,
    extraCount: extra.length,
    duplicateCount: duplicates.length,
    unverifiableCount,
  };
}

// CIP-113 registry change impact, compared locally between two modeled
// registry lists — the registry as it was (the planner's list) and as it
// would be after a change (a policy registering, a key inserted, a key
// removed). Registries are living lists: an insertion between two keys
// shifts the node index of every key after it, a registration turns a
// covering-node absence proof into an existence proof, and a removal can
// strand a policy past the new last key altogether. A proof list planned
// against the old list and carried into a transaction after the change
// fails verification for reasons that have nothing to do with the policies
// themselves — this comparison names, per distinct queried policy, exactly
// which proofs survive the change and which positions moved.
//
// Both lists are planned through planRegistryProofs itself, so the impact
// comparison inherits the planner's disciplines for free: each list is
// validated as the on-chain list is built (28-byte keys, each once,
// strictly increasing) and refused if it breaks those invariants, queried
// duplicates collapse to the one distinct proof, and the per-policy order
// is lexicographic. Planning and diffing can never disagree about what
// either list requires, for the same reason planning and verifying
// cannot (v1.64).
//
// Each policy's change is classified by its registration story first —
// NEWLY REGISTERED and NO LONGER REGISTERED take precedence over the
// provability story, because a policy that gained or lost registration is
// the headline even when it also crossed the provable boundary — then
// NEWLY PROVABLE / NEWLY UNPROVABLE, then PROOF CHANGED (provable on both
// sides with the same registration status, but the proof itself differs:
// a shifted node index, a different covering node, a different next key).
// changedFields names the proof positions that differ — status, proof
// type, node index, node key, next key — so the re-plan a builder must do
// is scoped to exactly those positions.
//
// Boundary honesty carries over: "unprovable" on either side means the
// list given carries no covering node for that policy (before its first
// key, after its last, or an empty list) — a real registry carries those
// cases on its origin/terminal nodes, deployment data neither modeled
// list invents. The comparison is between the two lists supplied; PRISM
// read no live registry, and neither list is one.
export function diffRegistryProofs(beforeKeys, afterKeys, queriedPolicies) {
  const before = planRegistryProofs(beforeKeys, queriedPolicies);
  const after = planRegistryProofs(afterKeys, queriedPolicies);
  const beforeSet = new Set(before.keys), afterSet = new Set(after.keys);
  const addedKeys = after.keys.filter(k => !beforeSet.has(k));
  const removedKeys = before.keys.filter(k => !afterSet.has(k));
  const afterByPolicy = new Map(after.proofs.map(p => [p.policy, p]));
  const changedFieldNames = [['status', 'status'], ['proofType', 'proof type'], ['nodeIndex', 'node index'], ['nodeKey', 'node key'], ['nextKey', 'next key']];
  const perPolicy = before.proofs.map(b => {
    const a = afterByPolicy.get(b.policy);
    const differs = changedFieldNames.filter(([f]) => b[f] !== a[f]);
    if (!differs.length) return { policy: b.policy, change: 'unchanged', changedFields: [], before: b, after: a };
    let change;
    if (b.status !== 'registered' && a.status === 'registered') change = 'newly-registered';
    else if (b.status === 'registered' && a.status !== 'registered') change = 'no-longer-registered';
    else if (b.status === 'unprovable' && a.status !== 'unprovable') change = 'newly-provable';
    else if (b.status !== 'unprovable' && a.status === 'unprovable') change = 'newly-unprovable';
    else change = 'proof-changed';
    return { policy: b.policy, change, changedFields: differs.map(([, label]) => label), before: b, after: a };
  });
  const count = c => perPolicy.filter(p => p.change === c).length;
  const unchangedCount = count('unchanged');
  return {
    beforeSize: before.registrySize,
    afterSize: after.registrySize,
    queriedCount: before.queriedCount,
    addedKeys,
    removedKeys,
    perPolicy,
    unchangedCount,
    changedCount: perPolicy.length - unchangedCount,
    newlyRegisteredCount: count('newly-registered'),
    noLongerRegisteredCount: count('no-longer-registered'),
    newlyProvableCount: count('newly-provable'),
    newlyUnprovableCount: count('newly-unprovable'),
    proofChangedCount: count('proof-changed'),
    allUnchanged: unchangedCount === perPolicy.length,
  };
}

// CIP-113 registry insertion planning, modeled locally against the same
// registry list the proof planner plans against.
//
// Registering a programmable token inserts one node into the registry's
// sorted linked list (spec: "Programmable token registration"). The
// registering transaction MUST spend the node preceding the new policy
// (prev_node), and its outputs carry that node back with only its `next`
// rewritten to the new key, plus the new node whose `next` is prev_node's
// old `next`. The RegistryInsert redeemer names the key being registered
// and the minting logic credential — and the validator binds the two
// together (the official issuance script parameterized by that credential
// MUST hash to the key), so the credential is issuer/deployment data this
// plan reports as required, never invents.
//
// The insertion position comes from the planner itself: planRegistryProofs
// over the single policy being registered names the covering node for an
// unregistered policy — and the covering node IS prev_node, the largest
// key below the policy whose next passes it. Planning the insertion
// through the planner means the two can never disagree about where a
// policy belongs, and the modeled list inherits the planner's refusal
// discipline (28-byte keys, each once, strictly increasing).
//
// The boundary cases are where this plan goes past the planner, honestly:
// an absence PROOF for a policy before the first key or after the last
// key is unprovable in this model, because the covering node's next is a
// terminal value the list does not carry — but an INSERTION still has a
// definite shape there. Before the first key, prev_node is the registry's
// origin node: not in the modeled list, so its key and index are reported
// as origin, while the new node's next IS known (the current first key).
// After the last key, prev_node is the last node itself — fully known —
// and the new node's next is prev_node's old next, the list's terminal
// value, which the model does not carry and does not invent. Into an
// empty list, prev_node is the origin and the new node's next is the
// terminal: the position is known, both neighbours are deployment data.
//
// A policy already in the list is not an insertion at all: it is reported
// as already registered, naming the node it already occupies — a second
// RegistryInsert for the same key has no position to plan.
export function planRegistryInsertion(registryKeys, newPolicy) {
  const plan = planRegistryProofs(registryKeys, [newPolicy]);
  const keys = plan.keys;
  const policy = plan.proofs[0].policy;
  const proof = plan.proofs[0];
  if (proof.status === 'registered') {
    return {
      keys,
      registrySize: keys.length,
      policy,
      status: 'already-registered',
      insertionIndex: proof.nodeIndex,
      existingNode: { index: proof.nodeIndex, key: proof.nodeKey, nextKey: proof.nextKey },
      prevNode: null,
      prevKind: null,
      newNode: null,
      successorKey: null,
      shiftedKeys: [],
      resultingKeys: [...keys],
      resultingSize: keys.length,
    };
  }
  let insertionIndex, prevNode, prevKind, successorKey, newNext, newNextKind;
  if (proof.status === 'unregistered') {
    // The covering node is prev_node; the new node takes its place in the
    // chain with next = the covering node's current next.
    insertionIndex = proof.nodeIndex + 1;
    prevNode = { index: proof.nodeIndex, key: proof.nodeKey, nextBefore: proof.nextKey, nextAfter: policy };
    prevKind = 'node';
    successorKey = proof.nextKey;
    newNext = proof.nextKey;
    newNextKind = 'node';
  } else if (proof.reason === 'before-first') {
    insertionIndex = 0;
    prevNode = null;
    prevKind = 'origin';
    successorKey = keys[0];
    newNext = keys[0];
    newNextKind = 'node';
  } else if (proof.reason === 'after-last') {
    const last = keys.length - 1;
    insertionIndex = keys.length;
    prevNode = { index: last, key: keys[last], nextBefore: null, nextAfter: policy };
    prevKind = 'node';
    successorKey = null;
    newNext = null;
    newNextKind = 'terminal';
  } else {
    // empty-registry
    insertionIndex = 0;
    prevNode = null;
    prevKind = 'origin';
    successorKey = null;
    newNext = null;
    newNextKind = 'terminal';
  }
  const resultingKeys = [...keys.slice(0, insertionIndex), policy, ...keys.slice(insertionIndex)];
  return {
    keys,
    registrySize: keys.length,
    policy,
    status: 'insertable',
    insertionIndex,
    existingNode: null,
    prevNode,
    prevKind,
    newNode: { key: policy, nextKey: newNext, nextKind: newNextKind },
    successorKey,
    shiftedKeys: keys.slice(insertionIndex),
    resultingKeys,
    resultingSize: resultingKeys.length,
  };
}

// CIP-113 registry insertion verification, checked locally against the
// same modeled registry list the insertion planner plans against.
//
// A claimed insertion — the shape a registering transaction is said to
// have — is judged against the spec's "Programmable token registration"
// requirements as this model can state them: the transaction spends the
// correct prev_node, returns it with only its `next` rewritten to the new
// key, and adds the new node pointing at prev_node's old `next`, at the
// position the sorted list requires. Each of those is a separate claim
// and gets its own verdict — prev node, prev rewrite, new node's next,
// insertion index — because they fail separately: spending the right node
// but pointing the new node at the wrong successor breaks the chain just
// as surely as spending the wrong node, and the fix differs.
//
// The expected insertion is the PLANNER'S OWN OUTPUT
// (planRegistryInsertion), so planning and verification can never
// disagree about where a policy belongs — the validate-once discipline
// of v1.58/v1.64 applied to the registry's constructive pair. A claim
// field left unstated (undefined) is 'not-stated', never a pass and
// never a failure: the verdict is INCOMPLETE until every position is
// stated, because a registration claim missing its new node's next has
// not yet claimed the thing the chain depends on. null, by contrast, IS
// a statement — prevKey null claims the origin node precedes the new
// policy, newNext null claims the new node inherits the terminal next —
// and is judged true or false like any key.
//
// Refusal vs mismatch, as in PRISM's other verifiers: a claim that
// cannot be read at all (a prev/rewrite/next value that is not a 28-byte
// ID or the null statement, an index that is not a non-negative integer)
// is REFUSED with the reason, never scored as a wrong insertion.
//
// Boundary honesty carries over: a policy already in the modeled list
// has NO insertion to verify — a second RegistryInsert for the same key
// has no position — so any claim for it is reported NOT INSERTABLE, not
// scored. And a correct verdict proves only the list mechanics against
// this modeled list: the RegistryInsert redeemer's minting logic
// credential and its cryptographic binding to the key are judged in
// the binding checker below, and the registry NFT in the outputs
// checker below that — this verifier judges neither and does not
// pretend to.
export function verifyRegistryInsertion(registryKeys, newPolicy, claimed) {
  const plan = planRegistryInsertion(registryKeys, newPolicy);
  if (!claimed || typeof claimed !== 'object' || Array.isArray(claimed)) throw new Error('The claimed insertion must be an object naming a prev node, its rewritten next, the new node\u2019s next, and an insertion index.');
  const policyIdOrNull = (value, label) => {
    if (value === undefined) return 'not-stated';
    if (value === null) return null;
    return registryPolicyId(value, label);
  };
  const prevKey = policyIdOrNull(claimed.prevKey, 'Claimed insertion\u2019s prev_node key');
  const newNext = policyIdOrNull(claimed.newNext, 'Claimed insertion\u2019s new node next');
  const prevNextAfter = claimed.prevNextAfter === undefined ? 'not-stated' : registryPolicyId(claimed.prevNextAfter, 'Claimed insertion\u2019s prev_node next after the rewrite');
  let insertionIndex = 'not-stated';
  if (claimed.insertionIndex !== undefined) {
    if (!Number.isInteger(claimed.insertionIndex) || claimed.insertionIndex < 0) throw new Error(`Claimed insertion's index must be a non-negative integer \u2014 ${JSON.stringify(claimed.insertionIndex)} given, refused rather than rounded.`);
    insertionIndex = claimed.insertionIndex;
  }
  const claimedNorm = { prevKey, prevNextAfter, newNext, insertionIndex };
  if (plan.status === 'already-registered') {
    return {
      registrySize: plan.registrySize,
      policy: plan.policy,
      status: 'not-insertable',
      valid: false,
      expected: null,
      existingNode: plan.existingNode,
      claimed: claimedNorm,
      verdicts: null,
    };
  }
  const expected = {
    insertionIndex: plan.insertionIndex,
    prevKind: plan.prevKind,
    prevKey: plan.prevNode?.key ?? null,
    prevNextAfter: plan.policy,
    newNext: plan.newNode.nextKey,
    newNextKind: plan.newNode.nextKind,
  };
  const verdicts = {
    prevNode: prevKey === 'not-stated' ? 'not-stated' : prevKey === expected.prevKey,
    prevRewrite: prevNextAfter === 'not-stated' ? 'not-stated' : prevNextAfter === expected.prevNextAfter,
    newNodeNext: newNext === 'not-stated' ? 'not-stated' : newNext === expected.newNext,
    insertionIndex: insertionIndex === 'not-stated' ? 'not-stated' : insertionIndex === expected.insertionIndex,
  };
  const values = Object.values(verdicts);
  const valid = values.every(v => v === true);
  const status = valid ? 'correct' : values.includes(false) ? 'incorrect' : 'incomplete';
  return {
    registrySize: plan.registrySize,
    policy: plan.policy,
    status,
    valid,
    expected,
    existingNode: null,
    claimed: claimedNorm,
    verdicts,
  };
}

export const REGISTRY_INSERT_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['insertionIndex', 'Insertion index'],
  ['prevNode', 'Prev node'],
  ['nodeNext', 'Node next'],
]);

// CIP-113 registry insertion impact, compared locally between two modeled
// registry lists for the SAME policy being registered — the insertion as
// planned against the registry as it was, and as planned against the
// registry as it would be after some other change (another policy
// registering first, a key inserted, a key removed). The proofs diff
// (diffRegistryProofs) answers what a registry change does to proofs
// already planned; this answers what it does to a registration still
// being planned: an insertion ahead of the policy's position shifts its
// index, an insertion between its prev_node and the policy replaces the
// node the registering transaction must spend, a removal of its successor
// leaves the new node inheriting the terminal next instead, and the
// change may BE this policy's own registration — in which case there is
// no longer an insertion to plan at all.
//
// Both lists are planned through planRegistryInsertion itself, so the
// comparison inherits the planner's disciplines for free: each list is
// validated as the on-chain list is built (28-byte keys, each once,
// strictly increasing) and refused if it breaks those invariants, and
// planning and comparing can never disagree about where the policy
// belongs in either list (validate-once, twenty-second application).
//
// Four positions are compared, in plan order: the status, the insertion
// index, the prev node, and the node next. THE SUBSTANCE is what is NOT
// compared: the plan's successorKey is the new node's next restated —
// the two are equal in every insertable plan by construction — so
// counting both would double-count a single successor change (a removed
// successor is ONE difference, not two; pinned). The shifted-keys list
// is likewise derived from the insertion index and the list itself, and
// the resulting list is the two lists with the policy placed, so neither
// is a position of its own. For an already-registered policy the four
// positions read off its existing node (its index; no prev node — a
// registered policy has no insertion pending; its node's next, with the
// last node's uncarried terminal next normalised to 'terminal' exactly
// as an insertable plan states it), so a registration story and a
// position story compare in the same four positions.
//
// The change is classified by its registration story first — NEWLY
// REGISTERED and NO LONGER REGISTERED take precedence, because a policy
// that gained or lost registration is the headline even when its
// position also moved — then NODE CHANGED (registered on both sides,
// its node moved or its next changed) and POSITION CHANGED (insertable
// on both sides, the planned insertion moved).
//
// Boundary honesty carries over: 'origin' and 'terminal' name real
// on-chain values neither modeled list carries — the origin node the
// registering transaction spends when the policy sorts first, and the
// terminal next a last node inherits. The comparison is between the two
// lists supplied; PRISM read no live registry, and neither list is one.
// Comparing plans registers nothing and applies neither plan.
export function diffRegistryInsertion(beforeKeys, afterKeys, newPolicy) {
  const before = planRegistryInsertion(beforeKeys, newPolicy);
  const after = planRegistryInsertion(afterKeys, newPolicy);
  const positionOf = plan => ({
    status: plan.status,
    insertionIndex: plan.insertionIndex,
    prevNode: plan.status === 'already-registered' ? null : plan.prevKind === 'origin' ? 'origin' : plan.prevNode.key,
    nodeNext: plan.status === 'already-registered'
      ? (plan.existingNode.nextKey ?? 'terminal')
      : (plan.newNode.nextKind === 'terminal' ? 'terminal' : plan.newNode.nextKey),
  });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of REGISTRY_INSERT_COMPARE_FIELDS) {
    if (beforePos[field] !== afterPos[field]) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.status !== 'already-registered' && after.status === 'already-registered') change = 'newly-registered';
  else if (before.status === 'already-registered' && after.status !== 'already-registered') change = 'no-longer-registered';
  else if (before.status === 'already-registered') change = 'node-changed';
  else change = 'position-changed';
  const beforeSet = new Set(before.keys), afterSet = new Set(after.keys);
  return {
    policy: before.policy,
    beforeSize: before.registrySize,
    afterSize: after.registrySize,
    addedKeys: after.keys.filter(k => !beforeSet.has(k)),
    removedKeys: before.keys.filter(k => !afterSet.has(k)),
    change,
    changedFields: differences.map(d => d.label),
    differences,
    before,
    after,
    unchanged: differences.length === 0,
  };
}

// CIP-113 RegistryInsert binding, modeled locally from the spec's
// "Registry redeemer and the binding of policy to logic" and the
// Foundation reference implementation's registry validator and its
// derivation helper (lib/utils.ak: expect_programmable_token_id_valid /
// apply_hashed_parameter, re-read 2026-10-10).
//
// The insertion planner and verifier above judge a registration's LIST
// mechanics and state plainly what they do not: the RegistryInsert
// redeemer's minting logic credential, its cryptographic binding to the
// key, and the registry NFT. This section models the first two — the
// binding is a computation, and a modeled claim can carry every input
// it needs. (The registry NFT is not judged here — it is judged in
// the outputs checker below, against the modeled mint and the two
// modeled node outputs a claim carries there.)
//
// The registry minting policy takes the redeemer
//
//   RegistryInsert { key: ByteArray, minting_logic_script: Credential }
//
// and on insertion the registry enforces three things, each judged
// here as its own position because they fail separately:
//
// 1. DATUM EQUALS REDEEMER. The new node's `minting_logic_script` datum
//    field MUST equal the credential named in the redeemer, so a
//    registrar cannot declare one credential and write another into
//    the datum (the reference's is_inserted_registry_node is handed
//    the redeemer's credential, never the datum's own claim).
// 2. POLICY BINDING. The official issuance script, parameterised with
//    that credential, MUST hash to `key`. The parameter's hash is
//    derived inside the validator and is not a redeemer field, so
//    collision resistance of the hash — not a runtime equality check
//    between two supplied values — is what forces the policy and its
//    minting logic to agree. The derivation, exactly as the reference
//    performs it (apply_hashed_parameter): the credential MUST be a
//    Script credential (a VerificationKey credential aborts the
//    derivation — there is no policy to compare, and this model
//    reports the binding failed with no expected policy derived,
//    never a hash of a public key invented for the purpose); its
//    inner 28-byte hash is the parameter; the reconstructed script is
//    the Plutus V3 version byte 0x03, then the issuance template's
//    prefix_cbor_hex, then the parameter hash, then postfix_cbor_hex
//    (any CBOR framing for the parameter lives inside the prefix and
//    postfix, which are the template's own bytes, carried by the
//    IssuanceCborHex datum on a reference input the validator finds
//    by its one-shot policy); the policy is Blake2b-224 of those
//    bytes — the ledger's own Plutus V3 script hash of the
//    reconstructed script.
// 3. PROOF OF INSTANCE. The substandard's minting logic MUST be
//    invoked in the registering transaction — its credential appears
//    in the transaction's withdrawals — required explicitly because a
//    registration MAY carry no first mint, in which case the issuance
//    minting policy is never invoked to check it. Whether a first
//    mint rides along is NOT judged: both shapes are valid, and a
//    strict register-then-mint lifecycle is the substandard's own
//    minting logic's business, not the registry's.
//
// Refusal vs verdict, as in PRISM's other checkers: a claim that
// cannot be read — a key that is not a 28-byte policy ID, a credential
// of an unknown kind or with a hash of any other length, template
// bytes that are not even-length hexadecimal, a withdrawals list that
// is not a list, names a credential twice (a transaction's withdrawal
// map cannot), or carries an unknown or missing field — is REFUSED
// with the reason, never scored in part.
//
// Boundary honesty: a bound verdict proves only that the three
// modeled positions agree for the claim as entered, against the
// template bytes as entered. PRISM read no reference input and no
// transaction and registered nothing — the registry NFT is judged
// in the outputs checker below, not here; the
// template bytes here are the claim's own, so a verdict is only as
// deployment-true as the template the builder pasted in.
function registryCredential(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a credential naming a kind (pubkey or script) and a hash.`);
  for (const k of Object.keys(value)) if (k !== 'kind' && k !== 'hash') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a credential names only a kind and a hash.`);
  if (value.kind === undefined || value.hash === undefined) throw new Error(`${label} must name both a kind (pubkey or script) and a hash.`);
  if (value.kind !== 'pubkey' && value.kind !== 'script') throw new Error(`${label}'s kind must be pubkey or script — ${JSON.stringify(value.kind)} given.`);
  const hash = registryBytesHex(value.hash, `${label}'s hash`);
  if (hash.length !== 56) throw new Error(`${label}'s hash must be 28 bytes (56 hexadecimal characters) — ${hash.length / 2} bytes given.`);
  return { kind: value.kind, hash };
}

function issuanceTemplateBytes(value, label) {
  const v = registryBytesHex(value, label);
  return { hex: v, bytes: v === '' ? new Uint8Array(0) : hexToBytes(v) };
}

// The derivation half of the binding: the policy ID the official
// issuance template, parameterised by a minting logic credential,
// hashes to. The return is pinned by test, key for key: the derived
// policy, the parameter hash it was derived from (the credential's own
// inner hash — the derivation's only secret-shaped input, and it is
// the credential itself, which a redeemer states in the open), the
// canonical template bytes, and the reconstructed script's length.
// No script bytes are returned: the reconstruction exists to be
// hashed, and handing the bytes back would invite reading them as a
// script PRISM derived — it derived a hash, from a template a builder
// supplied, of a script that lives in the deployment's reference
// input, not here.
export function deriveIssuancePolicyId(prefixHex, postfixHex, mintingLogic) {
  const credential = registryCredential(mintingLogic, 'The minting logic credential');
  if (credential.kind !== 'script') throw new Error(`The issuance derivation requires a script minting logic credential — the reference aborts on a public-key credential, because the parameter it hashes is the credential's inner script hash. A ${credential.kind} credential has no policy to derive.`);
  const prefix = issuanceTemplateBytes(prefixHex, 'The issuance template prefix_cbor_hex');
  const postfix = issuanceTemplateBytes(postfixHex, 'The issuance template postfix_cbor_hex');
  const script = new Uint8Array(1 + prefix.bytes.length + 28 + postfix.bytes.length);
  script[0] = 0x03;
  script.set(prefix.bytes, 1);
  script.set(hexToBytes(credential.hash), 1 + prefix.bytes.length);
  script.set(postfix.bytes, 1 + prefix.bytes.length + 28);
  return {
    policyId: bytesToHex(blake2b(script, 28)),
    mintingLogic: credential,
    paramHash: credential.hash,
    prefix: prefix.hex,
    postfix: postfix.hex,
    scriptByteLength: script.length,
  };
}

export function checkRegistryInsertBinding(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The binding claim must be an object naming the redeemer’s key and minting logic credential, the new node’s datum minting logic credential, the transaction’s withdrawals, and the issuance template’s prefix and postfix.');
  const inputFields = ['key', 'mintingLogic', 'datumMintingLogic', 'withdrawals', 'issuancePrefix', 'issuancePostfix'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The binding claim carries an unknown field ${JSON.stringify(k)} — it names only the redeemer’s key and minting logic credential, the datum’s minting logic credential, the withdrawals, and the issuance template’s prefix and postfix.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The binding claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const key = registryPolicyId(claim.key, 'The RegistryInsert redeemer’s key');
  const mintingLogic = registryCredential(claim.mintingLogic, 'The RegistryInsert redeemer’s minting_logic_script');
  const datumMintingLogic = registryCredential(claim.datumMintingLogic, 'The new node’s datum minting_logic_script');
  if (!Array.isArray(claim.withdrawals)) throw new Error('The binding claim’s withdrawals must be a list of the credentials the registering transaction invokes — a withdrawal map’s keys, in any order.');
  const withdrawals = claim.withdrawals.map((w, i) => registryCredential(w, `Withdrawal ${i + 1}`));
  const seen = new Set();
  for (const w of withdrawals) {
    const id = `${w.kind}:${w.hash}`;
    if (seen.has(id)) throw new Error(`The withdrawals name the ${w.kind} credential ${w.hash} twice — a transaction’s withdrawal map holds each credential once, so the claim cannot be read as one.`);
    seen.add(id);
  }
  const prefix = issuanceTemplateBytes(claim.issuancePrefix, 'The issuance template prefix_cbor_hex');
  const postfix = issuanceTemplateBytes(claim.issuancePostfix, 'The issuance template postfix_cbor_hex');
  const datumMatchesRedeemer = datumMintingLogic.kind === mintingLogic.kind && datumMintingLogic.hash === mintingLogic.hash;
  let expectedPolicyId = null;
  if (mintingLogic.kind === 'script') {
    expectedPolicyId = deriveIssuancePolicyId(prefix.hex, postfix.hex, mintingLogic).policyId;
  }
  const policyBinding = expectedPolicyId !== null && expectedPolicyId === key;
  const mintingLogicInvoked = withdrawals.some(w => w.kind === mintingLogic.kind && w.hash === mintingLogic.hash);
  const verdicts = { datumMatchesRedeemer, policyBinding, mintingLogicInvoked };
  const valid = datumMatchesRedeemer && policyBinding && mintingLogicInvoked;
  return {
    status: valid ? 'bound' : 'not-bound',
    valid,
    key,
    mintingLogic,
    datumMintingLogic,
    expectedPolicyId,
    withdrawals,
    verdicts,
  };
}

export const REGISTRY_INSERT_BINDING_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['expectedPolicyId', 'Expected policy'],
  ['datumMatchesRedeemer', 'Datum equals redeemer'],
  ['policyBinding', 'Policy binding'],
  ['mintingLogicInvoked', 'Minting logic invoked'],
]);

// CIP-113 RegistryInsert binding impact, compared locally between
// two modeled versions of the SAME claimed registration — the
// redeemer, datum, withdrawals, and template bytes as entered, and
// as they would stand after some later change. Every other PRISM
// checker family already had this temporal half; the registry
// insert binding family, shipped as a single checker, had only the
// check, so a builder whose registration bound when they modeled
// it could not ask what a later change did to it — and the changes
// that stale it need never touch the redeemer itself: a deployment
// publishing a corrected issuance template (new prefix or postfix
// bytes) re-derives a different policy for the same credential, a
// substandard rotating its minting logic credential leaves the
// datum and the withdrawals pointing at the old one, and assembly
// rebuilding the registering transaction without the credential’s
// withdraw-zero drops the proof of instance.
//
// Both versions are checked through checkRegistryInsertBinding
// itself (validate-once, thirty-fourth application), so comparison
// and checking can never disagree about either version, and a
// version that cannot be read (an unknown or missing field, a key
// that is not a 28-byte policy ID, a credential of an unknown kind
// or with a hash of any other length, template bytes that are not
// even-length hexadecimal, a withdrawals list naming a credential
// twice) is refused on either side with the checker’s reason,
// never compared around. Hex case is canonicalised by the checker
// before comparison, so a key, a credential, or template bytes in
// uppercase still name the same registration on either side.
//
// The comparison tracks ONE registration claim, but the claim has
// no action identity of its own — like the authorization and
// proof-list comparisons, any two readable versions compare: the
// key is data the binding judges, not an identity a version could
// drift from, and a registration re-pointed at the policy a new
// credential derives IS the same registration carried forward.
//
// Five positions are compared, in the checker’s own order: the
// status, the expected policy (the policy the issuance template,
// parameterised by the redeemer’s credential, derives — the
// requirement itself, as the dispatch comparison’s delegate
// position is: the value the key must equal, derived rather than
// declared, and null when the redeemer names a public-key
// credential, on which the derivation aborts and no policy
// exists), the datum-equals-redeemer verdict, the policy-binding
// verdict, and the minting-logic-invoked verdict. THE SUBSTANCE is
// what is NOT compared as a position. The key’s own change is
// reported, never counted: its only scored consequence is the
// binding verdict’s move, so counting it would count one fact
// twice. The redeemer and datum credentials’ own changes and the
// template bytes’ own changes are reported, never counted, for the
// same reason: they are the inputs the expected policy and the
// verdicts are computed from — the causes; the positions are the
// consequence. The withdrawal list’s own change is reported as the
// credentials added and removed, never counted: a stranger’s
// withdrawal joining moves no position the checker scores, and the
// minting logic’s own withdrawal leaving is scored exactly once,
// in the invocation verdict.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because
// the registration gaining or losing its binding is the headline
// even when the expected policy also moved — then STILL NOT
// CONFORMING (not bound on both sides, but not the same failure: a
// position changed underneath it) and REQUIREMENT CHANGED (bound
// on both sides, but a position moved — and every such move passes
// through the expected-policy position: a minting logic credential
// rotated, with the key re-derived for the new credential and the
// datum and withdrawals following it, binds exactly as before
// under a different derived policy; the three verdicts stand true
// on both sides throughout).
//
// Boundary honesty carries over from the checker: the comparison
// is between the two modeled versions entered, against the
// template bytes entered in each. PRISM read no reference input
// and no transaction and registered nothing, and comparing checks
// neither version and builds no transaction. The registry NFT the
// new node must hold is the outputs family’s position, on both
// sides alike.
export function diffRegistryInsertBinding(beforeClaim, afterClaim) {
  const before = checkRegistryInsertBinding(beforeClaim);
  const after = checkRegistryInsertBinding(afterClaim);
  const positionOf = v => ({ status: v.status, expectedPolicyId: v.expectedPolicyId, datumMatchesRedeemer: v.verdicts.datumMatchesRedeemer, policyBinding: v.verdicts.policyBinding, mintingLogicInvoked: v.verdicts.mintingLogicInvoked });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of REGISTRY_INSERT_BINDING_COMPARE_FIELDS) {
    if (beforePos[field] !== afterPos[field]) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const credKey = c => `${c.kind}:${c.hash}`;
  const beforeWdrl = new Set(before.withdrawals.map(credKey));
  const afterWdrl = new Set(after.withdrawals.map(credKey));
  const templateOf = c => ({ prefix: String(c.issuancePrefix).trim().toLowerCase(), postfix: String(c.issuancePostfix).trim().toLowerCase() });
  const beforeTemplate = templateOf(beforeClaim), afterTemplate = templateOf(afterClaim);
  return {
    change,
    changedFields: differences.map(d => d.label),
    differences,
    keyChanged: before.key !== after.key,
    mintingLogicChanged: credKey(before.mintingLogic) !== credKey(after.mintingLogic),
    datumMintingLogicChanged: credKey(before.datumMintingLogic) !== credKey(after.datumMintingLogic),
    templatePrefixChanged: beforeTemplate.prefix !== afterTemplate.prefix,
    templatePostfixChanged: beforeTemplate.postfix !== afterTemplate.postfix,
    withdrawalsAdded: [...afterWdrl].filter(w => !beforeWdrl.has(w)),
    withdrawalsRemoved: [...beforeWdrl].filter(w => !afterWdrl.has(w)),
    withdrawalCountBefore: before.withdrawals.length,
    withdrawalCountAfter: after.withdrawals.length,
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: REGISTRY_INSERT_BINDING_COMPARE_FIELDS.length,
  };
}

// CIP-113 RegistryInsert outputs, modeled locally from the spec's
// registration requirements (points 5–7) and the Foundation reference
// implementation's output validation (lib/linked_list.ak
// validate_registry_node_output / validate_mint, registry.ak
// RegistryInsert — re-read 2026-10-10).
//
// The checkers above judge a registration's list mechanics, its datum
// contents, and its cryptographic binding — and state what they do
// not: the registry NFT. This section models the transaction side
// they cannot reach: what the registering transaction MINTS and what
// its two registry-node OUTPUTS carry and where they sit. The spec's
// requirements, each judged here as its own position because they
// fail separately:
//
// 1. MINTED NFT. The transaction MUST mint exactly one registry NFT
//    under the registryMintingPolicy, with the programmable token
//    policy as its name (point 5) — the reference's validate_mint
//    requires the mint under that policy to be a single asset at
//    quantity 1, and RegistryInsert requires its name to be the key.
// 2. NODE NFTS. Each of the two node outputs MUST hold exactly that
//    policy's NFT, at quantity 1, named by ITS OWN node's key — the
//    new node's by the key being registered, the returned covering
//    (prev) node's by the key it already carried (for the origin
//    node, the empty name). An output holding the other node's NFT,
//    two of its own, or none is a different failure in a different
//    output, so the two are judged separately.
// 3. NO OTHER VALUE. A node output's value carries exactly two
//    policies — lovelace and the registry policy. Any further asset
//    fails that output: a registry node is a directory entry, not a
//    wallet, and value parked in one is value the registry's own
//    spend rules never accounted for.
// 4. NO REFERENCE SCRIPT. Neither output may carry one (point 6).
// 5. PAYMENT-ONLY ADDRESS. Both outputs' addresses MUST only have
//    payment credentials (point 7). In the reference the registry
//    script's mint and spend handlers share one hash, so a node
//    output's payment credential IS the registry policy itself and
//    its stake credential is absent — enforced there as equality
//    with the covering node's address, judged here in its two parts:
//    the payment hash equals the registry policy, and no stake
//    credential is present.
//
// The covering node's own datum contents, the new node's datum
// contents, and the list mechanics are judged by the datum checker,
// the binding checker, and the insertion planner/verifier — not
// repeated here. The new node's lovelace amount is NOT judged: the
// spec says it SHOULD be the protocol minimum (point 5), a
// recommendation this model reports no verdict on rather than
// failing a registration the registry itself would accept.
//
// Refusal vs verdict, as in PRISM's other checkers: a claim that
// cannot be read — a key that is not a 28-byte policy ID, an asset
// named twice in one value (a value map holds each asset once), a
// quantity that is not a positive decimal string (a JavaScript
// number cannot name every int64 quantity, so one is refused rather
// than rounded), a flag that is not a boolean, an unknown or missing
// field — is REFUSED with the reason, never scored in part.
//
// Boundary honesty: a conforming verdict proves only that the
// modeled mint and the two modeled outputs satisfy the five
// requirements above. PRISM read no transaction and no UTxO and
// registered nothing; whether a real transaction's outputs are the
// ones modeled here is the builder's evidence to supply, not a
// fact this checker can see.
function registryInsertQuantity(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a decimal string — a JavaScript number cannot name every int64 quantity exactly, so a numeric quantity is refused rather than rounded.`);
  const v = value.trim();
  if (!/^[0-9]+$/.test(v)) throw new Error(`${label} must be a positive whole quantity as a decimal string — ${JSON.stringify(value)} given.`);
  const q = BigInt(v);
  if (q === 0n) throw new Error(`${label} must be positive — a value entry holding zero of an asset is not an entry.`);
  if (q > MAX_ASSET) throw new Error(`${label} exceeds the modeled int64 asset ceiling.`);
  return q;
}

function registryInsertAssetName(value, label) {
  const v = registryBytesHex(value, label);
  if (v.length > 64) throw new Error(`${label} is ${v.length / 2} bytes — an asset name is at most 32 bytes.`);
  return v;
}

function registryInsertMinted(minted) {
  if (!Array.isArray(minted)) throw new Error('The claimed mint under the registry policy must be a list of the assets it mints — name and quantity each.');
  const seen = new Set();
  return minted.map((a, i) => {
    const label = `Minted asset ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error(`${label} must be an object naming an asset name and a quantity.`);
    for (const k of Object.keys(a)) if (k !== 'name' && k !== 'quantity') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a minted asset names only its name and quantity.`);
    if (a.name === undefined || a.quantity === undefined) throw new Error(`${label} must name both an asset name and a quantity.`);
    const name = registryInsertAssetName(a.name, `${label}'s name`);
    if (seen.has(name)) throw new Error(`The claimed mint names the asset ${name === '' ? '(empty name)' : name} twice — a mint value holds each asset once, so the claim cannot be read as one.`);
    seen.add(name);
    return { name, quantity: registryInsertQuantity(a.quantity, `${label}'s quantity`) };
  });
}

function registryInsertOutput(output, label) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error(`${label} must be an object naming its payment credential hash, whether a stake credential is present, whether it carries a reference script, and the assets it holds.`);
  const fields = ['paymentHash', 'stakeCredential', 'referenceScript', 'assets'];
  for (const k of Object.keys(output)) if (!fields.includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled node output names only its payment credential hash, its stake and reference-script flags, and its assets.`);
  for (const k of fields) if (output[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const paymentHash = registryPolicyId(output.paymentHash, `${label}'s payment credential hash`);
  if (typeof output.stakeCredential !== 'boolean') throw new Error(`${label} must say, as a boolean, whether its address carries a stake credential — the payment-only rule turns on exactly that fact.`);
  if (typeof output.referenceScript !== 'boolean') throw new Error(`${label} must say, as a boolean, whether it carries a reference script — the no-reference-script rule turns on exactly that fact.`);
  if (!Array.isArray(output.assets)) throw new Error(`${label}'s assets must be a list of the non-lovelace assets it holds — policy, name, and quantity each.`);
  const seen = new Set();
  const assets = output.assets.map((a, i) => {
    const alabel = `${label} asset ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error(`${alabel} must be an object naming a policy, an asset name, and a quantity.`);
    for (const k of Object.keys(a)) if (k !== 'policy' && k !== 'name' && k !== 'quantity') throw new Error(`${alabel} carries an unknown field ${JSON.stringify(k)} — an asset names only its policy, name, and quantity.`);
    if (a.policy === undefined || a.name === undefined || a.quantity === undefined) throw new Error(`${alabel} must name a policy, an asset name, and a quantity.`);
    const policy = registryPolicyId(a.policy, `${alabel}'s policy`);
    const name = registryInsertAssetName(a.name, `${alabel}'s name`);
    const id = `${policy}:${name}`;
    if (seen.has(id)) throw new Error(`${label} lists the asset ${policy}:${name === '' ? '(empty name)' : name} twice — a value holds each asset once, so the claim cannot be read as one.`);
    seen.add(id);
    return { policy, name, quantity: registryInsertQuantity(a.quantity, `${alabel}'s quantity`) };
  });
  return { paymentHash, stakeCredential: output.stakeCredential, referenceScript: output.referenceScript, assets };
}

export function checkRegistryInsertOutputs(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The outputs claim must be an object naming the key being registered, the covering node’s key, the registry policy, the assets minted under it, and the two registry-node outputs.');
  const inputFields = ['key', 'prevKey', 'registryPolicy', 'minted', 'prevOutput', 'newOutput'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The outputs claim carries an unknown field ${JSON.stringify(k)} — it names only the key, the covering node’s key, the registry policy, the mint under it, and the two node outputs.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The outputs claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const key = registryPolicyId(claim.key, 'The key being registered');
  const prevKeyRaw = typeof claim.prevKey === 'string' ? claim.prevKey.trim().toLowerCase() : claim.prevKey;
  const prevKey = prevKeyRaw === '' ? '' : registryPolicyId(claim.prevKey, 'The covering node’s key');
  const registryPolicy = registryPolicyId(claim.registryPolicy, 'The registry policy');
  const minted = registryInsertMinted(claim.minted);
  const prevOutput = registryInsertOutput(claim.prevOutput, 'The covering node output');
  const newOutput = registryInsertOutput(claim.newOutput, 'The new node output');
  const holdsOwnNft = (output, nodeKey) => {
    const own = output.assets.filter(a => a.policy === registryPolicy);
    return own.length === 1 && own[0].name === nodeKey && own[0].quantity === 1n;
  };
  const verdicts = {
    mintedNft: minted.length === 1 && minted[0].name === key && minted[0].quantity === 1n,
    prevNft: holdsOwnNft(prevOutput, prevKey),
    newNft: holdsOwnNft(newOutput, key),
    prevExtraValue: prevOutput.assets.every(a => a.policy === registryPolicy),
    newExtraValue: newOutput.assets.every(a => a.policy === registryPolicy),
    prevNoReferenceScript: prevOutput.referenceScript === false,
    newNoReferenceScript: newOutput.referenceScript === false,
    prevAddress: prevOutput.paymentHash === registryPolicy && prevOutput.stakeCredential === false,
    newAddress: newOutput.paymentHash === registryPolicy && newOutput.stakeCredential === false,
  };
  const valid = Object.values(verdicts).every(Boolean);
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    key,
    prevKey,
    registryPolicy,
    minted: minted.map(a => ({ name: a.name, quantity: a.quantity.toString() })),
    prevOutput: { ...prevOutput, assets: prevOutput.assets.map(a => ({ ...a, quantity: a.quantity.toString() })) },
    newOutput: { ...newOutput, assets: newOutput.assets.map(a => ({ ...a, quantity: a.quantity.toString() })) },
    verdicts,
  };
}

export const REGISTRY_INSERT_OUTPUTS_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['expectedNfts', 'Expected node NFTs'],
  ['mintedNft', 'Minted registry NFT'],
  ['prevNft', 'Covering node NFT'],
  ['newNft', 'New node NFT'],
  ['prevExtraValue', 'Covering node value'],
  ['newExtraValue', 'New node value'],
  ['prevNoReferenceScript', 'Covering node reference script'],
  ['newNoReferenceScript', 'New node reference script'],
  ['prevAddress', 'Covering node address'],
  ['newAddress', 'New node address'],
]);

// CIP-113 RegistryInsert outputs impact, compared locally between
// two modeled versions of the SAME claimed registration — its mint
// and its two registry-node outputs as entered, and as they would
// stand after some later change. With this comparison every PRISM
// checker family has its temporal half; the registry insert outputs
// family, shipped as a single checker, had only the check, so a
// builder whose outputs conformed when they modeled them could not
// ask what a later change did to them — and the changes that stale
// them need never touch the outputs themselves: a registry
// redeployed under a new registry policy re-points every node
// address and every NFT the outputs must hold, a registration
// re-planned against a different covering node changes the NFT the
// returned output must carry, and transaction assembly rebuilding
// an output — parking an extra asset in it, attaching a reference
// script, paying it to a stake-bearing address — breaks a
// requirement the output alone states.
//
// Both versions are checked through checkRegistryInsertOutputs
// itself (validate-once, thirty-fifth application), so comparison
// and checking can never disagree about either version, and a
// version that cannot be read (an unknown or missing field, a key
// that is not a 28-byte policy ID, an asset named twice in one
// value, a quantity that is not a positive decimal string, a flag
// that is not a boolean) is refused on either side with the
// checker’s reason, never compared around. Hex case is
// canonicalised by the checker before comparison.
//
// The comparison tracks ONE registration claim, but the claim has
// no action identity of its own — like the binding comparison
// above, any two readable versions compare: the key, the covering
// key, and the registry policy are data the outputs are judged
// against, not an identity a version could drift from.
//
// Eleven positions are compared, in the checker’s own order: the
// status, the expected node NFTs (the registry policy together
// with the two asset names the outputs and the mint must answer
// to — the new node’s NFT named by the key being registered, the
// returned covering node’s by its own key — the requirement
// itself, as the dispatch comparison’s delegate position is),
// the minted-NFT verdict, the two per-output NFT verdicts, the
// two no-other-value verdicts, the two no-reference-script
// verdicts, and the two payment-only-address verdicts. THE
// SUBSTANCE is what is NOT compared as a position. The registry
// policy’s, the key’s, and the covering key’s own changes are
// reported as the breakdown of the expected-NFTs position, never
// counted a second time. The mint’s and each output’s asset lists’
// own changes are reported as the assets added and removed, never
// counted: they are the causes; the verdict positions are the
// consequence — an extra asset joining an output is scored exactly
// once, in that output’s value verdict, and an output’s payment
// hash, stake flag, or reference-script flag changing is reported,
// never counted, its scored consequence being that output’s
// address or reference-script verdict. The new node’s lovelace
// amount is not modeled by the checker and so not compared: the
// spec recommends the protocol minimum, it does not require it.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because
// the outputs gaining or losing a requirement is the headline even
// when the expected NFTs also moved — then STILL NOT CONFORMING
// (not conforming on both sides, but not the same failure: a
// position changed underneath it) and REQUIREMENT CHANGED
// (conforming on both sides, but a position moved — and every
// such move passes through the expected-NFTs position: a registry
// policy re-pointed with the outputs’ payment credentials and
// asset policies following it, or a covering node replaced with
// the returned output’s NFT following it, conforms exactly as
// before while answering to different NFTs; the nine verdicts
// stand true on both sides throughout).
//
// Boundary honesty carries over from the checker: the comparison
// is between the two modeled versions entered. PRISM read no
// transaction and no UTxO and registered nothing, and comparing
// checks neither version and builds no transaction. The list
// mechanics are the insertion family’s position, the datum
// contents the datum checker’s, and the cryptographic binding the
// binding family’s, on both sides alike.
export function diffRegistryInsertOutputs(beforeClaim, afterClaim) {
  const before = checkRegistryInsertOutputs(beforeClaim);
  const after = checkRegistryInsertOutputs(afterClaim);
  const requirementOf = v => ({ registryPolicy: v.registryPolicy, key: v.key, prevKey: v.prevKey });
  const positionOf = v => ({ status: v.status, expectedNfts: requirementOf(v), mintedNft: v.verdicts.mintedNft, prevNft: v.verdicts.prevNft, newNft: v.verdicts.newNft, prevExtraValue: v.verdicts.prevExtraValue, newExtraValue: v.verdicts.newExtraValue, prevNoReferenceScript: v.verdicts.prevNoReferenceScript, newNoReferenceScript: v.verdicts.newNoReferenceScript, prevAddress: v.verdicts.prevAddress, newAddress: v.verdicts.newAddress });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of REGISTRY_INSERT_OUTPUTS_COMPARE_FIELDS) {
    const differs = field === 'expectedNfts' ? JSON.stringify(beforePos[field]) !== JSON.stringify(afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const mintedKey = a => `${a.name}:${a.quantity}`;
  const assetKey = a => `${a.policy}:${a.name}:${a.quantity}`;
  const setDiff = (beforeList, afterList, keyOf) => {
    const b = new Set(beforeList.map(keyOf)), a = new Set(afterList.map(keyOf));
    return { added: [...a].filter(x => !b.has(x)), removed: [...b].filter(x => !a.has(x)) };
  };
  const minted = setDiff(before.minted, after.minted, mintedKey);
  const prevAssets = setDiff(before.prevOutput.assets, after.prevOutput.assets, assetKey);
  const newAssets = setDiff(before.newOutput.assets, after.newOutput.assets, assetKey);
  return {
    change,
    changedFields: differences.map(d => d.label),
    differences,
    registryPolicyChanged: before.registryPolicy !== after.registryPolicy,
    keyChanged: before.key !== after.key,
    prevKeyChanged: before.prevKey !== after.prevKey,
    mintedAdded: minted.added,
    mintedRemoved: minted.removed,
    mintedCountBefore: before.minted.length,
    mintedCountAfter: after.minted.length,
    prevAssetsAdded: prevAssets.added,
    prevAssetsRemoved: prevAssets.removed,
    prevAssetCountBefore: before.prevOutput.assets.length,
    prevAssetCountAfter: after.prevOutput.assets.length,
    newAssetsAdded: newAssets.added,
    newAssetsRemoved: newAssets.removed,
    newAssetCountBefore: before.newOutput.assets.length,
    newAssetCountAfter: after.newOutput.assets.length,
    prevPaymentChanged: before.prevOutput.paymentHash !== after.prevOutput.paymentHash,
    newPaymentChanged: before.newOutput.paymentHash !== after.newOutput.paymentHash,
    prevStakeChanged: before.prevOutput.stakeCredential !== after.prevOutput.stakeCredential,
    newStakeChanged: before.newOutput.stakeCredential !== after.newOutput.stakeCredential,
    prevReferenceScriptChanged: before.prevOutput.referenceScript !== after.prevOutput.referenceScript,
    newReferenceScriptChanged: before.newOutput.referenceScript !== after.newOutput.referenceScript,
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: REGISTRY_INSERT_OUTPUTS_COMPARE_FIELDS.length,
  };
}

// CIP-113 RegistryNode datum checking, modeled locally from the spec's
// datum definition ("RegistryNode datum") and the Foundation reference
// implementation's registry_node module, which pins the two values the
// spec's prose alone leaves ambiguous.
//
// A registry entry is an inline datum of exactly seven fields, IN THIS
// ORDER — the order is load-bearing, because it fixes the Plutus Data
// layout on-chain and off-chain code reads:
//   key, next, minting_logic_script, transfer_logic_script,
//   third_party_logic_script, unfracking_logic_script, global_state_cs
//
// Field rules, as the spec states them and the reference pins them:
// - `key` MUST be a 28-byte bytestring: the token's policy ID, and also
//   the name of the registry NFT in the node's UTxO. The ONE exception is
//   the registry's origin node, whose key is the EMPTY bytestring — the
//   smallest possible value, sorting before every policy ID.
// - `next` MUST be a 28-byte bytestring: the next key in lexicographic
//   order. The ONE exception is the terminal value the last node (and the
//   origin node of an empty registry) points at: the reference
//   implementation's sentinel, THIRTY bytes of 0xff — deliberately not
//   28, because Plutus compares bytestrings byte by byte and treats the
//   longer string as greater when the shared prefix is equal, so the
//   30-byte sentinel sorts strictly after EVERY 28-byte policy ID,
//   including an all-0xff one, which a 28-byte sentinel would collide
//   with. (The spec's datum prose says 28 bytes; the reference code is
//   explicit that the 30-byte length is intentional and load-bearing,
//   and this checker follows the reference where the two differ,
//   saying so here and in the UI.)
// - Each logic field MUST be a Credential: a public-key credential or a
//   script credential carrying a 28-byte hash. The origin node's four
//   credentials are all the empty public-key credential — and the origin
//   node is canonical: the reference holds it as a single equality
//   target, so an empty key with any other field differing is not an
//   origin node, it is a broken datum.
// - `unfracking_logic_script` is the one field where an empty public-key
//   credential is a MEANING on a token node, not a defect: it forbids
//   unfracking for that policy (least permission — no such script
//   exists, so no unfracking transaction can invoke it). A 28-byte
//   public-key credential makes unfracking signature-gated (a withdrawal
//   against a public-key reward account requires that key's signature);
//   a 28-byte script credential delegates the decision to the issuer's
//   hook validator.
// - `global_state_cs` MUST be 0 or 28 bytes: empty means the token has
//   no global state and no reference input is expected for one; a
//   28-byte value is the policy of the NFT marking the global-state
//   UTxO, and every transfer of the token MUST then carry that UTxO as
//   a reference input (spec: "Reference Inputs").
//
// Chain order is a datum rule, not a list rule: `next` names the NEXT
// key in lexicographic order, so it must sort strictly after `key`
// under Plutus bytestring comparison (byte by byte; when the shared
// prefix is equal, the longer bytestring is greater). Equality is a
// failure — a node pointing at itself links nothing.
//
// Refusal vs verdict, as in PRISM's other checkers: a datum that cannot
// be READ — a missing field, an unknown extra field, a credential of an
// unknown kind, a value that is not even-length hexadecimal — is
// REFUSED with the reason, never scored in part. A readable datum whose
// field breaks its rule is SCORED field by field, because the fix
// differs per field.
//
// Boundary honesty: a datum meeting every rule is still not a
// registration. This checker reads no Plutus Data / CBOR, inspects no
// UTxO, and cannot judge the one binding that makes a node trustworthy —
// the registry validator's cryptographic binding of
// `minting_logic_script` to `key` at insertion — nor whether the node
// sits in any real registry, holds the registry NFT, or was written by
// the registry validator at all.
export const REGISTRY_NODE_FIELD_ORDER = Object.freeze(['key', 'next', 'minting_logic_script', 'transfer_logic_script', 'third_party_logic_script', 'unfracking_logic_script', 'global_state_cs']);
export const REGISTRY_SENTINEL_NEXT = 'ff'.repeat(30);
export const REGISTRY_ORIGIN_NODE = Object.freeze({
  key: '', next: REGISTRY_SENTINEL_NEXT,
  minting: Object.freeze({ kind: 'pubkey', hash: '' }),
  transfer: Object.freeze({ kind: 'pubkey', hash: '' }),
  thirdParty: Object.freeze({ kind: 'pubkey', hash: '' }),
  unfracking: Object.freeze({ kind: 'pubkey', hash: '' }),
  globalStateCs: '',
});

function registryBytesHex(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a hexadecimal string — ${value === null ? 'null' : typeof value} given, refused rather than read as bytes.`);
  const v = value.trim().toLowerCase();
  if (!/^([0-9a-f]{2})*$/.test(v)) throw new Error(`${label} is not an even number of hexadecimal characters — ${JSON.stringify(value)} given, refused rather than padded or guessed at.`);
  return v;
}

// Plutus bytestring order: byte by byte; when every shared byte is
// equal, the longer bytestring is the greater one.
function registryBytesCompare(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 2) {
    const d = parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

export function checkRegistryNodeDatum(datum) {
  if (!datum || typeof datum !== 'object' || Array.isArray(datum)) throw new Error('The registry node datum must be an object naming its seven fields — key, next, the four logic credentials, and global_state_cs.');
  const inputFields = ['key', 'next', 'minting', 'transfer', 'thirdParty', 'unfracking', 'globalStateCs'];
  for (const k of Object.keys(datum)) if (!inputFields.includes(k)) throw new Error(`The registry node datum carries an unknown field ${JSON.stringify(k)} — a RegistryNode has exactly seven fields, in the order key, next, minting_logic_script, transfer_logic_script, third_party_logic_script, unfracking_logic_script, global_state_cs.`);
  for (const k of inputFields) if (datum[k] === undefined) throw new Error(`The registry node datum is missing its ${JSON.stringify(k)} field — a datum that cannot be read in full is refused, never scored in part.`);
  const readCredential = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a credential naming a kind (pubkey or script) and a hash.`);
    for (const k of Object.keys(value)) if (k !== 'kind' && k !== 'hash') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a credential names only a kind and a hash.`);
    if (value.kind === undefined || value.hash === undefined) throw new Error(`${label} must name both a kind (pubkey or script) and a hash.`);
    if (value.kind !== 'pubkey' && value.kind !== 'script') throw new Error(`${label}'s kind must be pubkey or script — ${JSON.stringify(value.kind)} given.`);
    return { kind: value.kind, hash: registryBytesHex(value.hash, `${label}'s hash`) };
  };
  const key = registryBytesHex(datum.key, 'Registry node key');
  const next = registryBytesHex(datum.next, 'Registry node next');
  const minting = readCredential(datum.minting, 'Registry node minting_logic_script');
  const transfer = readCredential(datum.transfer, 'Registry node transfer_logic_script');
  const thirdParty = readCredential(datum.thirdParty, 'Registry node third_party_logic_script');
  const unfracking = readCredential(datum.unfracking, 'Registry node unfracking_logic_script');
  const globalStateCs = registryBytesHex(datum.globalStateCs, 'Registry node global_state_cs');
  const creds = { minting, transfer, thirdParty, unfracking };
  const isCanonicalOrigin = key === '' && next === REGISTRY_SENTINEL_NEXT
    && Object.values(creds).every(c => c.kind === 'pubkey' && c.hash === '') && globalStateCs === '';
  const credField = (c, allowEmptyMeaning) => {
    const bytes = c.hash.length / 2;
    const emptyPubkey = bytes === 0 && c.kind === 'pubkey';
    const ok = bytes === 28 || (emptyPubkey && (allowEmptyMeaning || isCanonicalOrigin));
    const detail = bytes === 28 ? `28-byte ${c.kind === 'pubkey' ? 'public-key' : 'script'} credential`
      : emptyPubkey && ok && isCanonicalOrigin && !allowEmptyMeaning ? 'the origin node’s empty public-key credential'
      : emptyPubkey && ok ? 'empty public-key credential'
      : bytes === 0 ? `empty ${c.kind === 'pubkey' ? 'public-key' : 'script'} credential — names no ${c.kind === 'pubkey' ? 'key' : 'script'}`
      : `${bytes}-byte hash — a credential hash is 28 bytes`;
    return { ok, kind: c.kind, hash: c.hash, bytes, detail };
  };
  const fields = {
    key: {
      ok: key.length / 2 === 28 || (key === '' && isCanonicalOrigin),
      bytes: key.length / 2, value: key,
      detail: key.length / 2 === 28 ? '28-byte policy ID'
        : key === '' && isCanonicalOrigin ? 'empty — the origin node’s key, sorting before every policy ID'
        : key === '' ? 'empty — only the canonical origin node carries an empty key, and this datum is not it'
        : `${key.length / 2} bytes — a policy ID is 28 bytes`,
    },
    next: {
      ok: next.length / 2 === 28 || next === REGISTRY_SENTINEL_NEXT,
      bytes: next.length / 2, value: next,
      detail: next === REGISTRY_SENTINEL_NEXT ? 'the 30-byte terminal sentinel — sorts after every 28-byte policy ID'
        : next.length / 2 === 28 ? '28-byte successor key'
        : `${next.length / 2} bytes — next is a 28-byte key or the 30-byte terminal sentinel`,
    },
    minting: credField(minting, false),
    transfer: credField(transfer, false),
    thirdParty: credField(thirdParty, false),
    unfracking: credField(unfracking, true),
    globalStateCs: {
      ok: globalStateCs === '' || globalStateCs.length / 2 === 28,
      bytes: globalStateCs.length / 2, value: globalStateCs,
      detail: globalStateCs === '' ? 'empty — no global state'
        : globalStateCs.length / 2 === 28 ? '28-byte global-state policy'
        : `${globalStateCs.length / 2} bytes — global_state_cs is empty or 28 bytes`,
    },
  };
  const chainOrdered = registryBytesCompare(next, key) > 0;
  const unfrackingMode = !fields.unfracking.ok ? null
    : unfracking.hash === '' ? 'forbidden'
    : unfracking.kind === 'pubkey' ? 'signature-gated' : 'script-delegated';
  const globalState = globalStateCs === '' ? 'none' : globalStateCs.length / 2 === 28 ? 'present' : null;
  const kind = isCanonicalOrigin ? 'origin' : key.length / 2 === 28 ? 'token' : null;
  const valid = Object.values(fields).every(f => f.ok) && chainOrdered;
  return { valid, kind, fields, chainOrdered, unfrackingMode, globalState, fieldOrder: REGISTRY_NODE_FIELD_ORDER, key, next };
}

// The producing half of the registry node datum checker above. Every
// other artifact PRISM can check it can also produce — a design file can
// be exported, a registry preview can be exported, an address can be
// built — but a RegistryNode datum could only be JUDGED: the checker
// reported field verdicts and never handed back the datum itself, in the
// spec's field names and load-bearing order, for a builder to carry into
// their own registration tooling. This builder closes that pair. It
// judges its input by calling checkRegistryNodeDatum itself (the
// validate-once discipline), so builder and checker can never disagree
// about what a datum may say: a readable datum that breaks any field
// rule — or the chain order — is REFUSED with the failing fields named
// in the checker's own words, never built in part, and an unreadable
// datum is refused on the checker's terms. The return carries the
// canonical datum twice: in the checker's own input shape (lowercase
// hex, whitespace trimmed — feeding it back to the checker reproduces
// the same verdict), and serialized under the spec's field names in
// the spec's order (REGISTRY_NODE_FIELD_ORDER), credentials as
// { kind, hash } pairs. The return's exact keys are pinned by test:
// there is no CBOR, no Plutus Data encoding, and no registry NFT in it,
// because building a datum assembles the seven fields as supplied —
// the registry validator's cryptographic binding of the minting logic
// credential to the key, the NFT the node must hold, and the insertion
// itself are registration, and none of them happens here.
export function buildRegistryNodeDatum(datum) {
  const checked = checkRegistryNodeDatum(datum);
  if (!checked.valid) {
    const labels = { key: 'key', next: 'next', minting: 'minting_logic_script', transfer: 'transfer_logic_script', thirdParty: 'third_party_logic_script', unfracking: 'unfracking_logic_script', globalStateCs: 'global_state_cs' };
    const failing = Object.entries(checked.fields).filter(([, f]) => !f.ok).map(([k, f]) => `${labels[k]} — ${f.detail}`);
    if (!checked.chainOrdered) failing.push('chain order — next does not sort strictly after key');
    throw new Error(`The registry node datum is not built — a datum that does not meet the spec is refused, never built in part: ${failing.join('; ')}.`);
  }
  const f = checked.fields;
  const cred = c => ({ kind: c.kind, hash: c.hash });
  const canonical = {
    key: f.key.value, next: f.next.value,
    minting: cred(f.minting), transfer: cred(f.transfer), thirdParty: cred(f.thirdParty), unfracking: cred(f.unfracking),
    globalStateCs: f.globalStateCs.value,
  };
  const serialized = {
    key: canonical.key, next: canonical.next,
    minting_logic_script: cred(f.minting), transfer_logic_script: cred(f.transfer),
    third_party_logic_script: cred(f.thirdParty), unfracking_logic_script: cred(f.unfracking),
    global_state_cs: canonical.globalStateCs,
  };
  return { datum: canonical, serialized, fieldOrder: REGISTRY_NODE_FIELD_ORDER, kind: checked.kind, unfrackingMode: checked.unfrackingMode, globalState: checked.globalState };
}

// The reading-back half of the registry node datum builder above. The
// builder's serialized form is a handoff: it travels — into a builder's
// own registration tooling, a reviewer's message, a saved file — without
// the panel it was built in, and until now PRISM could not read its own
// output back at all. A one-way artifact is a trust surface (the v1.75
// lesson): a handed copy edited after building — a logic credential
// quietly swapped, the successor re-pointed behind the key, a `cbor` or
// registry-NFT field smuggled in beside the seven fields — could not be
// checked in PRISM, only trusted. This parser is that check.
//
// It reads ONLY the serialized form: the seven fields under the spec's
// field names, no other names accepted — the checker's internal input
// shape (minting / transfer / thirdParty / unfracking / globalStateCs)
// is refused here as the unknown-and-missing fields it is, because a
// serialization that renames its fields is a different serialization.
// The field ORDER is part of the reading, for the same reason it is
// part of the writing: the builder's claim is "field names AND order",
// and the order is load-bearing (it fixes the datum's Plutus Data
// layout), so a copy whose fields arrive reordered is refused naming
// the expected order, never silently re-sorted — re-sorting would hide
// exactly the edit a reader pasted the datum in to catch. Each logic
// credential likewise names exactly kind then hash, in that order.
//
// Beyond the serialization's own shape, every judgment is the builder's
// (which is the checker's): the converted datum is built by
// buildRegistryNodeDatum itself, so parse, build, and check can never
// disagree about what a datum may say (validate-once, twentieth
// application). A readable datum breaking any field rule — or the chain
// order — is refused with the failing fields named in the checker's own
// words, never read back in part. The return is the builder's own
// return, key for key: parse(build(x)) is build(x) exactly, pinned by
// test. Boundary honesty carries over: reading a datum back proves
// only that its seven fields meet the spec and round-trip — the JSON
// here is PRISM's serialization, not Plutus Data or CBOR; nothing was
// decoded from a UTxO, no registry NFT was seen, and reading back is
// not registering.
export function parseRegistryNodeDatum(raw) {
  if (typeof raw !== 'string' || raw.length > 100000) throw new Error('Paste a built registry node datum as JSON text under 100 KB — the serialized form the builder above writes.');
  let p;
  try { p = JSON.parse(raw); } catch { throw new Error('This built datum is not valid JSON — a built datum is refused here rather than repaired. Re-copy it from the builder.'); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('A built registry node datum must be a JSON object naming its seven fields in the spec\u2019s order — key, next, minting_logic_script, transfer_logic_script, third_party_logic_script, unfracking_logic_script, global_state_cs.');
  const keys = Object.keys(p);
  for (const k of keys) if (!REGISTRY_NODE_FIELD_ORDER.includes(k)) throw new Error(`The built datum carries an unknown field ${JSON.stringify(k)} — a built RegistryNode datum has exactly seven fields, and PRISM never writes one named that: no CBOR, no datum hash, no registry NFT. Remove it and read the datum again.`);
  for (const k of REGISTRY_NODE_FIELD_ORDER) if (p[k] === undefined) throw new Error(`The built datum is missing its ${JSON.stringify(k)} field — a datum that cannot be read in full is refused, never read back in part.`);
  if (keys.some((k, i) => k !== REGISTRY_NODE_FIELD_ORDER[i])) throw new Error(`The built datum\u2019s fields are out of order — the serialized order is load-bearing (it fixes the datum\u2019s Plutus Data layout) and a reordered copy is refused, never silently re-sorted. Expected order: ${REGISTRY_NODE_FIELD_ORDER.join(', ')}.`);
  const cred = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The built datum\u2019s ${label} must be a credential naming a kind and a hash.`);
    const ck = Object.keys(value);
    for (const k of ck) if (k !== 'kind' && k !== 'hash') throw new Error(`The built datum\u2019s ${label} carries an unknown field ${JSON.stringify(k)} — a credential names only a kind and a hash.`);
    if (value.kind === undefined || value.hash === undefined) throw new Error(`The built datum\u2019s ${label} must name both a kind (pubkey or script) and a hash.`);
    if (ck[0] !== 'kind' || ck[1] !== 'hash') throw new Error(`The built datum\u2019s ${label} names its fields out of order — a serialized credential names kind then hash, in that order.`);
    return { kind: value.kind, hash: value.hash };
  };
  return buildRegistryNodeDatum({
    key: p.key, next: p.next,
    minting: cred(p.minting_logic_script, 'minting_logic_script'),
    transfer: cred(p.transfer_logic_script, 'transfer_logic_script'),
    thirdParty: cred(p.third_party_logic_script, 'third_party_logic_script'),
    unfracking: cred(p.unfracking_logic_script, 'unfracking_logic_script'),
    globalStateCs: p.global_state_cs,
  });
}

// The fields a registry node datum comparison judges, in the order
// differences are reported — the datum's own seven fields, under the
// spec's serialized names. Each logic credential is ONE field: its
// kind and its hash are one credential, so counting them separately
// would double-count a single credential change. The builder's
// derived summaries are NOT fields here: kind is read from the key
// and the node's shape, unfrackingMode from the unfracking field
// alone, and globalState from the global_state_cs field alone, so
// each is identical on both sides exactly when its field is — they
// are what a field MEANS, not how two datums differ. The field order
// likewise cannot differ: the parser refuses a reordered copy and the
// builder writes the spec order, so by comparison time both sides
// carry it by construction.
export const REGISTRY_NODE_COMPARE_FIELDS = Object.freeze([
  ['key', 'Key'],
  ['next', 'Next'],
  ['minting_logic_script', 'Minting logic'],
  ['transfer_logic_script', 'Transfer logic'],
  ['third_party_logic_script', 'Third-party logic'],
  ['unfracking_logic_script', 'Unfracking logic'],
  ['global_state_cs', 'Global state policy'],
]);

// Compare a handed built registry node datum against the node datum
// entered as current, WITHOUT registering or applying anything — the
// comparison counterpart to parseRegistryNodeDatum, as
// diffRegistryDatumPreview is to its verifier and diffDesignFile is
// to verifyManifest. Reading a datum back (v1.85) says whether the
// handed copy is a genuine built datum; this says how the node it
// carries differs from yours, which is the question a reviewer
// returning a built datum actually raises: did the successor move,
// or a logic credential too? The handed side runs exactly the
// reader's checks first — this calls parseRegistryNodeDatum itself,
// so a datum that would fail reading back fails comparison with the
// same reason, refused whole and never partially compared
// (validate-once, twenty-first application). The current side is
// built by buildRegistryNodeDatum itself, and the reader's return
// IS the builder's return, so both sides are the same shape from the
// same builder and comparison can never disagree with reading back,
// building, or checking about what a datum says. Values compare in
// the canonical form both builders write (lowercase hex, whitespace
// trimmed), so a handed copy differing only in hex case compares as
// identical — it says the same datum. The current datum must itself
// build, or there is nothing sound to compare against: its refusal
// is reported as the node's own, wrapped so the failing side is
// named. The return carries the two builder returns and the
// differences only — comparing registers nothing, and neither side's
// datum is applied anywhere by comparing.
export function diffRegistryNodeDatum(raw, currentDatum) {
  if (!currentDatum || typeof currentDatum !== 'object' || Array.isArray(currentDatum)) throw new Error('There is no current node datum to compare against.');
  let current;
  try { current = buildRegistryNodeDatum(currentDatum); }
  catch (e) { throw new Error(`The node entered as current cannot be compared yet — ${e.message}`); }
  const file = parseRegistryNodeDatum(raw);
  const valueOf = (built, field) => {
    switch (field) {
      case 'key': return built.datum.key;
      case 'next': return built.datum.next;
      case 'minting_logic_script': return { ...built.datum.minting };
      case 'transfer_logic_script': return { ...built.datum.transfer };
      case 'third_party_logic_script': return { ...built.datum.thirdParty };
      case 'unfracking_logic_script': return { ...built.datum.unfracking };
      case 'global_state_cs': return built.datum.globalStateCs;
      default: return undefined;
    }
  };
  const sameValue = (a, b) => (a && b && typeof a === 'object' && typeof b === 'object')
    ? a.kind === b.kind && a.hash === b.hash
    : a === b;
  const differences = [];
  for (const [field, label] of REGISTRY_NODE_COMPARE_FIELDS) {
    const fileValue = valueOf(file, field);
    const currentValue = valueOf(current, field);
    if (!sameValue(fileValue, currentValue)) differences.push({ field, label, file: fileValue, current: currentValue });
  }
  return {
    same: differences.length === 0,
    compared: REGISTRY_NODE_COMPARE_FIELDS.length,
    differences,
    fileDatum: file,
    currentDatum: current,
  };
}

// CIP-113 BaseSpendRedeemer hint planning, modeled locally from the
// spec's delegation architecture ("Architecture: Delegation Pattern" and
// "Transaction Construction").
//
// Every programmable-token input a transaction spends runs
// programmableLogicBase once. That validator decides nothing itself: it
// locates the protocol parameters UTxO among the transaction's REFERENCE
// INPUTS, reads the live programmableLogicGlobal credential from that
// UTxO's datum, and requires that credential's withdraw-zero. The base
// input's redeemer is how it finds both things:
//
//   type BaseSpendRedeemer { params_idx: Int, wdrl_idx: Int }
//
// - params_idx is the index of the protocol parameters UTxO in the
//   transaction's reference inputs — in the order the transaction lists
//   them. Reference inputs are NOT reordered by the ledger, so this
//   index is a position in the list as built.
// - wdrl_idx is the index of the programmableLogicGlobal credential's
//   entry in the transaction's WITHDRAWAL MAP — and that map the ledger
//   DOES order: script credentials first, bytewise within each kind,
//   then public-key credentials, bytewise within each kind. The index
//   is therefore a position in the LEDGER-ORDERED map, not in whatever
//   order the builder happened to insert the withdrawals. A builder
//   who counts insertions instead of the ledger order points wdrl_idx
//   at the wrong credential whenever a public-key withdrawal was
//   inserted before a script one, or script credentials were inserted
//   out of byte order — and the base validator resolves the hint to a
//   different credential than the global one and the spend fails.
//
// Both fields are HINTS the validator resolves and then checks, rather
// than values it trusts (spec): a wrong hint resolves to something
// other than what the validator requires and the check fails, so a
// dishonest hint can only invalidate its own transaction. This planner
// computes the two correct hints for a modeled transaction; the
// verifier below judges a claimed pair against the planner's own
// output, so plan and check can never disagree (the validate-once
// discipline of v1.58/v1.64/v1.67, applied to redeemer hints).
//
// Refusal vs unplannable, as in PRISM's other tools: a modeled
// transaction that cannot be READ — a reference input listed twice
// (reference inputs are a set on chain), the same withdrawal credential
// listed twice (a withdrawal map holds each credential once), a
// credential of an unknown kind or with a hash that is not 28 bytes —
// is REFUSED with the reason. A readable transaction that is missing
// one of the two things a hint must point at — the protocol parameters
// UTxO is not among its reference inputs, or the global credential is
// not among its withdrawals (no withdraw-zero for it is executed) —
// is UNPLANNABLE: there is no correct hint to give, and the result
// names what is missing instead of inventing an index.
//
// Boundary honesty: the hints are computed for the modeled lists
// entered. PRISM read no transaction, no protocol parameters UTxO, and
// no chain state: which reference input actually HOLDS the protocol
// parameters NFT, and which credential the parameters datum actually
// names as programmableLogicGlobal today, are deployment data the
// builder supplies here — an upgrade can re-point the global
// credential, and the parameters UTxO, not a cached value, is the
// authority on the current wiring (spec: "Protocol upgradability").
function baseCredential(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a credential naming a kind (pubkey or script) and a hash.`);
  for (const k of Object.keys(value)) if (k !== 'kind' && k !== 'hash') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a credential names only a kind and a hash.`);
  if (value.kind === undefined || value.hash === undefined) throw new Error(`${label} must name both a kind (pubkey or script) and a hash.`);
  if (value.kind !== 'pubkey' && value.kind !== 'script') throw new Error(`${label}'s kind must be pubkey or script — ${JSON.stringify(value.kind)} given.`);
  const hash = registryBytesHex(value.hash, `${label}'s hash`);
  if (hash.length / 2 !== 28) throw new Error(`${label}'s hash must be a 28-byte credential hash (56 hexadecimal characters) — ${hash.length / 2} bytes given.`);
  return { kind: value.kind, hash };
}

function baseReferenceInputs(referenceInputs) {
  if (!Array.isArray(referenceInputs)) throw new Error('The reference inputs must be an array naming each reference input.');
  const refs = referenceInputs.map((r, i) => {
    if (typeof r !== 'string' || !r.trim()) throw new Error(`Reference input ${i + 1} must be a non-empty name — a hint can only point at an input the transaction actually lists.`);
    return r.trim();
  });
  const seen = new Set();
  for (const r of refs) {
    if (seen.has(r)) throw new Error(`Reference input ${JSON.stringify(r)} is listed more than once — reference inputs are a set on chain, so a transaction cannot carry the same input twice and an index into a duplicated list names nothing.`);
    seen.add(r);
  }
  return refs;
}

function baseWithdrawals(withdrawals) {
  if (!Array.isArray(withdrawals)) throw new Error('The withdrawals must be an array of credentials.');
  const list = withdrawals.map((w, i) => baseCredential(w, `Withdrawal ${i + 1}`));
  const seen = new Set();
  for (const w of list) {
    const key = `${w.kind}:${w.hash}`;
    if (seen.has(key)) throw new Error(`Withdrawal credential ${w.hash} (${w.kind}) is listed more than once — a withdrawal map holds each credential once, so an index into a duplicated map names nothing.`);
    seen.add(key);
  }
  return list;
}

// The ledger's withdrawal-map order: script credentials first, then
// public-key credentials, bytewise within each kind (spec, quoted
// above). Hex-string comparison of lowercase 28-byte hashes IS bytewise
// comparison, as registryBytesCompare states for bytestrings.
function ledgerWithdrawalOrder(withdrawals) {
  const rank = c => (c.kind === 'script' ? 0 : 1);
  return [...withdrawals].sort((a, b) => rank(a) - rank(b) || registryBytesCompare(a.hash, b.hash));
}

export function planBaseSpendRedeemer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The redeemer plan needs an object naming the reference inputs, which of them holds the protocol parameters, the withdrawals, and the global credential.');
  for (const k of Object.keys(input)) if (!['referenceInputs', 'paramsRef', 'withdrawals', 'globalCredential'].includes(k)) throw new Error(`The redeemer plan carries an unknown field ${JSON.stringify(k)} — it names only referenceInputs, paramsRef, withdrawals, and globalCredential.`);
  const refs = baseReferenceInputs(input.referenceInputs);
  if (typeof input.paramsRef !== 'string' || !input.paramsRef.trim()) throw new Error('The protocol parameters reference must name one of the reference inputs — the UTxO holding the protocol parameters NFT.');
  const paramsRef = input.paramsRef.trim();
  const withdrawals = baseWithdrawals(input.withdrawals);
  const globalCredential = baseCredential(input.globalCredential, 'The programmableLogicGlobal credential');
  const orderedWithdrawals = ledgerWithdrawalOrder(withdrawals);
  const paramsIndex = refs.indexOf(paramsRef);
  const givenWithdrawalIndex = withdrawals.findIndex(w => w.kind === globalCredential.kind && w.hash === globalCredential.hash);
  const wdrlIndex = orderedWithdrawals.findIndex(w => w.kind === globalCredential.kind && w.hash === globalCredential.hash);
  const missing = [];
  if (paramsIndex === -1) missing.push('params');
  if (wdrlIndex === -1) missing.push('global-withdrawal');
  return {
    status: missing.length ? 'unplannable' : 'planned',
    paramsRef,
    paramsIndex: paramsIndex === -1 ? null : paramsIndex,
    globalCredential,
    wdrlIndex: wdrlIndex === -1 ? null : wdrlIndex,
    givenWithdrawalIndex: givenWithdrawalIndex === -1 ? null : givenWithdrawalIndex,
    orderedWithdrawals,
    referenceCount: refs.length,
    withdrawalCount: withdrawals.length,
    missing,
  };
}

// CIP-113 BaseSpendRedeemer hint verification, checked locally against
// the planner's own output for the same modeled transaction.
//
// Each hint gets its own verdict — params_idx and wdrl_idx — because
// they fail separately and the fix differs: a params_idx pointing at a
// registry node instead of the parameters UTxO, and a wdrl_idx counted
// in insertion order instead of the ledger's withdrawal order, are
// different mistakes in different parts of the transaction. An unstated
// hint (undefined) is 'not-stated' and the claim INCOMPLETE, never a
// pass and never a failure — the v1.67 discipline. A malformed hint (a
// fractional or negative index) is REFUSED, never scored. A modeled
// transaction the planner finds unplannable (no parameters reference,
// no global withdrawal) leaves nothing to score: any claim for it is
// reported UNPLANNABLE with the missing pieces named.
//
// Boundary honesty carries over from the planner: a correct pair proves
// only that the two hints resolve to the modeled parameters input and
// the modeled global credential in the modeled lists entered — PRISM
// read no transaction and no chain state, and the hints alone do not
// make a spend valid: the action delegate, the registry proofs, and
// each registered token's logic withdraw-zero are separate requirements
// this tool does not judge.
export function verifyBaseSpendRedeemer(input, claimed) {
  const plan = planBaseSpendRedeemer(input);
  if (!claimed || typeof claimed !== 'object' || Array.isArray(claimed)) throw new Error('The claimed redeemer must be an object naming a params_idx and a wdrl_idx.');
  for (const k of Object.keys(claimed)) if (!['paramsIdx', 'wdrlIdx'].includes(k)) throw new Error(`The claimed redeemer carries an unknown field ${JSON.stringify(k)} — a BaseSpendRedeemer names only params_idx and wdrl_idx.`);
  const readHint = (value, label) => {
    if (value === undefined) return 'not-stated';
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer — ${JSON.stringify(value)} given, refused rather than rounded.`);
    return value;
  };
  const claimedNorm = { paramsIdx: readHint(claimed.paramsIdx, 'Claimed params_idx'), wdrlIdx: readHint(claimed.wdrlIdx, 'Claimed wdrl_idx') };
  if (plan.status === 'unplannable') {
    return { status: 'unplannable', valid: false, expected: null, claimed: claimedNorm, verdicts: null, missing: plan.missing, paramsRef: plan.paramsRef, globalCredential: plan.globalCredential };
  }
  const expected = { paramsIdx: plan.paramsIndex, wdrlIdx: plan.wdrlIndex };
  const verdicts = {
    paramsIdx: claimedNorm.paramsIdx === 'not-stated' ? 'not-stated' : claimedNorm.paramsIdx === expected.paramsIdx,
    wdrlIdx: claimedNorm.wdrlIdx === 'not-stated' ? 'not-stated' : claimedNorm.wdrlIdx === expected.wdrlIdx,
  };
  const values = Object.values(verdicts);
  const valid = values.every(v => v === true);
  const status = valid ? 'correct' : values.includes(false) ? 'incorrect' : 'incomplete';
  return { status, valid, expected, claimed: claimedNorm, verdicts, missing: [], paramsRef: plan.paramsRef, globalCredential: plan.globalCredential };
}

export const BASE_REDEEMER_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['paramsIdx', 'params_idx'],
  ['wdrlIdx', 'wdrl_idx'],
]);

// CIP-113 BaseSpendRedeemer impact, compared locally between two modeled
// versions of the SAME transaction — the redeemer as planned against the
// transaction as it was, and as planned against the transaction as it
// would be after some other change (a reference input added while
// assembling the transaction, a withdrawal added or reordered, the
// parameters UTxO dropped). The registry families already had this
// temporal half (diffRegistryProofs, diffRegistryInsertion); the base
// redeemer family had only plan → verify, so a builder whose transaction
// changed after they planned its redeemer could not ask which of its two
// hints the change invalidates — and a stale hint does not fail loudly
// here, it resolves to a different input or a different credential and
// the spend fails at the validator.
//
// Both versions are planned through planBaseSpendRedeemer itself
// (validate-once, twenty-third application), so comparison and planning
// can never disagree about either hint in either version, and a version
// that cannot be read (a duplicated reference input, a duplicated
// withdrawal credential, a hash that is not 28 bytes) is refused on
// either side with the planner's reason, never compared around.
//
// The comparison tracks ONE redeemer: the two versions must name the
// same protocol parameters reference and the same
// programmableLogicGlobal credential (compared in the planner's
// canonical form, so hex case alone is the same credential). Different
// targets are different redeemers, and comparing them is refused rather
// than scored — which hint moved is meaningless when the hint's target
// itself changed.
//
// Three positions are compared, in redeemer order: the status and the
// two hints the redeemer actually carries. THE SUBSTANCE is what is NOT
// compared: the plan's givenWithdrawalIndex — the global credential's
// position in INSERTION order — is not carried by the redeemer, and a
// pure reordering of the withdrawal insertions changes it while the
// ledger order, and therefore wdrl_idx, stands exactly still (pinned:
// the reordering compares as unchanged). The ordered withdrawal list is
// likewise derived from the withdrawal set, and the list sizes are
// carried inside the two plans; the lists' own change is reported
// separately as the added/removed reference inputs and withdrawal
// credentials, never counted as positions. The missing set needs no
// position of its own either: which pieces are missing is exactly which
// hints are null, so two unplannable versions with different missing
// pieces differ on the hints alone, never on a phantom fourth field.
//
// The change is classified by its plannability story first — BECAME
// UNPLANNABLE and BECAME PLANNABLE take precedence, because the spend
// gaining or losing its redeemer entirely is the headline even when a
// computable hint also moved — then STILL UNPLANNABLE (unplannable on
// both sides, but not the same unplannable) and HINTS CHANGED (planned
// on both sides, a hint moved).
//
// Boundary honesty carries over from the planner: the comparison is
// between the two modeled versions entered — PRISM read no transaction
// and no chain state, and comparing plans applies neither plan and
// builds no transaction.
export function diffBaseSpendRedeemer(beforeInput, afterInput) {
  const before = planBaseSpendRedeemer(beforeInput);
  const after = planBaseSpendRedeemer(afterInput);
  if (before.paramsRef !== after.paramsRef) throw new Error(`The two modeled transactions name different protocol parameters references — ${JSON.stringify(before.paramsRef)} before and ${JSON.stringify(after.paramsRef)} after. A comparison tracks one redeemer: the parameters reference its params_idx resolves must be the same on both sides.`);
  if (before.globalCredential.kind !== after.globalCredential.kind || before.globalCredential.hash !== after.globalCredential.hash) throw new Error('The two modeled transactions name different programmableLogicGlobal credentials. A comparison tracks one redeemer: the global credential its wdrl_idx resolves must be the same on both sides.');
  const positionOf = plan => ({ status: plan.status, paramsIdx: plan.paramsIndex, wdrlIdx: plan.wdrlIndex });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of BASE_REDEEMER_COMPARE_FIELDS) {
    if (beforePos[field] !== afterPos[field]) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.status === 'planned' && after.status === 'unplannable') change = 'became-unplannable';
  else if (before.status === 'unplannable' && after.status === 'planned') change = 'became-plannable';
  else if (before.status === 'unplannable') change = 'still-unplannable';
  else change = 'hints-changed';
  const beforeRefs = baseReferenceInputs(beforeInput.referenceInputs), afterRefs = baseReferenceInputs(afterInput.referenceInputs);
  const beforeRefSet = new Set(beforeRefs), afterRefSet = new Set(afterRefs);
  const credKey = c => `${c.kind}|${c.hash}`;
  const beforeWds = baseWithdrawals(beforeInput.withdrawals), afterWds = baseWithdrawals(afterInput.withdrawals);
  const beforeWdSet = new Set(beforeWds.map(credKey)), afterWdSet = new Set(afterWds.map(credKey));
  return {
    paramsRef: before.paramsRef,
    globalCredential: before.globalCredential,
    change,
    changedFields: differences.map(d => d.label),
    differences,
    addedRefs: afterRefs.filter(r => !beforeRefSet.has(r)),
    removedRefs: beforeRefs.filter(r => !afterRefSet.has(r)),
    addedWithdrawals: afterWds.filter(c => !beforeWdSet.has(credKey(c))),
    removedWithdrawals: beforeWds.filter(c => !afterWdSet.has(credKey(c))),
    before,
    after,
    unchanged: differences.length === 0,
  };
}

// CIP-113 programmableLogicGlobal dispatch, modeled locally from the
// spec's Layer 2 component list, its Transfer section, and its
// "Architecture: Delegation Pattern" (re-read from the raw upstream
// spec this run): the delegation chain has three links, and this is
// the middle one. programmableLogicBase (the first link, planned and
// verified above) reads the live programmableLogicGlobal credential
// from the protocol parameters datum and requires its withdraw-zero.
// programmableLogicGlobal itself "is a dispatcher, not the validator
// of record": it is parameterized by the credentials of the action
// delegates, reads the declared action from its redeemer, and does
// exactly one thing — require that the delegate for the declared
// action was invoked in this transaction. It "performs no validation
// of its own": every check on the action itself belongs to the third
// link, that action's delegate, judged by the delegate and transfer
// checkers below.
//
// The dispatcher's redeemer arms carry no payload — TransferAct,
// ThirdPartyAct, UnfrackingAct are names, not records. Everything an
// action needs travels in its own delegate's redeemer, and repeating
// any of it in the dispatcher's redeemer would create a second,
// unchecked claim about the same fact. This claim therefore names
// only the declared action, the deployment's delegate wiring, and the
// transaction's withdrawals: an unknown field is refused outright,
// because a dispatcher claim carrying a payload is not a dispatcher
// claim this standard defines.
//
// The delegate wiring is modeled as the three delegate credentials
// the protocol parameters name — the live wiring the upgrade family
// below can re-point — because that datum, not a cached value, is
// the authority on which delegate serves which action today.
//
// One verdict position, because the dispatcher imposes exactly one
// requirement:
// - delegateInvoked: the delegate credential the wiring names for
//   the DECLARED action appears among the modeled withdrawals,
//   kind and hash both — its withdraw-zero invocation in this
//   transaction. The other two delegates are reported with NO
//   verdict (null): the spec requires the declared action's
//   delegate and states no prohibition on another delegate also
//   being invoked, and a requirement the spec does not state gets
//   no failure here — the same asymmetry discipline as the
//   paired-outputs reference script. A transaction in which the
//   wrong delegate was invoked therefore fails on the declared
//   action's absence, never on the other's presence.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown action, an unknown or missing field,
// a wiring object naming anything but the three delegates, a
// delegate credential whose hash is not 28 bytes, a withdrawal
// credential listed twice — is refused, never scored in part. Hex
// case is canonicalised before comparison.
//
// Boundary honesty: these verdicts judge the modeled action,
// wiring, and withdrawals entered. PRISM read no transaction and
// no protocol parameters UTxO: which credential the parameters
// datum names for each action today, and whether the global
// validator deployed for a deployment was really parameterized by
// those delegate credentials at compile time, are deployment facts
// this model does not read. Whether the base validator's hints
// resolve to the parameters UTxO and this global credential's
// withdraw-zero is the base redeemer family's position above;
// everything the invoked delegate then validates — pairing, paired
// outputs, logic execution, registry proofs, authorization — is
// the delegate and transfer checkers' positions below.
export const GLOBAL_DISPATCH_ACTIONS = Object.freeze(['transfer', 'third-party', 'unfracking']);

const GLOBAL_DISPATCH_DELEGATE_FIELDS = Object.freeze({ transfer: 'transfer', 'third-party': 'thirdParty', unfracking: 'unfracking' });

function globalDispatchAction(value) {
  if (!GLOBAL_DISPATCH_ACTIONS.includes(value)) throw new Error(`The declared action must be transfer, third-party, or unfracking — ${JSON.stringify(value)} given. The dispatcher's redeemer names one of the three actions and carries no payload beyond it.`);
  return value;
}

function globalDispatchDelegates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The delegate wiring must be an object naming the transfer, third-party, and unfracking delegate credentials — the wiring the protocol parameters name.');
  const fields = ['transfer', 'thirdParty', 'unfracking'];
  for (const k of Object.keys(value)) if (!fields.includes(k)) throw new Error(`The delegate wiring carries an unknown field ${JSON.stringify(k)} — it names only the transfer, third-party, and unfracking delegates.`);
  for (const k of fields) if (value[k] === undefined) throw new Error(`The delegate wiring is missing its ${JSON.stringify(k)} delegate — wiring that cannot be read in full is refused, never scored in part.`);
  return {
    transfer: baseCredential(value.transfer, 'The transfer delegate credential'),
    thirdParty: baseCredential(value.thirdParty, 'The third-party delegate credential'),
    unfracking: baseCredential(value.unfracking, 'The unfracking delegate credential'),
  };
}

export function checkGlobalDispatch(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The dispatch claim must be an object naming the declared action, the delegate wiring, and the transaction\u2019s withdrawals.');
  const inputFields = ['action', 'delegates', 'withdrawals'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The dispatch claim carries an unknown field ${JSON.stringify(k)} — the dispatcher's redeemer arms carry no payload, so a dispatch claim names only the declared action, the delegate wiring, and the withdrawals.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The dispatch claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const action = globalDispatchAction(claim.action);
  const delegates = globalDispatchDelegates(claim.delegates);
  const withdrawals = baseWithdrawals(claim.withdrawals);
  const inWithdrawals = c => withdrawals.some(w => w.kind === c.kind && w.hash === c.hash);
  const delegate = delegates[GLOBAL_DISPATCH_DELEGATE_FIELDS[action]];
  const delegateInvoked = inWithdrawals(delegate);
  const otherDelegates = GLOBAL_DISPATCH_ACTIONS.filter(a => a !== action).map(a => {
    const credential = delegates[GLOBAL_DISPATCH_DELEGATE_FIELDS[a]];
    return { action: a, credential, invoked: inWithdrawals(credential) };
  });
  const valid = delegateInvoked;
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    action,
    delegates,
    delegate,
    delegateInvoked,
    otherDelegates,
    withdrawals,
    verdicts: { delegateInvoked, otherDelegatesInvoked: null },
  };
}

export const GLOBAL_DISPATCH_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['delegate', 'Declared action\u2019s delegate'],
  ['delegateInvoked', 'Delegate invoked'],
]);

// CIP-113 programmableLogicGlobal dispatch impact, compared locally
// between two modeled versions of the SAME dispatch — the dispatch as
// checked against the wiring and withdrawals as they stood, and as it
// would stand after some other change (a protocol upgrade re-pointing
// a delegate in the parameters, a withdrawal added or dropped while
// assembling the transaction). The registry, base redeemer, delegate
// pairing, transfer output-value, and protocol upgrade families
// already had this temporal half; the dispatch family, shipped as a
// single checker, had only the check, so a builder whose dispatch
// conformed when they modeled it could not ask what a later change
// did to it — and the spec's own consequence for integrators is
// exactly this staleness: because delegate credentials are read live,
// "an integrator holding a programmable token cannot assume that the
// logic which validated a past transfer is the logic that will
// validate the next one" (spec: Protocol upgradability, Consequences
// for integrators, re-read this run from the raw upstream spec).
//
// Both versions are checked through checkGlobalDispatch itself
// (validate-once, twenty-seventh application), so comparison and
// checking can never disagree about either version, and a version
// that cannot be read (an unknown action, a payload on the claim,
// incomplete wiring, a duplicated withdrawal) is refused on either
// side with the checker's reason, never compared around.
//
// The comparison tracks ONE dispatch: the two versions must declare
// the same action. A TransferAct dispatch and a ThirdPartyAct
// dispatch are different redeemer arms of the same validator, and
// which delegate moved is meaningless when the declared action
// itself changed — refused, never scored.
//
// Three positions are compared, in the checker's own order: the
// status, the delegate credential the wiring names for the declared
// action, and the one verdict (that delegate invoked). THE SUBSTANCE
// is what is NOT compared as a position. The other two delegates'
// wiring is reported separately as wiringChangedFields, never
// counted: re-pointing an undeclared action's delegate moves no
// position of THIS dispatch — its requirement reads only its own
// action's field — though it is exactly the change that would stale
// a dispatch declaring that other action (pinned). The other
// delegates' invocation is likewise reported separately as
// otherDelegatesChanged, never counted: the checker gives it NO
// verdict, so a comparison that counted it would invent the
// prohibition the checker refuses to invent. The withdrawal list's
// own change is reported as the added/removed withdrawal
// credentials, never counted.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because the
// dispatch gaining or losing its one requirement is the headline
// even when the required delegate also moved — then STILL NOT
// CONFORMING (not conforming on both sides, but not the same
// failure: the required delegate changed underneath it) and
// REQUIREMENT CHANGED (conforming on both sides, but the delegate
// the wiring requires is a different credential — the dispatch
// survives, and what validates the action is no longer what
// validated it before).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no protocol parameters UTxO, and no chain state, and
// comparing checks neither version and builds no transaction.
export function diffGlobalDispatch(beforeClaim, afterClaim) {
  const before = checkGlobalDispatch(beforeClaim);
  const after = checkGlobalDispatch(afterClaim);
  if (before.action !== after.action) throw new Error(`The two modeled dispatches declare different actions \u2014 ${JSON.stringify(before.action)} before and ${JSON.stringify(after.action)} after. A comparison tracks one dispatch: the declared action is the dispatcher's redeemer arm, and a different arm is a different dispatch.`);
  const sameCred = (a, b) => a.kind === b.kind && a.hash === b.hash;
  const positionOf = v => ({ status: v.status, delegate: v.delegate, delegateInvoked: v.delegateInvoked });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of GLOBAL_DISPATCH_COMPARE_FIELDS) {
    const differs = field === 'delegate' ? !sameCred(beforePos[field], afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const wiringFields = [['transfer', 'transfer'], ['thirdParty', 'third-party'], ['unfracking', 'unfracking']];
  const wiringChangedFields = wiringFields.filter(([k]) => !sameCred(before.delegates[k], after.delegates[k])).map(([, a]) => a);
  const credKey = c => `${c.kind}|${c.hash}`;
  const beforeWdSet = new Set(before.withdrawals.map(credKey)), afterWdSet = new Set(after.withdrawals.map(credKey));
  const otherDelegatesChanged = before.otherDelegates.some((o, i) => o.invoked !== after.otherDelegates[i].invoked);
  return {
    action: before.action,
    change,
    changedFields: differences.map(d => d.label),
    differences,
    wiringChangedFields,
    addedWithdrawals: after.withdrawals.filter(c => !beforeWdSet.has(credKey(c))),
    removedWithdrawals: before.withdrawals.filter(c => !afterWdSet.has(credKey(c))),
    otherDelegatesChanged,
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: GLOBAL_DISPATCH_COMPARE_FIELDS.length,
  };
}

// CIP-113 action-delegate pairing planning, modeled locally from the
// spec's ThirdPartyAct and UnfrackingAct sections.
//
// TransferAct is not the only action. ThirdPartyAct (an action on a
// holder's tokens without their consent, as the token's substandard
// permits — seizure is the common case) and UnfrackingAct (the holder
// restructuring their own UTxOs for one policy, ownership unchanged)
// each carry a delegate redeemer of the same shape:
//
//   type ThirdPartyRedeemer { registry_node_idx: Int, outputs_start_idx: Int }
//   type UnfrackingRedeemer { registry_node_idx: Int, outputs_start_idx: Int }
//
// - registry_node_idx is the index, in the transaction's REFERENCE
//   INPUTS as listed, of the RegistryNode for the policy being acted
//   on. Like params_idx, it counts the list as built — reference
//   inputs are not reordered by the ledger.
// - outputs_start_idx is the index in tx.outputs at which the paired
//   continuing outputs begin. The delegate walks tx.inputs IN ORDER:
//   every input at a programmableLogicBase address is paired with the
//   next consecutive output starting from outputs_start_idx, and
//   inputs at other addresses are skipped and consume no output. The
//   n-th base input encountered is therefore paired with
//   outputs[outputs_start_idx + n]. Outputs before outputs_start_idx
//   are paired with nothing — but for a third-party action, any of the
//   acted-on policy's tokens they hold at base addresses still count
//   toward the output side of that action's balance invariant, which
//   is what lets a third-party action share a transaction with other
//   actions that produce earlier base outputs.
//
// The trap this planner exists to prevent is counting inputs instead
// of BASE inputs: a builder who pairs the k-th input with
// outputs[start + k] misaligns every pair after the first non-base
// input, and the delegate then compares each continuing output
// against the wrong input — same-address and same-datum checks fail,
// or worse, pass against a different UTxO than the one being acted on.
// The two hints are again hints the delegate resolves and checks, not
// values it trusts. The verifier below judges a claimed redeemer
// against this planner's own output (validate-once discipline).
//
// Refusal vs unplannable: a modeled transaction that cannot be READ —
// an unknown action, a duplicated reference input, an input or output
// entry that does not say whether it sits at a base address, a start
// index that is fractional or negative — is REFUSED. A readable
// transaction whose pairing cannot be completed — the acted-on
// policy's RegistryNode is not among the reference inputs, the start
// index points past the last output, or there are fewer outputs from
// the start than base inputs to pair — is UNPLANNABLE, naming what is
// missing and inventing no index and no pair.
//
// Boundary honesty: the pairing is computed for the modeled lists
// entered, in which each input and output is reduced to the one fact
// the pairing consumes — whether it sits at a programmableLogicBase
// address. PRISM read no transaction and no registry, and the pairing
// alone does not make an action valid: whether each paired output
// keeps its input's address and datum, keeps every other policy's
// tokens byte-identical, actually changes the acted-on policy's
// tokens (third-party) or strips that policy entirely (unfracking),
// and satisfies the balance invariant are the delegate's checks
// against the real values, which this model does not carry — those
// paired-output positions are judged locally by
// checkDelegatePairedOutputs below, against modeled UTxO values this
// planner does not carry. Whether the token's logic script executed
// via withdraw-zero (and, for unfracking, whether the holder
// authorised the action) is judged by checkDelegateLogicExecution,
// below the paired-outputs checker.
function delegateAction(value) {
  if (value !== 'third-party' && value !== 'unfracking') throw new Error(`The delegate action must be third-party or unfracking — ${JSON.stringify(value)} given. TransferAct carries registry proofs instead (the proof planner above), not a pairing redeemer.`);
  return value;
}

function delegateEntries(value, label) {
  if (!Array.isArray(value)) throw new Error(`The ${label} must be an array, one entry per ${label === 'inputs' ? 'input' : 'output'} in transaction order.`);
  return value.map((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${label === 'inputs' ? 'Input' : 'Output'} ${i + 1} must be an object saying whether it sits at a programmableLogicBase address.`);
    for (const k of Object.keys(e)) if (k !== 'atBase') throw new Error(`${label === 'inputs' ? 'Input' : 'Output'} ${i + 1} carries an unknown field ${JSON.stringify(k)} — the pairing reads only whether it sits at a base address.`);
    if (typeof e.atBase !== 'boolean') throw new Error(`${label === 'inputs' ? 'Input' : 'Output'} ${i + 1} must say, as a boolean, whether it sits at a programmableLogicBase address — the pairing turns on exactly that fact.`);
    return { atBase: e.atBase };
  });
}

function delegateStartIndex(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`outputs_start_idx must be a non-negative integer — ${JSON.stringify(value)} given, refused rather than rounded.`);
  return value;
}

export function planDelegatePairing(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The pairing plan needs an object naming the action, the reference inputs, which of them is the acted-on policy\u2019s RegistryNode, the inputs, the outputs, and where the paired outputs start.');
  for (const k of Object.keys(input)) if (!['action', 'referenceInputs', 'registryNodeRef', 'inputs', 'outputs', 'outputsStartIdx'].includes(k)) throw new Error(`The pairing plan carries an unknown field ${JSON.stringify(k)} — it names only action, referenceInputs, registryNodeRef, inputs, outputs, and outputsStartIdx.`);
  const action = delegateAction(input.action);
  const refs = baseReferenceInputs(input.referenceInputs);
  if (typeof input.registryNodeRef !== 'string' || !input.registryNodeRef.trim()) throw new Error('The registry node reference must name one of the reference inputs — the RegistryNode of the policy being acted on.');
  const registryNodeRef = input.registryNodeRef.trim();
  const inputs = delegateEntries(input.inputs, 'inputs');
  const outputs = delegateEntries(input.outputs, 'outputs');
  const outputsStartIdx = delegateStartIndex(input.outputsStartIdx);
  const registryNodeIndex = refs.indexOf(registryNodeRef);
  const baseInputIndexes = inputs.map((e, i) => (e.atBase ? i : -1)).filter(i => i !== -1);
  const pairs = baseInputIndexes.map((inputIndex, n) => ({ baseOrdinal: n, inputIndex, outputIndex: outputsStartIdx + n }));
  const missing = [];
  if (registryNodeIndex === -1) missing.push('registry-node');
  let shortfall = 0;
  if (outputsStartIdx > outputs.length) missing.push('outputs-start');
  else if (outputsStartIdx + pairs.length > outputs.length) { missing.push('paired-outputs'); shortfall = outputsStartIdx + pairs.length - outputs.length; }
  const plannable = missing.length === 0;
  return {
    status: plannable ? 'planned' : 'unplannable',
    action,
    registryNodeRef,
    registryNodeIndex: registryNodeIndex === -1 ? null : registryNodeIndex,
    outputsStartIdx,
    pairs: plannable ? pairs : [],
    baseInputCount: pairs.length,
    skippedInputCount: inputs.length - pairs.length,
    inputCount: inputs.length,
    outputCount: outputs.length,
    referenceCount: refs.length,
    earlyOutputCount: Math.min(outputsStartIdx, outputs.length),
    earlyBaseOutputCount: outputs.slice(0, outputsStartIdx).filter(e => e.atBase).length,
    trailingOutputCount: plannable ? outputs.length - (outputsStartIdx + pairs.length) : 0,
    missing,
    shortfall,
  };
}

// CIP-113 delegate redeemer verification, checked locally against the
// pairing planner's own output for the same modeled transaction.
//
// Each hint gets its own verdict — registry_node_idx and
// outputs_start_idx — because they fail separately: a node index
// pointing at the wrong reference input makes the delegate read a
// different policy's configuration, while a start index off by one
// shifts EVERY pair by one output, so each continuing output is
// compared against the wrong input. An unstated hint (undefined) is
// 'not-stated' and the claim INCOMPLETE; a malformed hint is REFUSED.
// A transaction the planner finds unplannable leaves nothing to
// score: any claim for it is reported UNPLANNABLE with the missing
// pieces named. Boundary honesty carries over from the planner.
export function verifyDelegatePairing(input, claimed) {
  const plan = planDelegatePairing(input);
  if (!claimed || typeof claimed !== 'object' || Array.isArray(claimed)) throw new Error('The claimed redeemer must be an object naming a registry_node_idx and an outputs_start_idx.');
  for (const k of Object.keys(claimed)) if (!['registryNodeIdx', 'outputsStartIdx'].includes(k)) throw new Error(`The claimed redeemer carries an unknown field ${JSON.stringify(k)} — a delegate redeemer names only registry_node_idx and outputs_start_idx.`);
  const readHint = (value, label) => {
    if (value === undefined) return 'not-stated';
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer — ${JSON.stringify(value)} given, refused rather than rounded.`);
    return value;
  };
  const claimedNorm = { registryNodeIdx: readHint(claimed.registryNodeIdx, 'Claimed registry_node_idx'), outputsStartIdx: readHint(claimed.outputsStartIdx, 'Claimed outputs_start_idx') };
  if (plan.status === 'unplannable') {
    return { status: 'unplannable', valid: false, expected: null, claimed: claimedNorm, verdicts: null, missing: plan.missing, shortfall: plan.shortfall, action: plan.action, registryNodeRef: plan.registryNodeRef };
  }
  const expected = { registryNodeIdx: plan.registryNodeIndex, outputsStartIdx: plan.outputsStartIdx };
  const verdicts = {
    registryNodeIdx: claimedNorm.registryNodeIdx === 'not-stated' ? 'not-stated' : claimedNorm.registryNodeIdx === expected.registryNodeIdx,
    outputsStartIdx: claimedNorm.outputsStartIdx === 'not-stated' ? 'not-stated' : claimedNorm.outputsStartIdx === expected.outputsStartIdx,
  };
  const values = Object.values(verdicts);
  const valid = values.every(v => v === true);
  const status = valid ? 'correct' : values.includes(false) ? 'incorrect' : 'incomplete';
  return { status, valid, expected, claimed: claimedNorm, verdicts, missing: [], shortfall: 0, action: plan.action, registryNodeRef: plan.registryNodeRef, pairs: plan.pairs };
}

export const DELEGATE_PAIRING_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['registryNodeIdx', 'registry_node_idx'],
  ['outputsStartIdx', 'outputs_start_idx'],
]);

// CIP-113 delegate pairing impact, compared locally between two modeled
// versions of the SAME action — the pairing as planned against the
// transaction as it was, and as planned against the transaction as it
// would be after some other change (a reference input added while
// assembling the transaction, an input or output joining, the start
// index adjusted, the acted-on policy's RegistryNode dropped). The
// registry and base redeemer families already had this temporal half
// (diffRegistryProofs, diffRegistryInsertion, diffBaseSpendRedeemer);
// the delegate pairing family had only plan → verify, so a builder
// whose transaction changed after they planned its delegate redeemer
// could not ask which of its two hints the change invalidates — and a
// stale hint does not fail loudly here, it makes the delegate read a
// different node's configuration or compare every continuing output
// against the wrong input.
//
// Both versions are planned through planDelegatePairing itself
// (validate-once, twenty-fourth application), so comparison and
// planning can never disagree about either hint in either version, and
// a version that cannot be read (an unknown action, a duplicated
// reference input, an entry that does not say whether it sits at a
// base address, a fractional start index) is refused on either side
// with the planner's reason, never compared around.
//
// The comparison tracks ONE redeemer: the two versions must name the
// same action and the same acted-on policy's RegistryNode. A
// third-party redeemer and an unfracking redeemer share a shape but
// are not the same redeemer, and a node reference that changed is a
// different target — both are refused, never scored.
//
// Three positions are compared, in redeemer order: the status and the
// two hints the redeemer actually carries. THE SUBSTANCE is what is
// NOT compared: the pairs themselves. A pair list is derived — the
// delegate walks the inputs in order and pairs each base input with
// the next output from outputs_start_idx — so it is not carried by
// the redeemer, and a change that adds a base input (with the outputs
// to pair it) or inserts a non-base input ahead of the base ones
// changes the pairs while both hints stand exactly still: the new
// base input pairs automatically, and the shifted input positions
// move no output index (pinned). That pairing change is reported
// separately as pairsChanged, never counted as a position. The early
// and trailing output counts and the shortfall are likewise derived
// summaries carried inside the two plans; which pieces are missing
// needs no position of its own either — a missing registry node is
// exactly a null registry_node_idx, and a shortfall of outputs
// differs on the status alone, because neither hint is invented for
// an unplannable pairing. The reference list's own change is reported
// as the added/removed reference inputs, never counted.
//
// The change is classified by its plannability story first — BECAME
// UNPLANNABLE and BECAME PLANNABLE take precedence, because the
// action gaining or losing its pairing entirely is the headline even
// when a computable hint also moved — then STILL UNPLANNABLE
// (unplannable on both sides, but not the same unplannable) and HINTS
// CHANGED (planned on both sides, a hint moved).
//
// Boundary honesty carries over from the planner: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no registry, and no chain state, and comparing plans
// applies neither plan and builds no transaction.
export function diffDelegatePairing(beforeInput, afterInput) {
  const before = planDelegatePairing(beforeInput);
  const after = planDelegatePairing(afterInput);
  if (before.action !== after.action) throw new Error(`The two modeled transactions name different delegate actions — ${JSON.stringify(before.action)} before and ${JSON.stringify(after.action)} after. A comparison tracks one redeemer: a third-party redeemer and an unfracking redeemer share a shape, but they are not the same redeemer.`);
  if (before.registryNodeRef !== after.registryNodeRef) throw new Error(`The two modeled transactions name different registry node references — ${JSON.stringify(before.registryNodeRef)} before and ${JSON.stringify(after.registryNodeRef)} after. A comparison tracks one redeemer: the RegistryNode its registry_node_idx resolves must be the same on both sides.`);
  const positionOf = plan => ({ status: plan.status, registryNodeIdx: plan.registryNodeIndex, outputsStartIdx: plan.outputsStartIdx });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of DELEGATE_PAIRING_COMPARE_FIELDS) {
    if (beforePos[field] !== afterPos[field]) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.status === 'planned' && after.status === 'unplannable') change = 'became-unplannable';
  else if (before.status === 'unplannable' && after.status === 'planned') change = 'became-plannable';
  else if (before.status === 'unplannable') change = 'still-unplannable';
  else change = 'hints-changed';
  const beforeRefs = baseReferenceInputs(beforeInput.referenceInputs), afterRefs = baseReferenceInputs(afterInput.referenceInputs);
  const beforeRefSet = new Set(beforeRefs), afterRefSet = new Set(afterRefs);
  const pairKey = p => `${p.inputIndex}->${p.outputIndex}`;
  const pairsChanged = before.pairs.length !== after.pairs.length || before.pairs.some((p, i) => pairKey(p) !== pairKey(after.pairs[i]));
  return {
    action: before.action,
    registryNodeRef: before.registryNodeRef,
    change,
    changedFields: differences.map(d => d.label),
    differences,
    addedRefs: afterRefs.filter(r => !beforeRefSet.has(r)),
    removedRefs: beforeRefs.filter(r => !afterRefSet.has(r)),
    pairsChanged,
    before,
    after,
    unchanged: differences.length === 0,
  };
}

// CIP-113 TransferAct output-value calculation, modeled locally from
// the spec's "Output Value Calculation" and "Output Validation"
// sections (TransferAct constructor).
//
// The transfer delegate does not ask where each token went, pair by
// pair. It computes ONE expected value and checks the transaction's
// outputs at programmableLogicBase addresses against it, per asset:
//
//   expected = validated input value + validated mint value
//
// - VALIDATED INPUT value: the quantities of a programmable asset in
//   the UTxOs spent from programmableLogicBase, summed per asset
//   (policy + asset name). Several spent UTxOs can hold the same
//   asset; their quantities add — inputs are a list of UTxOs, not a
//   value map, so duplicate input entries SUM here.
// - VALIDATED MINT value: tx.mint for that asset, SIGNED — a mint
//   adds, a burn subtracts. The spec's own examples: input 100, burn
//   30, expected output 70; input 100, mint 50, expected output 150.
//   A mint-only asset (nothing spent) has expected = its mint: mint
//   value is folded into the same accumulator as spent value, which
//   is also why the registry proofs cover minted and burned policies
//   alike. tx.mint IS a value map — one entry per asset — so a
//   modeled mint listing the same asset twice cannot be read as a
//   mint at all and is REFUSED, never summed.
// - VALIDATED is the load-bearing word: only policies proven
//   registered (a TokenExists registry proof) enter the accumulator.
//   A policy proven absent is treated as an ordinary native token and
//   its input and mint quantities are reported as EXCLUDED, never
//   counted — a planner that summed every policy it was handed would
//   overstate the expected programmable output by exactly the
//   ordinary tokens' amounts, and the delegate would demand base
//   outputs no honest transfer owes.
// - Quantities are decimal strings parsed as BigInt end to end: a
//   JavaScript number cannot name every int64 quantity, so a numeric
//   quantity is REFUSED rather than rounded. An input quantity must
//   be positive (a UTxO does not list an asset it holds none of); a
//   mint quantity must be non-zero (a mint entry moves supply or it
//   is not an entry); each modeled quantity is bounded by the signed
//   64-bit asset ceiling this studio models (MAX_ASSET).
//
// A burn larger than the validated input for an asset makes the
// expected value negative — no output can contain a negative amount,
// so that modeled transfer is UNPLANNABLE with the offending assets
// named and the (negative) arithmetic still shown; nothing is
// clipped to zero, because a clipped expectation would bless a
// transfer that tries to burn tokens it does not hold.
//
// Boundary honesty: the expected value is computed against the
// modeled lists entered — PRISM read no transaction, no UTxO, and no
// chain state, and the "validated" policies here are the ones the
// model is TOLD were proven registered; whether a real transaction's
// proofs actually validate them is not judged here, and whether each
// token's transfer logic executed via withdraw-zero and the holder
// authorized the spend are judged by checkTransferAuthorization.
function transferAssetName(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be the asset name as a hexadecimal string (empty for the unnamed asset).`);
  const v = value.trim().toLowerCase();
  if (!/^(?:[a-f0-9]{2})*$/.test(v)) throw new Error(`${label} is not an even number of hexadecimal characters — ${JSON.stringify(value)} given.`);
  if (v.length > 64) throw new Error(`${label} is ${v.length / 2} bytes — an asset name is at most 32 bytes.`);
  return v;
}

function transferQuantity(value, label, { signed }) {
  if (typeof value !== 'string') throw new Error(`${label} must be a decimal string — a JavaScript number cannot name every int64 quantity exactly, so a numeric quantity is refused rather than rounded.`);
  const v = value.trim();
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(v)) throw new Error(`${label} must be a ${signed ? 'signed ' : ''}whole-number decimal string — ${JSON.stringify(value)} given, refused rather than rounded.`);
  const n = BigInt(v);
  if (signed && n === 0n) throw new Error(`${label} is zero — a mint entry either mints or burns; a zero entry is not an entry in tx.mint.`);
  if (!signed && n === 0n) throw new Error(`${label} is zero — a spent UTxO does not list an asset it holds none of.`);
  if ((n < 0n ? -n : n) > MAX_ASSET) throw new Error(`${label} exceeds the signed 64-bit asset ceiling this studio models (${MAX_ASSET.toString()} base units).`);
  return n;
}

function transferValueEntries(value, label, kind) {
  if (!Array.isArray(value)) throw new Error(`The ${label} must be an array, one entry per ${kind === 'inputs' ? 'spent UTxO holding' : kind === 'mint' ? 'minted or burned' : 'output holding'} asset.`);
  return value.map((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${label === 'inputs' ? 'Input' : label === 'mint' ? 'Mint' : 'Output'} entry ${i + 1} must be an object naming a policy, an asset name, and a quantity${kind === 'outputs' ? ', and whether the output sits at a base address' : ''}.`);
    const fields = kind === 'outputs' ? ['policy', 'assetName', 'quantity', 'atBase'] : ['policy', 'assetName', 'quantity'];
    for (const k of Object.keys(e)) if (!fields.includes(k)) throw new Error(`${label === 'inputs' ? 'Input' : label === 'mint' ? 'Mint' : 'Output'} entry ${i + 1} carries an unknown field ${JSON.stringify(k)} — it names only ${fields.join(', ')}.`);
    const entry = {
      policy: registryPolicyId(e.policy, `${label === 'inputs' ? 'Input' : label === 'mint' ? 'Mint' : 'Output'} entry ${i + 1}'s policy`),
      assetName: transferAssetName(e.assetName, `${label === 'inputs' ? 'Input' : label === 'mint' ? 'Mint' : 'Output'} entry ${i + 1}'s asset name`),
      quantity: transferQuantity(e.quantity, `${label === 'inputs' ? 'Input' : label === 'mint' ? 'Mint' : 'Output'} entry ${i + 1}'s quantity`, { signed: kind === 'mint' }),
    };
    if (kind === 'outputs') {
      if (typeof e.atBase !== 'boolean') throw new Error(`Output entry ${i + 1} must say, as a boolean, whether the output sits at a programmableLogicBase address — where an output sits is what this check turns on.`);
      entry.atBase = e.atBase;
    }
    return entry;
  });
}

function aggregateValue(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = `${e.policy}|${e.assetName}`;
    const cur = map.get(key) ?? { policy: e.policy, assetName: e.assetName, quantity: 0n };
    cur.quantity += e.quantity;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : a.assetName < b.assetName ? -1 : a.assetName > b.assetName ? 1 : 0));
}

export function planTransferOutputValue(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The output-value plan needs an object naming the validated (proven-registered) policies, the input value spent from base addresses, and the transaction mint value.');
  for (const k of Object.keys(input)) if (!['validatedPolicies', 'inputs', 'mint'].includes(k)) throw new Error(`The output-value plan carries an unknown field ${JSON.stringify(k)} — it names only validatedPolicies, inputs, and mint.`);
  if (!Array.isArray(input.validatedPolicies)) throw new Error('The validated policies must be an array of policy IDs — the policies a TokenExists registry proof validated.');
  const validatedPolicies = input.validatedPolicies.map((p, i) => registryPolicyId(p, `Validated policy ${i + 1}`));
  for (let i = 0; i < validatedPolicies.length; i++) if (validatedPolicies.indexOf(validatedPolicies[i]) !== i) throw new Error(`Validated policies must be unique: ${validatedPolicies[i]} appears more than once — a policy is proven registered once, or not at all.`);
  const validated = new Set(validatedPolicies);
  const inputs = transferValueEntries(input.inputs, 'inputs', 'inputs');
  const mint = transferValueEntries(input.mint, 'mint', 'mint');
  const mintKeys = new Set();
  for (const e of mint) {
    const key = `${e.policy}|${e.assetName}`;
    if (mintKeys.has(key)) throw new Error(`The mint lists policy ${e.policy} asset ${e.assetName || '(unnamed)'} more than once — tx.mint is a value map and holds each asset once; the two entries cannot be read as one mint.`);
    mintKeys.add(key);
  }
  const aggInputs = aggregateValue(inputs);
  const aggMint = aggregateValue(mint);
  const byKey = new Map();
  for (const e of aggInputs) byKey.set(`${e.policy}|${e.assetName}`, { policy: e.policy, assetName: e.assetName, inputQuantity: e.quantity, mintQuantity: 0n });
  for (const e of aggMint) {
    const key = `${e.policy}|${e.assetName}`;
    const cur = byKey.get(key) ?? { policy: e.policy, assetName: e.assetName, inputQuantity: 0n, mintQuantity: 0n };
    cur.mintQuantity = e.quantity;
    byKey.set(key, cur);
  }
  const all = [...byKey.values()].sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : a.assetName < b.assetName ? -1 : a.assetName > b.assetName ? 1 : 0));
  const render = e => ({ policy: e.policy, assetName: e.assetName, inputQuantity: e.inputQuantity.toString(), mintQuantity: e.mintQuantity.toString(), expectedQuantity: (e.inputQuantity + e.mintQuantity).toString() });
  const entries = all.filter(e => validated.has(e.policy)).map(render);
  const excluded = all.filter(e => !validated.has(e.policy)).map(e => ({ policy: e.policy, assetName: e.assetName, inputQuantity: e.inputQuantity.toString(), mintQuantity: e.mintQuantity.toString() }));
  const impossible = entries.filter(e => BigInt(e.expectedQuantity) < 0n).map(e => ({ policy: e.policy, assetName: e.assetName, expectedQuantity: e.expectedQuantity }));
  return {
    status: impossible.length ? 'unplannable' : 'planned',
    validatedPolicies,
    entries,
    excluded,
    impossible,
    missing: impossible.length ? ['burn-exceeds-input'] : [],
    inputEntryCount: inputs.length,
    mintEntryCount: mint.length,
  };
}

// CIP-113 TransferAct output verification, checked locally against the
// planner's own expected value for the same modeled transaction
// (validate-once discipline: the expected values below ARE
// planTransferOutputValue's output, so plan and check cannot drift).
//
// The delegate's output validation has TWO requirements, and each
// modeled asset gets both verdicts because they fail separately and
// the fix differs:
// - AT LEAST THE EXPECTED VALUE AT BASE: the total of the asset
//   across outputs at programmableLogicBase addresses is >= the
//   expected value. AT LEAST is the spec's word — a base total above
//   expected PASSES this check (the surplus is reported, not failed):
//   the delegate's check is a floor that keeps programmable value
//   from leaking away, and the ledger's own value-preservation rule —
//   not modeled or judged here — is what forbids creating value from
//   nothing. A shortfall names exactly how much is missing.
// - NOTHING PROGRAMMABLE LEAVES BASE: any quantity of a validated
//   asset in an output at another address has ESCAPED, and fails that
//   asset however comfortably the base total meets its floor —
//   meeting the floor with one hand while sending the same asset out
//   the other is exactly the leak the "remain at base" rule exists to
//   stop. (An asset of an UNvalidated policy in a non-base output is
//   an ordinary native token moving ordinarily, reported as excluded
//   and never judged.)
//
// The claim here is a whole output list, so there is no 'not-stated'
// verdict: an expected asset absent from the outputs is a base total
// of zero — a shortfall stated by the list itself, not a blank field.
// A claimed output that cannot be read (a fractional quantity, an
// entry that does not say whether it sits at a base address) is
// REFUSED, never scored. A modeled transfer the planner finds
// unplannable (a burn past the validated input) leaves no expected
// value to check against: any claim is reported UNPLANNABLE.
//
// Boundary honesty carries over: a correct verdict proves only the
// two output requirements against the modeled lists entered — PRISM
// read no transaction and no chain state, value preservation across
// the whole transaction and the registry proofs themselves are
// separate requirements this tool does not judge; each token's
// transfer-logic withdraw-zero and holder authorization are judged
// by checkTransferAuthorization.
export function verifyTransferOutputs(input, outputs) {
  const plan = planTransferOutputValue(input);
  const outs = transferValueEntries(outputs, 'outputs', 'outputs');
  if (plan.status === 'unplannable') {
    return { status: 'unplannable', valid: false, verdicts: null, missing: plan.missing, impossible: plan.impossible, validatedPolicies: plan.validatedPolicies };
  }
  const validated = new Set(plan.validatedPolicies);
  const baseTotals = new Map();
  const nonBaseTotals = new Map();
  const excludedMap = new Map();
  for (const e of outs) {
    const key = `${e.policy}|${e.assetName}`;
    if (!validated.has(e.policy)) {
      const cur = excludedMap.get(key) ?? { policy: e.policy, assetName: e.assetName, quantity: 0n };
      cur.quantity += e.quantity;
      excludedMap.set(key, cur);
      continue;
    }
    const map = e.atBase ? baseTotals : nonBaseTotals;
    map.set(key, (map.get(key) ?? 0n) + e.quantity);
  }
  const verdictFor = (policy, assetName, expected) => {
    const key = `${policy}|${assetName}`;
    const baseOutput = baseTotals.get(key) ?? 0n;
    const nonBaseOutput = nonBaseTotals.get(key) ?? 0n;
    return {
      policy,
      assetName,
      expectedQuantity: expected.toString(),
      baseOutputQuantity: baseOutput.toString(),
      nonBaseOutputQuantity: nonBaseOutput.toString(),
      meetsExpected: baseOutput >= expected,
      escaped: nonBaseOutput > 0n,
      surplusQuantity: (baseOutput > expected ? baseOutput - expected : 0n).toString(),
      shortfallQuantity: (baseOutput < expected ? expected - baseOutput : 0n).toString(),
    };
  };
  const verdicts = plan.entries.map(e => verdictFor(e.policy, e.assetName, BigInt(e.expectedQuantity)));
  const expectedKeys = new Set(plan.entries.map(e => `${e.policy}|${e.assetName}`));
  const extraKeys = [...new Set([...baseTotals.keys(), ...nonBaseTotals.keys()])].filter(k => !expectedKeys.has(k)).sort();
  for (const key of extraKeys) {
    const [policy, assetName] = key.split('|');
    verdicts.push({ ...verdictFor(policy, assetName, 0n), unexpected: true });
  }
  for (const v of verdicts) if (v.unexpected !== true) v.unexpected = false;
  const valid = verdicts.every(v => v.meetsExpected && !v.escaped);
  return {
    status: valid ? 'correct' : 'incorrect',
    valid,
    verdicts,
    missing: [],
    impossible: [],
    validatedPolicies: plan.validatedPolicies,
    excludedOutputs: [...excludedMap.values()].sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : a.assetName < b.assetName ? -1 : 1)).map(e => ({ policy: e.policy, assetName: e.assetName, quantity: e.quantity.toString() })),
    outputEntryCount: outs.length,
  };
}

export const TRANSFER_VALUE_COMPARE_FIELDS = Object.freeze([
  ['expectedQuantity', 'expected quantity'],
]);

// CIP-113 TransferAct output-value impact, compared locally between two
// modeled versions of the SAME transfer — the expected value as planned
// against the transfer as it was, and as planned against the transfer as
// it would be after some other change (a spent UTxO joining, a mint or
// burn adjusted, a policy's registry proof arriving or being withdrawn).
// The registry, base redeemer, and delegate pairing families already had
// this temporal half (diffRegistryProofs, diffRegistryInsertion,
// diffBaseSpendRedeemer, diffDelegatePairing); the transfer output-value
// family had only plan → verify, so a builder whose transfer changed
// during assembly could not ask which assets' expected value at base the
// change moves — and outputs already built against the earlier
// expectation then fail the delegate's floor, or leave programmable
// value at base that no longer belongs there, for reasons the earlier
// plan cannot explain.
//
// Both versions are planned through planTransferOutputValue itself
// (validate-once, twenty-fifth application), so comparison and planning
// can never disagree about any asset's expected value in either version,
// and a version that cannot be read (a duplicated validated policy, a
// mint listing one asset twice, a fractional quantity, a numeric
// quantity) is refused on either side with the planner's reason, never
// compared around.
//
// One position is compared per validated asset, in the planner's sorted
// order: its expected quantity — the one number the delegate checks the
// transaction's outputs at base addresses against. THE SUBSTANCE is
// what is NOT compared as positions. The input and mint quantities are
// the expectation's COMPONENTS, not positions of their own: the expected
// quantity is their sum, so counting them would double- and
// triple-count a single move (an input rising by 10 with the mint
// unchanged moves the expectation once, not twice — pinned), and a
// change whose components cancel — input up 10, mint down 10 — leaves
// the expectation, and therefore every output built against it, exactly
// where it stood, so it compares as unchanged for that asset with the
// composition change reported separately as compositionChanged, never
// counted. An asset's presence in the expectation is likewise not a
// second position: a newly expected, newly validated, no-longer
// expected, or no-longer validated asset differs on its expected
// quantity alone — from no expectation to one, or back — and is
// classified by which of those stories it is. The excluded assets (the
// unvalidated policies' ordinary native tokens) carry no expectation at
// all, so their own change — an excluded asset joining, leaving, or
// moving in amount — is reported separately as added/removed/changed
// excluded assets, never counted: an ordinary token moving ordinarily
// does not stale any output the delegate will check. The validated
// policy list's own change is reported as added/removed policies, never
// counted either: a policy validated while holding no spent or minted
// value in the model moves no expectation by itself.
//
// Each asset's change is classified by its plannability story first —
// BECAME UNPLANNABLE (its expectation crossed below zero: a burn now
// exceeds its validated input) and BECAME PLANNABLE take precedence —
// then STILL UNPLANNABLE (negative on both sides, but not the same
// negative), EXPECTED CHANGED (plannable on both sides, the expectation
// moved), and the four presence stories above. The overall change puts
// the transfer's plannability story first the same way, then
// EXPECTATIONS CHANGED. Expected quantities are the planner's canonical
// BigInt decimal strings, so equality here is exact past 2^53.
//
// Boundary honesty carries over from the planner: the comparison is
// between the two modeled versions entered — PRISM read no transaction,
// no UTxO, and no chain state, and comparing expectations applies
// neither version and builds no transaction.
export function diffTransferOutputValue(beforeInput, afterInput) {
  const before = planTransferOutputValue(beforeInput);
  const after = planTransferOutputValue(afterInput);
  const keyOf = e => `${e.policy}|${e.assetName}`;
  const beforeEntries = new Map(before.entries.map(e => [keyOf(e), e]));
  const afterEntries = new Map(after.entries.map(e => [keyOf(e), e]));
  const beforeExcluded = new Map(before.excluded.map(e => [keyOf(e), e]));
  const afterExcluded = new Map(after.excluded.map(e => [keyOf(e), e]));
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort((x, y) => {
    const [xp, xn] = x.split('|'), [yp, yn] = y.split('|');
    return xp < yp ? -1 : xp > yp ? 1 : xn < yn ? -1 : xn > yn ? 1 : 0;
  });
  const perAsset = keys.map(key => {
    const b = beforeEntries.get(key) ?? null;
    const a = afterEntries.get(key) ?? null;
    const [policy, assetName] = key.split('|');
    let change, changedFields = [];
    if (b && a) {
      if (b.expectedQuantity !== a.expectedQuantity) {
        changedFields = TRANSFER_VALUE_COMPARE_FIELDS.map(([, label]) => label);
        if (BigInt(b.expectedQuantity) >= 0n && BigInt(a.expectedQuantity) < 0n) change = 'became-unplannable';
        else if (BigInt(b.expectedQuantity) < 0n && BigInt(a.expectedQuantity) >= 0n) change = 'became-plannable';
        else if (BigInt(b.expectedQuantity) < 0n) change = 'still-unplannable';
        else change = 'expected-changed';
      } else change = 'unchanged';
    } else if (a) {
      change = beforeExcluded.has(key) ? 'newly-validated' : 'newly-expected';
      changedFields = TRANSFER_VALUE_COMPARE_FIELDS.map(([, label]) => label);
    } else {
      change = afterExcluded.has(key) ? 'no-longer-validated' : 'no-longer-expected';
      changedFields = TRANSFER_VALUE_COMPARE_FIELDS.map(([, label]) => label);
    }
    const compositionChanged = !!(b && a && (b.inputQuantity !== a.inputQuantity || b.mintQuantity !== a.mintQuantity));
    return { policy, assetName, change, changedFields, compositionChanged, before: b, after: a };
  });
  const changed = perAsset.filter(p => p.change !== 'unchanged');
  let change;
  if (!changed.length) change = 'unchanged';
  else if (before.status === 'planned' && after.status === 'unplannable') change = 'became-unplannable';
  else if (before.status === 'unplannable' && after.status === 'planned') change = 'became-plannable';
  else if (before.status === 'unplannable') change = 'still-unplannable';
  else change = 'expectations-changed';
  const beforeValidated = new Set(before.validatedPolicies), afterValidated = new Set(after.validatedPolicies);
  const addedExcluded = after.excluded.filter(e => !beforeExcluded.has(keyOf(e)));
  const removedExcluded = before.excluded.filter(e => !afterExcluded.has(keyOf(e)));
  const changedExcluded = before.excluded.filter(e => {
    const a = afterExcluded.get(keyOf(e));
    return a && (a.inputQuantity !== e.inputQuantity || a.mintQuantity !== e.mintQuantity);
  }).map(e => ({ policy: e.policy, assetName: e.assetName, before: e, after: afterExcluded.get(keyOf(e)) }));
  const count = c => perAsset.filter(p => p.change === c).length;
  return {
    change,
    changedFields: changed.length ? TRANSFER_VALUE_COMPARE_FIELDS.map(([, label]) => label) : [],
    perAsset,
    addedValidatedPolicies: after.validatedPolicies.filter(p => !beforeValidated.has(p)),
    removedValidatedPolicies: before.validatedPolicies.filter(p => !afterValidated.has(p)),
    addedExcluded,
    removedExcluded,
    changedExcluded,
    excludedChanged: addedExcluded.length > 0 || removedExcluded.length > 0 || changedExcluded.length > 0,
    compositionChanged: perAsset.some(p => p.compositionChanged),
    before,
    after,
    unchanged: changed.length === 0,
    changedCount: changed.length,
    unchangedCount: perAsset.length - changed.length,
    newlyExpectedCount: count('newly-expected'),
    noLongerExpectedCount: count('no-longer-expected'),
    newlyValidatedCount: count('newly-validated'),
    noLongerValidatedCount: count('no-longer-validated'),
  };
}

// CIP-113 delegate paired-output checking, modeled locally from the
// spec's ThirdPartyAct and UnfrackingAct sections and its "Validation
// performed by the action delegates" step 4 (output validation).
//
// The delegate pairing family above computes WHICH output pairs with
// which base input, and states in its boundary what it does not judge:
// whether each paired output keeps its input's address and datum,
// keeps every other policy's tokens identical, actually changes the
// acted-on policy's tokens (third-party) or strips that policy
// entirely (unfracking), and satisfies the balance invariant. This
// checker judges exactly those positions, per pair and in aggregate,
// because they fail separately and the fixes differ.
//
// Per pair, for BOTH actions:
// - same address: the continuing output sits at the input's address.
// - same datum: the continuing output carries the input's datum
//   (modeled as an even-length hex string, or null for no datum).
// - other policies identical: the aggregated assets of every policy
//   except the acted-on one are exactly equal between input and
//   output. Lovelace is not modeled here, as in the transfer-value
//   family — for unfracking the spec lets ada move freely in any case.
//
// Per pair, by action:
// - third-party: the acted-on policy's aggregated assets MUST change
//   between input and output. A pair whose policy tokens stand still
//   is a no-op action on that UTxO — the shape the change requirement
//   exists to refuse, because batch third-party actions on many UTxOs
//   could otherwise be used to impose validation costs while doing
//   nothing (the spec's transfer security considerations name this
//   DoS guard explicitly).
// - unfracking: the acted-on policy MUST be present in the input and
//   ENTIRELY absent from the continuing output — a partial strip is
//   refused, because a continuing output still holding the policy
//   would still need that policy's transfer proof on every later
//   spend. The pair's reference script must also be identical: the
//   unfracking section names address, datum, AND reference script as
//   byte-identical. The third-party section does not name the
//   reference script, so for a third-party action it is reported per
//   pair as information and given NO verdict — a requirement the
//   spec does not state gets no failure here.
//
// Aggregate, third-party only — the BALANCE INVARIANT: for each asset
// name of the acted-on policy, the total across ALL modeled outputs
// at base addresses (the paired continuing outputs plus any other
// base outputs the claim lists — outputs before outputs_start_idx or
// after the pairs, which the pairing planner notes still count) must
// be at least the total input of that asset adjusted by the modeled
// mint for that asset (a mint raises the floor; a burn lowers it —
// the seize-and-burn wipe is the burn case). This is the invariant
// that keeps seized value inside the programmable-token system: it
// may move between base addresses, never out of them. An asset whose
// adjusted expectation is negative (a burn larger than the modeled
// input) can be satisfied by no output list, so it is named as
// impossible and the invariant fails — nothing is clipped to zero.
// Unfracking has no balance invariant and no mint adjustment in this
// model: it restructures one holder's own UTxOs, and its verdict is
// the per-pair strip. Mint entries under other policies are reported
// as excluded, never judged, exactly as in the transfer-value family.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown or missing field, an asset listed twice
// in one value, a numeric quantity, a non-boolean reference-script
// flag, an empty pair list — is refused, never scored in part.
// Quantities are BigInt-exact decimal strings under the modeled
// int64 ceiling; an asset entry holding zero is not an entry.
//
// Boundary honesty: these verdicts judge the modeled pairs and lists
// entered. PRISM read no transaction, no UTxO, and no registry: that
// the pairs are the transaction's real pairs is the pairing planner's
// question above; that the token's third-party or unfracking logic
// executed via withdraw-zero, and (for unfracking) that the holder
// authorised the action are judged by checkDelegateLogicExecution
// below; that the RegistryNode named by the redeemer holds this
// policy's configuration is a separate requirement this checker
// does not judge.
function pairedUtxo(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming an address, a datum (hex or null), whether it carries a reference script, and the assets it holds.`);
  const fields = ['address', 'datum', 'referenceScript', 'assets'];
  for (const k of Object.keys(value)) if (!fields.includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled UTxO names only its address, its datum, its reference-script flag, and its assets.`);
  for (const k of fields) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  if (typeof value.address !== 'string' || !value.address.trim()) throw new Error(`${label}'s address must be a non-empty string — the same-address rule turns on exactly that fact.`);
  let datum = null;
  if (value.datum !== null) {
    if (typeof value.datum !== 'string') throw new Error(`${label}'s datum must be an even-length hexadecimal string, or null when the UTxO carries no datum.`);
    datum = value.datum.trim().toLowerCase();
    if (!/^(?:[a-f0-9]{2})+$/.test(datum)) throw new Error(`${label}'s datum is not an even number of hexadecimal characters — ${JSON.stringify(value.datum)} given.`);
  }
  if (typeof value.referenceScript !== 'boolean') throw new Error(`${label} must say, as a boolean, whether it carries a reference script.`);
  if (!Array.isArray(value.assets)) throw new Error(`${label}'s assets must be a list of the non-lovelace assets it holds — policy, name, and quantity each.`);
  const seen = new Set();
  const assets = value.assets.map((a, i) => {
    const alabel = `${label} asset ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error(`${alabel} must be an object naming a policy, an asset name, and a quantity.`);
    for (const k of Object.keys(a)) if (k !== 'policy' && k !== 'name' && k !== 'quantity') throw new Error(`${alabel} carries an unknown field ${JSON.stringify(k)} — an asset names only its policy, name, and quantity.`);
    if (a.policy === undefined || a.name === undefined || a.quantity === undefined) throw new Error(`${alabel} must name a policy, an asset name, and a quantity.`);
    const policy = registryPolicyId(a.policy, `${alabel}'s policy`);
    const name = registryInsertAssetName(a.name, `${alabel}'s name`);
    const id = `${policy}:${name}`;
    if (seen.has(id)) throw new Error(`${label} lists the asset ${policy}:${name === '' ? '(empty name)' : name} twice — a value holds each asset once, so the claim cannot be read as one.`);
    seen.add(id);
    return { policy, name, quantity: registryInsertQuantity(a.quantity, `${alabel}'s quantity`) };
  });
  return { address: value.address.trim(), datum, referenceScript: value.referenceScript, assets };
}

function pairedMintEntries(value, policy) {
  if (!Array.isArray(value)) throw new Error('The modeled mint must be a list of the assets the transaction mints or burns for the acted-on policy — policy, name, and signed quantity each.');
  const seen = new Set();
  const counted = new Map();
  let excluded = 0;
  value.forEach((a, i) => {
    const alabel = `Mint entry ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error(`${alabel} must be an object naming a policy, an asset name, and a signed quantity.`);
    for (const k of Object.keys(a)) if (k !== 'policy' && k !== 'name' && k !== 'quantity') throw new Error(`${alabel} carries an unknown field ${JSON.stringify(k)} — a mint entry names only its policy, name, and quantity.`);
    if (a.policy === undefined || a.name === undefined || a.quantity === undefined) throw new Error(`${alabel} must name a policy, an asset name, and a quantity.`);
    const p = registryPolicyId(a.policy, `${alabel}'s policy`);
    const name = registryInsertAssetName(a.name, `${alabel}'s name`);
    const id = `${p}:${name}`;
    if (seen.has(id)) throw new Error(`The mint lists the asset ${p}:${name === '' ? '(empty name)' : name} twice — tx.mint holds each asset once, so the claim cannot be read as one.`);
    seen.add(id);
    const quantity = transferQuantity(a.quantity, `${alabel}'s quantity`, { signed: true });
    if (p === policy) counted.set(name, quantity); else excluded++;
  });
  return { counted, excluded };
}

function pairedOtherBaseAssets(value) {
  if (!Array.isArray(value)) throw new Error('The other base outputs must be a list of the assets they hold — policy, name, and quantity each.');
  const seen = new Set();
  return value.map((a, i) => {
    const alabel = `Other base output asset ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error(`${alabel} must be an object naming a policy, an asset name, and a quantity.`);
    for (const k of Object.keys(a)) if (k !== 'policy' && k !== 'name' && k !== 'quantity') throw new Error(`${alabel} carries an unknown field ${JSON.stringify(k)} — an asset names only its policy, name, and quantity.`);
    if (a.policy === undefined || a.name === undefined || a.quantity === undefined) throw new Error(`${alabel} must name a policy, an asset name, and a quantity.`);
    const policy = registryPolicyId(a.policy, `${alabel}'s policy`);
    const name = registryInsertAssetName(a.name, `${alabel}'s name`);
    const id = `${policy}:${name}`;
    if (seen.has(id)) throw new Error(`The other base outputs list the asset ${policy}:${name === '' ? '(empty name)' : name} twice — list each asset once, at its total across those outputs.`);
    seen.add(id);
    return { policy, name, quantity: registryInsertQuantity(a.quantity, `${alabel}'s quantity`) };
  });
}

export function checkDelegatePairedOutputs(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The paired-outputs claim must be an object naming the action, the acted-on policy, the input/output pairs, the other base outputs, and the modeled mint.');
  const inputFields = ['action', 'policy', 'pairs', 'otherBaseOutputs', 'mint'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The paired-outputs claim carries an unknown field ${JSON.stringify(k)} — it names only the action, the acted-on policy, the pairs, the other base outputs, and the mint.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The paired-outputs claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const action = delegateAction(claim.action);
  const policy = registryPolicyId(claim.policy, 'The acted-on policy');
  if (!Array.isArray(claim.pairs) || !claim.pairs.length) throw new Error('The pairs must be a non-empty list — an action with no paired base input has no outputs to judge.');
  const pairs = claim.pairs.map((p, i) => {
    const label = `Pair ${i + 1}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`${label} must be an object naming an input UTxO and its paired output UTxO.`);
    for (const k of Object.keys(p)) if (k !== 'input' && k !== 'output') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a pair names only its input and its output.`);
    if (p.input === undefined || p.output === undefined) throw new Error(`${label} must name both its input and its output — a claim that cannot be read in full is refused, never scored in part.`);
    return { input: pairedUtxo(p.input, `${label} input`), output: pairedUtxo(p.output, `${label} output`) };
  });
  const otherBase = pairedOtherBaseAssets(claim.otherBaseOutputs);
  const mint = pairedMintEntries(claim.mint, policy);
  const aggregate = assets => {
    const map = new Map();
    for (const a of assets) map.set(`${a.policy}:${a.name}`, (map.get(`${a.policy}:${a.name}`) ?? 0n) + a.quantity);
    return map;
  };
  const policyAssets = assets => {
    const map = new Map();
    for (const a of assets) if (a.policy === policy) map.set(a.name, (map.get(a.name) ?? 0n) + a.quantity);
    return map;
  };
  const mapsEqual = (a, b) => a.size === b.size && [...a.entries()].every(([k, v]) => b.get(k) === v);
  const pairResults = pairs.map((p, i) => {
    const inOther = aggregate(p.input.assets.filter(a => a.policy !== policy));
    const outOther = aggregate(p.output.assets.filter(a => a.policy !== policy));
    const inPolicy = policyAssets(p.input.assets);
    const outPolicy = policyAssets(p.output.assets);
    const inTotal = [...inPolicy.values()].reduce((s, q) => s + q, 0n);
    const outTotal = [...outPolicy.values()].reduce((s, q) => s + q, 0n);
    return {
      index: i,
      addressSame: p.input.address === p.output.address,
      datumSame: p.input.datum === p.output.datum,
      referenceScriptSame: p.input.referenceScript === p.output.referenceScript,
      otherAssetsSame: mapsEqual(inOther, outOther),
      policyChanged: !mapsEqual(inPolicy, outPolicy),
      policyPresentInInput: inTotal > 0n,
      policyAbsentFromOutput: outTotal === 0n,
      policyInputQuantity: inTotal.toString(),
      policyOutputQuantity: outTotal.toString(),
    };
  });
  const verdicts = {
    address: pairResults.every(p => p.addressSame),
    datum: pairResults.every(p => p.datumSame),
    otherAssets: pairResults.every(p => p.otherAssetsSame),
    referenceScript: action === 'unfracking' ? pairResults.every(p => p.referenceScriptSame) : null,
    policyPosition: action === 'third-party' ? pairResults.every(p => p.policyChanged) : pairResults.every(p => p.policyPresentInInput && p.policyAbsentFromOutput),
    balanceInvariant: null,
  };
  let totals = [];
  let impossible = [];
  if (action === 'third-party') {
    const inByName = new Map();
    for (const p of pairs) for (const [name, q] of policyAssets(p.input.assets)) inByName.set(name, (inByName.get(name) ?? 0n) + q);
    const outByName = new Map();
    for (const p of pairs) for (const [name, q] of policyAssets(p.output.assets)) outByName.set(name, (outByName.get(name) ?? 0n) + q);
    const otherByName = new Map();
    for (const a of otherBase) if (a.policy === policy) otherByName.set(a.name, (otherByName.get(a.name) ?? 0n) + a.quantity);
    const names = [...new Set([...inByName.keys(), ...outByName.keys(), ...otherByName.keys(), ...mint.counted.keys()])].sort();
    totals = names.map(name => {
      const inputQuantity = inByName.get(name) ?? 0n;
      const mintQuantity = mint.counted.get(name) ?? 0n;
      const expectedQuantity = inputQuantity + mintQuantity;
      const pairedOutputQuantity = outByName.get(name) ?? 0n;
      const otherOutputQuantity = otherByName.get(name) ?? 0n;
      const outputQuantity = pairedOutputQuantity + otherOutputQuantity;
      return { assetName: name, inputQuantity: inputQuantity.toString(), mintQuantity: mintQuantity.toString(), expectedQuantity: expectedQuantity.toString(), pairedOutputQuantity: pairedOutputQuantity.toString(), otherOutputQuantity: otherOutputQuantity.toString(), outputQuantity: outputQuantity.toString(), meetsInvariant: expectedQuantity >= 0n && outputQuantity >= expectedQuantity };
    });
    impossible = totals.filter(t => BigInt(t.expectedQuantity) < 0n).map(t => ({ assetName: t.assetName, expectedQuantity: t.expectedQuantity }));
    verdicts.balanceInvariant = totals.length > 0 && totals.every(t => t.meetsInvariant);
  }
  const valid = Object.values(verdicts).every(v => v === null || v === true);
  const renderUtxo = u => ({ address: u.address, datum: u.datum, referenceScript: u.referenceScript, assets: u.assets.map(a => ({ ...a, quantity: a.quantity.toString() })) });
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    action,
    policy,
    pairs: pairResults,
    verdicts,
    totals,
    impossible,
    excludedMintCount: mint.excluded,
    modeledPairs: pairs.map(p => ({ input: renderUtxo(p.input), output: renderUtxo(p.output) })),
  };
}

export const DELEGATE_PAIRED_OUTPUTS_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['address', 'Address'],
  ['datum', 'Datum'],
  ['otherAssets', 'Other assets'],
  ['referenceScript', 'Reference script'],
  ['policyPosition', 'Policy position'],
  ['balanceInvariant', 'Balance invariant'],
  ['invariantExpectation', 'Invariant expectation'],
]);

// CIP-113 delegate paired-outputs impact, compared locally between
// two modeled versions of the SAME paired-output claim — the claim
// as checked against the pairs, other base outputs, and mint as
// they stood, and as it would stand after some later change
// (transaction assembly rebuilding an output, value moving between
// the paired outputs and the other base outputs, a mint or burn
// being adjusted). The registry, base redeemer, delegate pairing,
// transfer output-value, protocol upgrade, global dispatch, transfer
// proof-list, and logic-execution families already had this
// temporal half; the paired-outputs family, shipped as a single
// checker in v1.104, had only the check, so a builder whose claim
// conformed when they modeled it could not ask what a later change
// did to it — and the changes that stale it are the paired-output
// validation's own moving parts (spec: delegate validation step 4):
// an output rebuilt at a different address or with a different
// datum breaks a pair that conformed, value moved out of the base
// outputs breaks the balance invariant without any pair changing,
// a mint or burn adjusted after the outputs were built moves the
// invariant's floor out from under them, and the floor itself can
// move while every verdict stands — a raised mint met by raised
// base outputs leaves the claim conforming, but outputs built
// against the old floor no longer prove the new one.
//
// Both versions are checked through checkDelegatePairedOutputs
// itself (validate-once, thirtieth application), so comparison and
// checking can never disagree about either version, and a version
// that cannot be read (an unknown field, an asset listed twice in
// one value, an empty pair list) is refused on either side with the
// checker's reason, never compared around. Hex case is
// canonicalised by the checker before comparison, so a datum or an
// asset name listed in uppercase still names the same value on
// either side.
//
// The comparison tracks ONE paired-output claim: the two versions
// must declare the same action AND the same acted-on policy. A
// ThirdPartyAct claim and an UnfrackingAct claim are judged under
// different positions — the reference script carries a verdict for
// one and none for the other — and a claim about a different policy
// is a claim about a different token; which position moved is
// meaningless when the claim itself changed — refused, never
// scored.
//
// Eight positions are compared, in the checker's own order: the
// status, the address verdict, the datum verdict, the other-assets
// verdict, the reference-script verdict, the policy-position
// verdict, the balance-invariant verdict, and the invariant
// expectation. The verdict positions take the checker's verdicts,
// so a position the spec gives no verdict compares equal on both
// sides (the reference script is null for a third-party action on
// both sides; the balance invariant is null for unfracking on both
// sides) and can never differ. The expectation is the requirement
// the invariant checks, as the logic-execution comparison's logic
// credential is: for a third-party action it is the checker's
// totals mapped to each asset name's expected quantity — the floor
// at base, per asset — compared by deep equality; for unfracking
// there is no invariant and so no expectation, and the position is
// reported with no value (null) on both sides, exactly the
// verdictless asymmetry discipline the checker itself applies.
// THE SUBSTANCE is what is NOT compared as a position. Which pairs
// themselves changed is reported as changedPairIndices — the
// indices whose modeled pair differs — never counted: for a
// third-party action a reference-script change inside a pair moves
// no verdict at all, so counting the pair would invent the failure
// the checker deliberately gives none, and where a pair's change
// does move a verdict, that verdict's position already counts it.
// The pair list's own growth is reported as addedPairCount and
// removedPairCount, never counted: a pair the change adds pairs
// automatically, and its whole consequence shows in the verdict
// positions above. The totals' own breakdown is reported as
// totalsChanges — per asset name in either version's totals, the
// before/after expected, output, and mint quantities wherever any
// of them differ — never counted: it is the breakdown OF the
// expectation position, so counting it would count the floor's
// move twice. A change in how many mint entries sit under other
// policies is reported as excludedMintCountChanged, never counted:
// those entries are excluded, never judged, on both sides alike.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because the
// claim gaining or losing conformance is the headline even when
// the invariant's floor also moved — then STILL NOT CONFORMING
// (not conforming on both sides, but not the same failure: a
// position changed underneath it) and REQUIREMENT CHANGED
// (conforming on both sides, but the invariant expectation moved —
// reachable exactly through the expectation position, since every
// verdict position stands on both sides: the claim survives, and
// the floor its outputs must cover at base addresses is no longer
// the floor they were built against).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no UTxO, and no registry, and comparing checks
// neither version and builds no transaction. Whether the pairs are
// either version's real pairs remains the pairing planner's
// question, on both sides alike.
export function diffDelegatePairedOutputs(beforeClaim, afterClaim) {
  const before = checkDelegatePairedOutputs(beforeClaim);
  const after = checkDelegatePairedOutputs(afterClaim);
  if (before.action !== after.action) throw new Error(`The two modeled paired-output claims declare different actions \u2014 ${JSON.stringify(before.action)} before and ${JSON.stringify(after.action)} after. A comparison tracks one paired-output claim: the declared action names which delegate action the claim is about, and a different action is a different claim.`);
  if (before.policy !== after.policy) throw new Error(`The two modeled paired-output claims declare different acted-on policies \u2014 ${JSON.stringify(before.policy)} before and ${JSON.stringify(after.policy)} after. A comparison tracks one paired-output claim: the acted-on policy names the token the claim is about, and a different policy is a different claim.`);
  const expectationOf = v => v.action === 'third-party' ? v.totals.map(t => ({ assetName: t.assetName, expectedQuantity: t.expectedQuantity })) : null;
  const positionOf = v => ({ status: v.status, address: v.verdicts.address, datum: v.verdicts.datum, otherAssets: v.verdicts.otherAssets, referenceScript: v.verdicts.referenceScript, policyPosition: v.verdicts.policyPosition, balanceInvariant: v.verdicts.balanceInvariant, invariantExpectation: expectationOf(v) });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of DELEGATE_PAIRED_OUTPUTS_COMPARE_FIELDS) {
    const differs = field === 'invariantExpectation' ? JSON.stringify(beforePos[field]) !== JSON.stringify(afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const pairCount = Math.max(before.modeledPairs.length, after.modeledPairs.length);
  const changedPairIndices = [];
  for (let i = 0; i < pairCount; i++) {
    if (JSON.stringify(before.modeledPairs[i] ?? null) !== JSON.stringify(after.modeledPairs[i] ?? null)) changedPairIndices.push(i);
  }
  const beforeTotals = new Map(before.totals.map(t => [t.assetName, t]));
  const afterTotals = new Map(after.totals.map(t => [t.assetName, t]));
  const totalsChanges = [...new Set([...beforeTotals.keys(), ...afterTotals.keys()])].sort().map(assetName => {
    const b = beforeTotals.get(assetName) ?? null, a = afterTotals.get(assetName) ?? null;
    return {
      assetName,
      beforeExpectedQuantity: b ? b.expectedQuantity : null,
      afterExpectedQuantity: a ? a.expectedQuantity : null,
      beforeOutputQuantity: b ? b.outputQuantity : null,
      afterOutputQuantity: a ? a.outputQuantity : null,
      beforeMintQuantity: b ? b.mintQuantity : null,
      afterMintQuantity: a ? a.mintQuantity : null,
    };
  }).filter(t => t.beforeExpectedQuantity !== t.afterExpectedQuantity || t.beforeOutputQuantity !== t.afterOutputQuantity || t.beforeMintQuantity !== t.afterMintQuantity);
  return {
    action: before.action,
    policy: before.policy,
    change,
    changedFields: differences.map(d => d.label),
    differences,
    changedPairIndices,
    addedPairCount: Math.max(0, after.modeledPairs.length - before.modeledPairs.length),
    removedPairCount: Math.max(0, before.modeledPairs.length - after.modeledPairs.length),
    totalsChanges,
    excludedMintCountChanged: before.excludedMintCount !== after.excludedMintCount,
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: DELEGATE_PAIRED_OUTPUTS_COMPARE_FIELDS.length,
  };
}

// CIP-113 delegate logic execution, modeled locally from the spec's
// delegate validation step 3 and the two action constructors
// (ThirdPartyAct / UnfrackingAct, re-read from the raw upstream spec
// this run): for each registered token, the delegate verifies that
// the token's own logic script for the action was executed in the
// transaction — that its credential appears in the transaction's
// withdrawals, invoked via the withdraw-zero pattern. The
// paired-outputs checker above judges what the paired outputs hold;
// this checker judges the execution half both delegate panels stated
// was unjudged, plus the one authorization rule the actions differ
// on.
//
// Two verdict positions, because they fail separately and the fix
// differs:
// - logicExecution: the action's logic credential — the RegistryNode's
//   third_party_logic_script for a third-party action, its
//   unfracking_logic_script for unfracking — appears among the
//   modeled withdrawals (kind and hash both). A credential that names
//   nothing (an empty hash) can appear in no withdrawal map, so the
//   position fails outright: for unfracking the spec names that shape
//   itself — an empty public-key unfracking credential is least
//   permission, unfracking is FORBIDDEN for that policy, and no
//   transaction can satisfy the requirement (reported as
//   logicForbidden). For a third-party action an empty logic
//   credential likewise names no script to execute, so no claim can
//   pass — but the spec gives the third-party field no
//   forbidden-by-default reading, and none is invented here.
// - holderAuthorization: judged for UNFRACKING ONLY. The holder must
//   authorise the restructuring, by the same rule as a transfer: a
//   signature where the holder's stake credential is a public key
//   (its hash among the modeled signers), or execution of the script
//   where it is a script (its credential among the modeled
//   withdrawals). No holder named (null) authorises nothing, so the
//   position fails. For a THIRD-PARTY action the spec bypasses the
//   authorization check outright — third parties do not need the
//   holder's permission — so the position is reported with NO
//   verdict (null): a requirement the spec lifts gets no failure, and
//   a holder credential or signer entered for a third-party claim is
//   reported, never judged. This asymmetry is the same discipline as
//   the paired-outputs reference script: a position's absence in the
//   spec is itself spec information.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown action, an unknown or missing field, a
// credential of an unknown kind, a hash that is neither empty nor
// 28 bytes, a duplicated withdrawal credential, a duplicated signer,
// a signer that is not a 28-byte hash — is refused, never scored in
// part. Hex case is canonicalised before comparison, so a withdrawal
// listed in uppercase still names the same credential.
//
// Boundary honesty: these verdicts judge the modeled credentials,
// withdrawals, and signers entered. PRISM read no transaction, no
// registry, and no UTxO: whether the RegistryNode the redeemer names
// actually carries this logic credential is judged by
// checkDelegateRegistryNode below, against a modeled node; whether a listed withdrawal
// really executed (a withdraw-zero amount is not modeled — presence
// in the withdrawals is the modeled evidence, exactly as the spec
// phrases the requirement), and whether a listed signer really signed
// are facts about a real transaction this model does not read. The
// per-pair output positions are the paired-outputs checker's, above.
function delegateLogicCredential(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a credential naming a kind (pubkey or script) and a hash — the empty hash is the one shape that names no script.`);
  for (const k of Object.keys(value)) if (k !== 'kind' && k !== 'hash') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a credential names only a kind and a hash.`);
  if (value.kind === undefined || value.hash === undefined) throw new Error(`${label} must name both a kind (pubkey or script) and a hash.`);
  if (value.kind !== 'pubkey' && value.kind !== 'script') throw new Error(`${label}'s kind must be pubkey or script — ${JSON.stringify(value.kind)} given.`);
  const hash = registryBytesHex(value.hash, `${label}'s hash`);
  if (hash !== '' && hash.length !== 56) throw new Error(`${label}'s hash must be empty or 28 bytes (56 hexadecimal characters) — ${hash.length / 2} bytes given, refused rather than read as a credential it is not.`);
  return { kind: value.kind, hash };
}

function delegateSigners(value) {
  if (!Array.isArray(value)) throw new Error('The signers must be a list of the public-key hashes that signed the modeled transaction.');
  const seen = new Set();
  return value.map((s, i) => {
    const hash = registryPolicyId(s, `Signer ${i + 1}`);
    if (seen.has(hash)) throw new Error(`Signer ${hash} is listed more than once — the required-signer set holds each key once, so a duplicated list names nothing twice over.`);
    seen.add(hash);
    return hash;
  });
}

export function checkDelegateLogicExecution(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The logic-execution claim must be an object naming the action, the action logic credential from the acted-on policy\u2019s RegistryNode, the transaction\u2019s withdrawals, the holder credential, and the transaction\u2019s signers.');
  const inputFields = ['action', 'logicCredential', 'withdrawals', 'holderCredential', 'signers'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The logic-execution claim carries an unknown field ${JSON.stringify(k)} — it names only the action, the logic credential, the withdrawals, the holder credential, and the signers.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The logic-execution claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part. The holder credential may be null, but the field must be stated.`);
  const action = delegateAction(claim.action);
  const logicCredential = delegateLogicCredential(claim.logicCredential, `The ${action === 'unfracking' ? 'unfracking' : 'third-party'} logic credential`);
  const withdrawals = baseWithdrawals(claim.withdrawals);
  const holderCredential = claim.holderCredential === null ? null : baseCredential(claim.holderCredential, 'The holder credential');
  const signers = delegateSigners(claim.signers);
  const inWithdrawals = c => withdrawals.some(w => w.kind === c.kind && w.hash === c.hash);
  const logicMode = logicCredential.hash === '' ? 'none' : logicCredential.kind;
  const logicInWithdrawals = logicMode !== 'none' && inWithdrawals(logicCredential);
  const logicForbidden = action === 'unfracking' && logicMode === 'none';
  let holderMode = 'bypassed';
  let holderAuthorized = null;
  if (action === 'unfracking') {
    if (holderCredential === null) { holderMode = 'none'; holderAuthorized = false; }
    else if (holderCredential.kind === 'pubkey') { holderMode = 'signature'; holderAuthorized = signers.includes(holderCredential.hash); }
    else { holderMode = 'script-execution'; holderAuthorized = inWithdrawals(holderCredential); }
  }
  const verdicts = {
    logicExecution: logicInWithdrawals,
    holderAuthorization: action === 'unfracking' ? holderAuthorized : null,
  };
  const valid = verdicts.logicExecution === true && (verdicts.holderAuthorization === null || verdicts.holderAuthorization === true);
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    action,
    logicCredential,
    logicMode,
    logicForbidden,
    logicInWithdrawals,
    withdrawals,
    holderCredential,
    holderMode,
    holderAuthorized,
    signers,
    verdicts,
  };
}

export const DELEGATE_LOGIC_EXECUTION_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['logicCredential', 'Logic credential'],
  ['logicExecution', 'Logic execution'],
  ['holderAuthorization', 'Holder authorization'],
]);

// CIP-113 delegate logic-execution impact, compared locally between
// two modeled versions of the SAME execution claim — the claim as
// checked against the logic credential, withdrawals, holder, and
// signers as they stood, and as it would stand after some later
// change (a registry update re-pointing the acted-on policy's
// RegistryNode logic field for the action, or transaction assembly
// adding or dropping a withdrawal or a signer). The registry, base
// redeemer, delegate pairing, transfer output-value, protocol
// upgrade, global dispatch, and transfer proof-list families already
// had this temporal half; the logic-execution family, shipped as a
// single checker, had only the check, so a builder whose execution
// conformed when they modeled it could not ask what a later change
// did to it — and the changes that stale it are the delegate
// validation's own moving parts (spec: delegate validation steps 1
// and 3): the logic credential is read from the RegistryNode the
// redeemer names, so a registry update that re-points that node's
// field for the action changes what must be executed without
// touching the transaction at all, and an assembly that drops the
// logic credential's withdrawal — or, for unfracking, the holder's
// signature — breaks an execution that conformed when modeled.
//
// Both versions are checked through checkDelegateLogicExecution
// itself (validate-once, twenty-ninth application), so comparison
// and checking can never disagree about either version, and a
// version that cannot be read (an unknown action or field, a
// malformed credential, a duplicated withdrawal or signer) is
// refused on either side with the checker's reason, never compared
// around. Hex case is canonicalised by the checker before
// comparison, so a credential listed in uppercase still names the
// same credential on either side.
//
// The comparison tracks ONE execution claim: the two versions must
// declare the same action. A ThirdPartyAct claim and an
// UnfrackingAct claim are different actions — the holder position
// is judged for one and bypassed for the other — and which
// credential moved is meaningless when the action itself changed —
// refused, never scored.
//
// Four positions are compared, in the checker's own order: the
// status, the logic credential (kind and hash both — the
// requirement itself, as the dispatch comparison's delegate
// position is), the logic-execution verdict, and the
// holder-authorization verdict (null for a third-party action on
// both sides, where the spec bypasses authorization, so it
// compares equal and can never differ). THE SUBSTANCE is what is
// NOT compared as a position. The holder credential itself is
// reported separately as holderCredentialChanged, never counted:
// for a third-party action it is bypassed entirely, so its change
// moves nothing the delegate judges, and for unfracking its whole
// consequence already shows in the authorization verdict — counting
// the credential as well would double-count the one move (pinned).
// The withdrawal list's own change is reported as the added/removed
// withdrawal credentials, and the signer list's as the added/removed
// signer hashes, never counted: they are the causes, the verdict
// positions above are the consequence.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because the
// execution gaining or losing a requirement is the headline even
// when the logic credential also moved — then STILL NOT CONFORMING
// (not conforming on both sides, but not the same failure: a
// position changed underneath it) and REQUIREMENT CHANGED
// (conforming on both sides, but the logic credential is a
// different credential — the execution survives, and the script
// whose withdraw-zero validates the action is no longer the one
// that validated it before).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no registry, and no UTxO, and comparing checks
// neither version and builds no transaction. Whether the
// RegistryNode the redeemer names actually carries either version's
// logic credential remains checkDelegateRegistryNode's position,
// on both sides alike.
export function diffDelegateLogicExecution(beforeClaim, afterClaim) {
  const before = checkDelegateLogicExecution(beforeClaim);
  const after = checkDelegateLogicExecution(afterClaim);
  if (before.action !== after.action) throw new Error(`The two modeled executions declare different actions \u2014 ${JSON.stringify(before.action)} before and ${JSON.stringify(after.action)} after. A comparison tracks one execution claim: the declared action names which delegate action the claim is about, and a different action is a different execution claim.`);
  const sameCred = (a, b) => (a === null && b === null) || (a !== null && b !== null && a.kind === b.kind && a.hash === b.hash);
  const positionOf = v => ({ status: v.status, logicCredential: v.logicCredential, logicExecution: v.verdicts.logicExecution, holderAuthorization: v.verdicts.holderAuthorization });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of DELEGATE_LOGIC_EXECUTION_COMPARE_FIELDS) {
    const differs = field === 'logicCredential' ? !sameCred(beforePos[field], afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const credKey = c => `${c.kind}|${c.hash}`;
  const beforeWdSet = new Set(before.withdrawals.map(credKey)), afterWdSet = new Set(after.withdrawals.map(credKey));
  const beforeSignerSet = new Set(before.signers), afterSignerSet = new Set(after.signers);
  return {
    action: before.action,
    change,
    changedFields: differences.map(d => d.label),
    differences,
    holderCredentialChanged: !sameCred(before.holderCredential, after.holderCredential),
    addedWithdrawals: after.withdrawals.filter(c => !beforeWdSet.has(credKey(c))),
    removedWithdrawals: before.withdrawals.filter(c => !afterWdSet.has(credKey(c))),
    addedSigners: after.signers.filter(h => !beforeSignerSet.has(h)),
    removedSigners: before.signers.filter(h => !afterSignerSet.has(h)),
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: DELEGATE_LOGIC_EXECUTION_COMPARE_FIELDS.length,
  };
}

// CIP-113 delegate RegistryNode resolution, modeled locally from the
// spec's ThirdPartyAct / UnfrackingAct constructors and its Reference
// Inputs section (re-read from the raw upstream spec this run): both
// delegate redeemers name a registry_node_idx — the index, in the
// transaction's reference inputs, of the RegistryNode for the token
// being acted upon — and the delegate's first requirement on that
// hint is that "the RegistryNode at registry_node_idx MUST exist and
// contain the token's configuration". Exactly one policy is acted on
// per action, and it is named by that node: the node's key IS the
// acted-on policy, and the node's field for the action is the logic
// credential the logic-execution checker above takes as a free input.
// This checker resolves the hint against a modeled reference-input
// list instead of trusting either fact, closing the boundary the
// logic-execution checker states: whether the named node actually
// carries the claimed credential.
//
// Four verdict positions, because they fail separately and the fix
// differs:
// - nodeResolves: registry_node_idx is in range and the reference
//   input there is a RegistryNode at all (modeled as null for any
//   other reference input — the protocol parameters UTxO, a global
//   state UTxO). An index past the end, or one landing on another
//   input, resolves to no node.
// - nodeCarriesPolicy: the resolved node's key equals the acted-on
//   policy. A node for a different policy is a different token's
//   configuration, however well formed. Reported with NO verdict
//   (null) when no node resolves — there is no key to compare.
// - logicCredentialMatches: the resolved node's field for the action
//   (third_party_logic_script / unfracking_logic_script) equals the
//   claimed logic credential, kind and hash both — the credential the
//   logic-execution checker judges against the withdrawals must be
//   the one this node names, or the delegate reads a different
//   token's rules. NO verdict when the node does not carry the
//   policy: agreement with the wrong node's field proves nothing
//   about the acted-on token.
// - globalStateReference: when the node's global_state_cs is
//   non-empty, the spec's Reference Inputs require a reference input
//   carrying an NFT of that policy; the position judges whether that
//   policy appears among the modeled reference inputs' NFT policies.
//   An empty global_state_cs states no requirement, so the position
//   is reported with NO verdict, and it is likewise verdictless when
//   the node does not carry the policy.
//
// The unfracking forbidden shape carries over: a resolved node whose
// unfracking field is the empty public-key credential forbids the
// action for that policy (logicForbidden) — the claimed credential
// may match that field exactly and the configuration still supports
// no unfracking, so a forbidden configuration is never conforming.
// A third-party empty field gets no forbidden reading, as in the
// logic-execution checker: it matches or fails on agreement alone,
// and whether an empty credential can execute is that checker's
// verdict, not this one's.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown action, an unknown or missing field, a
// policy that is not a 28-byte ID, a fractional or negative index, a
// node entry with an unknown or missing field, a credential of an
// unknown kind or a hash that is neither empty nor 28 bytes, a
// global-state policy listed twice — is refused, never scored in
// part. Hex case is canonicalised before comparison.
//
// Boundary honesty: these verdicts judge the modeled reference
// inputs entered. PRISM read no transaction, no registry, and no
// UTxO: whether the reference input at that index in a real
// transaction really holds this node, whether the node holds the
// registry NFT, and whether it was written by the registry validator
// are facts about a real registry this model does not read. Whether
// the credential this node names was actually executed is the
// logic-execution checker's, above; the paired outputs are the
// paired-outputs checker's.
function delegateNodeEntry(value, index) {
  if (value === null) return null;
  const label = `Reference input ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be null (not a RegistryNode) or a RegistryNode naming its key, its third-party and unfracking credentials, and its global_state_cs.`);
  for (const k of Object.keys(value)) if (!['key', 'thirdParty', 'unfracking', 'globalStateCs'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled RegistryNode here names only its key, its third-party and unfracking credentials, and its global_state_cs; the fields this resolution reads.`);
  for (const k of ['key', 'thirdParty', 'unfracking', 'globalStateCs']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a node that cannot be read in full is refused, never scored in part.`);
  const key = registryBytesHex(value.key, `${label}'s key`);
  if (key !== '' && key.length !== 56) throw new Error(`${label}'s key must be empty (the origin node's key) or a 28-byte policy ID (56 hexadecimal characters) — ${key.length / 2} bytes given, refused rather than read as a key it is not.`);
  const thirdParty = delegateLogicCredential(value.thirdParty, `${label}'s third_party_logic_script`);
  const unfracking = delegateLogicCredential(value.unfracking, `${label}'s unfracking_logic_script`);
  const globalStateCs = registryBytesHex(value.globalStateCs, `${label}'s global_state_cs`);
  if (globalStateCs !== '' && globalStateCs.length !== 56) throw new Error(`${label}'s global_state_cs must be empty or a 28-byte policy ID (56 hexadecimal characters) — ${globalStateCs.length / 2} bytes given, refused rather than read as a policy it is not.`);
  return { key, thirdParty, unfracking, globalStateCs };
}

export function checkDelegateRegistryNode(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The registry-node claim must be an object naming the action, the acted-on policy, the registry_node_idx, the claimed logic credential, the modeled reference inputs, and the NFT policies those reference inputs carry.');
  const inputFields = ['action', 'policy', 'registryNodeIdx', 'logicCredential', 'nodes', 'globalStatePolicies'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The registry-node claim carries an unknown field ${JSON.stringify(k)} — it names only the action, the policy, the registry_node_idx, the logic credential, the reference inputs, and their NFT policies.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The registry-node claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const action = delegateAction(claim.action);
  const policy = registryPolicyId(claim.policy, 'The acted-on policy');
  if (!Number.isInteger(claim.registryNodeIdx) || claim.registryNodeIdx < 0) throw new Error(`registry_node_idx must be a non-negative integer — ${JSON.stringify(claim.registryNodeIdx)} given, refused rather than rounded.`);
  const registryNodeIdx = claim.registryNodeIdx;
  const logicCredential = delegateLogicCredential(claim.logicCredential, 'The claimed logic credential');
  if (!Array.isArray(claim.nodes)) throw new Error('The reference inputs must be a list, one entry per reference input in transaction order — a RegistryNode, or null for any other reference input.');
  const nodes = claim.nodes.map((n, i) => delegateNodeEntry(n, i));
  if (!Array.isArray(claim.globalStatePolicies)) throw new Error('The global-state policies must be a list of the NFT policies the modeled reference inputs carry.');
  const seenPolicies = new Set();
  const globalStatePolicies = claim.globalStatePolicies.map((g, i) => {
    const p = registryPolicyId(g, `Global-state policy ${i + 1}`);
    if (seenPolicies.has(p)) throw new Error(`Global-state policy ${p} is listed more than once — the reference inputs carry each NFT policy once in this model, so a duplicated list names nothing twice over.`);
    seenPolicies.add(p);
    return p;
  });
  const resolvedNode = registryNodeIdx < nodes.length ? nodes[registryNodeIdx] : null;
  const nodeResolves = resolvedNode !== null;
  const nodeCarriesPolicy = nodeResolves ? resolvedNode.key === policy : null;
  const nodeLogicCredential = nodeResolves ? (action === 'unfracking' ? resolvedNode.unfracking : resolvedNode.thirdParty) : null;
  const logicCredentialMatches = nodeCarriesPolicy === true
    ? nodeLogicCredential.kind === logicCredential.kind && nodeLogicCredential.hash === logicCredential.hash
    : null;
  const logicForbidden = action === 'unfracking' && nodeCarriesPolicy === true
    && nodeLogicCredential.kind === 'pubkey' && nodeLogicCredential.hash === '';
  const globalStateMode = nodeCarriesPolicy !== true ? null
    : resolvedNode.globalStateCs === '' ? 'none' : 'present';
  const globalStateReference = globalStateMode === 'present'
    ? globalStatePolicies.includes(resolvedNode.globalStateCs)
    : null;
  const verdicts = { nodeResolves, nodeCarriesPolicy, logicCredentialMatches, globalStateReference };
  const valid = nodeResolves === true && nodeCarriesPolicy === true && logicCredentialMatches === true
    && (globalStateReference === null || globalStateReference === true) && !logicForbidden;
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    action,
    policy,
    registryNodeIdx,
    resolvedNode,
    nodeLogicCredential,
    logicCredential,
    logicForbidden,
    globalStateMode,
    globalStatePolicies,
    referenceCount: nodes.length,
    verdicts,
  };
}

export const DELEGATE_REGISTRY_NODE_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['nodeLogicCredential', 'Node logic credential'],
  ['nodeResolves', 'Node resolution'],
  ['nodeCarriesPolicy', 'Node carries the policy'],
  ['logicCredentialMatches', 'Logic credential agreement'],
  ['globalStateReference', 'Global-state reference'],
]);

// CIP-113 delegate registry-node impact, compared locally between
// two modeled versions of the SAME registry-node claim — the claim
// as checked against the registry_node_idx, the modeled reference
// inputs, the claimed logic credential, and the global-state
// policies as they stood, and as it would stand after some later
// change (a reference input added ahead of the node, the node
// itself updated, or the claim re-pointed). The registry, base
// redeemer, delegate pairing, transfer output-value, protocol
// upgrade, global dispatch, transfer proof-list, logic-execution,
// and paired-outputs families already had this temporal half; the
// registry-node family, shipped as a single checker in v1.106, had
// only the check, so a builder whose resolution conformed when they
// modeled it could not ask what a later change did to it — and the
// changes that stale it are the resolution's own moving parts
// (spec: ThirdPartyAct / UnfrackingAct constructors and Reference
// Inputs): a reference input inserted ahead of the node moves the
// index the redeemer names, a registry update re-pointing the
// node's field for the action changes the credential the action
// must invoke, and a global-state policy joining or leaving the
// reference inputs changes whether a named global state is carried.
//
// Both versions are checked through checkDelegateRegistryNode
// itself (validate-once, thirty-first application), so comparison
// and checking can never disagree about either version, and a
// version that cannot be read (an unknown action or field, a
// policy that is not a 28-byte ID, a fractional or negative index,
// a malformed node entry, a duplicated global-state policy) is
// refused on either side with the checker's reason, never compared
// around. Hex case is canonicalised by the checker before
// comparison, so a node key or a credential listed in uppercase
// still names the same node and the same credential on either side.
//
// The comparison tracks ONE registry-node claim: the two versions
// must declare the same action AND the same acted-on policy. A
// ThirdPartyAct claim and an UnfrackingAct claim are judged
// against different fields of the node, and a claim about a
// different policy is a claim about a different token's
// configuration; which position moved is meaningless when the
// claim itself changed — refused, never scored.
//
// Six positions are compared, in the checker's own order: the
// status, the node logic credential (the credential the resolved
// node names for the action — the requirement itself, as the
// logic-execution comparison's logic credential is; null when no
// node resolves, and null compares equal with null), the node
// resolution verdict, the node-carries-policy verdict, the logic
// credential agreement verdict, and the global-state reference
// verdict (verdictless — null — when the node names no global
// state or does not carry the policy, and null compares equal
// with null while null against true or false differs). Credential
// equality is kind and hash both. THE SUBSTANCE is what is NOT
// compared as a position. The registry_node_idx itself is reported
// as registryNodeIdxChanged, never counted: the index is a hint,
// and the same node reached at a new index — because a reference
// input was inserted ahead of it and the claim followed — resolves
// identically, so counting the hint would score a move the delegate
// never judges. The claimed logic credential itself is reported as
// claimedLogicCredentialChanged, never counted: its only scored
// consequence is the logic-agreement verdict's own move, so
// counting the claim as well would count one fact twice (pinned).
// Which modeled nodes themselves changed is reported as
// changedNodeIndices — the indices whose modeled node differs
// between the two reference-input lists — never counted: a node
// the resolution never reaches moves no position, and where a
// node's change does move a position, that position already counts
// it. The reference-input list's own growth is reported as the
// node counts before and after and their added/removed counts,
// never counted. The global-state policies' own change is
// reported as the added/removed policies, and the global-state
// mode — whether the resolved node names a global state at all —
// is reported as the before/after modes and whether it changed,
// never counted: they are the causes and the breakdown, the
// verdict positions above are the consequence.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because
// the claim gaining or losing conformance is the headline even
// when the node's credential also moved — then STILL NOT
// CONFORMING (not conforming on both sides, but not the same
// failure: a position changed underneath it) and REQUIREMENT
// CHANGED (conforming on both sides, but the node logic credential
// moved — reachable exactly through the node-logic-credential
// position, since every verdict position stands on both sides:
// the claim survives, and the credential the node requires the
// action to invoke is no longer the one it required before).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no registry, and no UTxO, and comparing checks
// neither version and builds no transaction. Whether the reference
// input at that index in a real transaction really holds either
// version's node remains a fact about a real registry this model
// does not read, on both sides alike.
export function diffDelegateRegistryNode(beforeClaim, afterClaim) {
  const before = checkDelegateRegistryNode(beforeClaim);
  const after = checkDelegateRegistryNode(afterClaim);
  if (before.action !== after.action) throw new Error(`The two modeled registry-node claims declare different actions \u2014 ${JSON.stringify(before.action)} before and ${JSON.stringify(after.action)} after. A comparison tracks one registry-node claim: the declared action names which delegate action the claim is about, and a different action is a different claim.`);
  if (before.policy !== after.policy) throw new Error(`The two modeled registry-node claims declare different acted-on policies \u2014 ${JSON.stringify(before.policy)} before and ${JSON.stringify(after.policy)} after. A comparison tracks one registry-node claim: the acted-on policy names the token the claim is about, and a different policy is a different claim.`);
  const sameCred = (a, b) => (a === null && b === null) || (a !== null && b !== null && a.kind === b.kind && a.hash === b.hash);
  const positionOf = v => ({ status: v.status, nodeLogicCredential: v.nodeLogicCredential, nodeResolves: v.verdicts.nodeResolves, nodeCarriesPolicy: v.verdicts.nodeCarriesPolicy, logicCredentialMatches: v.verdicts.logicCredentialMatches, globalStateReference: v.verdicts.globalStateReference });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of DELEGATE_REGISTRY_NODE_COMPARE_FIELDS) {
    const differs = field === 'nodeLogicCredential' ? !sameCred(beforePos[field], afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const beforeNodes = beforeClaim.nodes.map((n, i) => delegateNodeEntry(n, i));
  const afterNodes = afterClaim.nodes.map((n, i) => delegateNodeEntry(n, i));
  const nodeCount = Math.max(beforeNodes.length, afterNodes.length);
  const changedNodeIndices = [];
  for (let i = 0; i < nodeCount; i++) {
    if (JSON.stringify(beforeNodes[i] ?? null) !== JSON.stringify(afterNodes[i] ?? null)) changedNodeIndices.push(i);
  }
  const beforeGlobalSet = new Set(before.globalStatePolicies), afterGlobalSet = new Set(after.globalStatePolicies);
  return {
    action: before.action,
    policy: before.policy,
    change,
    changedFields: differences.map(d => d.label),
    differences,
    registryNodeIdxChanged: before.registryNodeIdx !== after.registryNodeIdx,
    claimedLogicCredentialChanged: !sameCred(before.logicCredential, after.logicCredential),
    changedNodeIndices,
    nodeCountBefore: before.referenceCount,
    nodeCountAfter: after.referenceCount,
    addedNodeCount: Math.max(0, after.referenceCount - before.referenceCount),
    removedNodeCount: Math.max(0, before.referenceCount - after.referenceCount),
    addedGlobalStatePolicies: after.globalStatePolicies.filter(p => !beforeGlobalSet.has(p)),
    removedGlobalStatePolicies: before.globalStatePolicies.filter(p => !afterGlobalSet.has(p)),
    globalStateModeBefore: before.globalStateMode,
    globalStateModeAfter: after.globalStateMode,
    globalStateModeChanged: before.globalStateMode !== after.globalStateMode,
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: DELEGATE_REGISTRY_NODE_COMPARE_FIELDS.length,
  };
}

// CIP-113 TransferAct authorization and logic execution, modeled
// locally from the spec's delegate validation steps 1 and 3 and its
// TransferAct constructor (re-read from the raw upstream spec this
// run). A TransferAct is the one action the holder initiates, and the
// transfer delegate's two non-value requirements are the two the
// transfer output-value family states it does not judge:
//
// - Authorization (step 1, TransferAct only): for EACH UTxO spent
//   from programmableLogicBase, the spend is authorised by the UTxO's
//   stake credential — a signature where that credential is a public
//   key (its hash among the modeled signers), or execution of the
//   script where it is a script (its credential among the modeled
//   withdrawals). This is the same rule the unfracking holder check
//   applies to one holder, applied here per spent input, because a
//   transfer can spend UTxOs of more than one stake credential and
//   each spend must be authorised by its own. One unauthorised input
//   fails the position; the per-input results name which.
// - Logic execution (step 3): for each policy proven REGISTERED (a
//   TokenExists proof), the token's transfer_logic_script MUST be
//   executed in the transaction via withdraw-zero — its credential
//   among the modeled withdrawals, kind and hash both. A credential
//   naming nothing (an empty hash) can appear in no withdrawal map,
//   so that token's position fails outright; the spec gives the
//   transfer field no forbidden-by-default reading (that reading
//   belongs to unfracking alone), and none is invented here.
//
// A policy proven NOT registered (a TokenDoesNotExist proof) is
// treated as an ordinary native token and can be transferred without
// additional validation (spec, TransferAct constructor point 3): its
// position is reported with NO verdict (null), whether or not a
// transfer credential was entered for it — judging it would invent a
// requirement the delegate does not impose. The aggregate logic
// verdict is likewise NO verdict when no registered policy is
// modeled at all: there is nothing the delegate requires executed,
// and a vacuous pass would claim a check ran that did not.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown or missing field, an empty spent list
// (a TransferAct spend with no base UTxO names nothing to
// authorise), a stake or transfer credential of an unknown kind or
// with a hash that is not 28 bytes (the transfer credential's hash
// may be empty — the shape that names no script), a token entry
// whose registered flag is not a boolean, a registered token naming
// no transfer credential, the same policy listed twice, a duplicated
// withdrawal credential, a duplicated signer — is refused, never
// scored in part. Hex case is canonicalised before comparison.
//
// Boundary honesty: these verdicts judge the modeled stake
// credentials, tokens, withdrawals, and signers entered. PRISM read
// no transaction, no registry, and no UTxO: whether the registry
// proofs that mark a policy registered actually validate, and
// whether a policy's RegistryNode actually carries the transfer
// credential entered here, are judged by checkTransferRegistryProofs
// below, against modeled reference inputs; whether a
// listed withdrawal really executed and a listed signer really
// signed are facts about a real transaction this model does not
// read. The expected output value and its verification are the
// transfer output-value family's, above.
function transferTokenEntry(value, index) {
  const label = `Token ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming its policy, whether a registry proof proved it registered, and its transfer_logic_script credential.`);
  for (const k of Object.keys(value)) if (!['policy', 'registered', 'transferCredential'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled token names only its policy, its registered flag, and its transfer credential.`);
  for (const k of ['policy', 'registered', 'transferCredential']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a token that cannot be read in full is refused, never scored in part. The transfer credential may be null for an unregistered token, but the field must be stated.`);
  const policy = registryPolicyId(value.policy, `${label}'s policy`);
  if (typeof value.registered !== 'boolean') throw new Error(`${label}'s registered flag must be a boolean — it states whether a TokenExists proof proved this policy registered, and the logic verdict turns on exactly that fact.`);
  if (value.registered && value.transferCredential === null) throw new Error(`${label} is proven registered but names no transfer credential — a registered token's transfer_logic_script is the credential whose execution this checker judges, so the claim cannot be read without it.`);
  const transferCredential = value.transferCredential === null ? null : delegateLogicCredential(value.transferCredential, `${label}'s transfer_logic_script`);
  return { policy, registered: value.registered, transferCredential };
}

export function checkTransferAuthorization(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The transfer claim must be an object naming the stake credential of each UTxO spent from programmableLogicBase, the tokens proven registered or not, the transaction\u2019s withdrawals, and the transaction\u2019s signers.');
  const inputFields = ['spentStakeCredentials', 'tokens', 'withdrawals', 'signers'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The transfer claim carries an unknown field ${JSON.stringify(k)} — it names only the spent stake credentials, the tokens, the withdrawals, and the signers.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The transfer claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  if (!Array.isArray(claim.spentStakeCredentials) || !claim.spentStakeCredentials.length) throw new Error('The spent stake credentials must be a non-empty list, one per UTxO spent from programmableLogicBase — a TransferAct spend with no base UTxO names nothing to authorise.');
  const spentInputs = claim.spentStakeCredentials.map((c, i) => baseCredential(c, `Spent UTxO ${i + 1}'s stake credential`));
  if (!Array.isArray(claim.tokens)) throw new Error('The tokens must be a list, one entry per distinct policy the modeled transfer carries a registry proof for.');
  const seenPolicies = new Set();
  const tokens = claim.tokens.map((t, i) => {
    const entry = transferTokenEntry(t, i);
    if (seenPolicies.has(entry.policy)) throw new Error(`Policy ${entry.policy} is listed more than once — a policy is proven registered once, or not at all, so a duplicated list names nothing twice over.`);
    seenPolicies.add(entry.policy);
    return entry;
  });
  const withdrawals = baseWithdrawals(claim.withdrawals);
  const signers = delegateSigners(claim.signers);
  const inWithdrawals = c => withdrawals.some(w => w.kind === c.kind && w.hash === c.hash);
  const inputResults = spentInputs.map((credential, i) => {
    const mode = credential.kind === 'pubkey' ? 'signature' : 'script-execution';
    const authorized = credential.kind === 'pubkey' ? signers.includes(credential.hash) : inWithdrawals(credential);
    return { index: i, credential, mode, authorized };
  });
  const tokenResults = tokens.map(t => {
    if (!t.registered) return { policy: t.policy, registered: false, transferCredential: t.transferCredential, mode: 'not-required', inWithdrawals: t.transferCredential === null ? null : inWithdrawals(t.transferCredential), executed: null };
    const mode = t.transferCredential.hash === '' ? 'none' : t.transferCredential.kind;
    const executed = mode !== 'none' && inWithdrawals(t.transferCredential);
    return { policy: t.policy, registered: true, transferCredential: t.transferCredential, mode, inWithdrawals: executed, executed };
  });
  const registeredResults = tokenResults.filter(t => t.registered);
  const verdicts = {
    holderAuthorization: inputResults.every(r => r.authorized),
    logicExecution: registeredResults.length ? registeredResults.every(r => r.executed) : null,
  };
  const valid = verdicts.holderAuthorization === true && (verdicts.logicExecution === null || verdicts.logicExecution === true);
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    spentInputs: inputResults,
    tokens: tokenResults,
    withdrawals,
    signers,
    verdicts,
    registeredCount: registeredResults.length,
    unregisteredCount: tokenResults.length - registeredResults.length,
  };
}


export const TRANSFER_AUTHORIZATION_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['requiredTransferCredentials', 'Required transfer credentials'],
  ['holderAuthorization', 'Holder authorization'],
  ['logicExecution', 'Logic execution'],
]);

// CIP-113 TransferAct authorization impact, compared locally between
// two modeled versions of the SAME transfer — the transfer as checked
// against the spent stake credentials, the tokens, the withdrawals,
// and the signers as they stood, and as it would stand after some
// later change. The registry, base redeemer, delegate pairing,
// transfer output-value, protocol upgrade, global dispatch, transfer
// proof-list, delegate logic-execution, delegate paired-outputs, and
// delegate registry-node families already had this temporal half;
// the transfer authorization family, shipped as a single checker in
// v1.107, had only the check, so a builder whose transfer conformed
// when they modeled it could not ask what a later change did to it —
// and the changes that stale it need never touch its logic at all
// (spec: delegate validation steps 1 and 3 and the TransferAct
// constructor): a signer added or dropped changes whether a
// public-key stake credential's spend is authorised, a withdrawal
// dropped changes both a script stake credential's authorization and
// a registered token's execution, transaction assembly spending a
// UTxO of a new stake credential adds a spend that must be authorised
// by its own credential, a registry update re-pointing a token's
// transfer_logic_script changes the credential that must be executed,
// and a token's registration proof flipping changes whether it is a
// registered token with a requirement at all or an ordinary native
// token with none.
//
// Both versions are checked through checkTransferAuthorization
// itself (validate-once, thirty-second application), so comparison
// and checking can never disagree about either version, and a
// version that cannot be read (an unknown or missing field, an empty
// spent list, a stake or transfer credential of an unknown kind or
// with a hash that is not 28 bytes, a token whose registered flag is
// not a boolean, a registered token naming no transfer credential,
// the same policy listed twice, a duplicated withdrawal or signer)
// is refused on either side with the checker's reason, never
// compared around. Hex case is canonicalised by the checker before
// comparison, so a credential or a signer listed in uppercase still
// names the same credential and the same signer on either side.
//
// The comparison tracks ONE transfer claim, but the claim has no
// action or policy identity field of its own — like the proof-list
// comparison, any two readable versions compare: the spent inputs,
// the tokens, the withdrawals, and the signers ARE the claim, and
// there is no separate identity a version could drift from.
//
// Four positions are compared, in the checker's own order: the
// status, the required transfer credentials (the list of
// {policy, kind, hash} for every REGISTERED token, sorted by policy
// — the requirement itself, as the dispatch comparison's delegate
// position is; an unregistered token names no requirement, so its
// credential, entered or not, is not in this list), the holder
// authorization verdict, and the logic execution verdict (no verdict
// — null — when no registered token is modeled on that side, and
// null compares equal with null while null against true or false
// differs, so a token becoming registered moves this position
// alongside the requirement's own move while both sides conform).
// The required list compares by its JSON, policy, kind, and hash
// together, in sorted order. THE SUBSTANCE is what is NOT compared
// as a position. The spent inputs' own change is reported as the
// spent credentials added/removed and the spent counts before and
// after, never counted: a new spent UTxO is a cause, and its scored
// consequence — whether its own stake credential authorises it — is
// the authorization verdict's move, so counting the spend as well
// would count one fact twice. The withdrawals' and the signers' own
// changes are reported as the added/removed entries, never counted,
// for the same reason: they are the causes whose consequence is a
// verdict position. The token list's own change is reported as the
// policies added/removed and the registered policies added/removed
// with the registered counts before and after, never counted: a
// token joining or leaving, or a registration flag flipping, moves
// a position only through the requirement it creates or removes and
// the execution verdict that requirement carries, and where it
// moves neither — an unregistered token's entered credential
// changing, which names no requirement and is given no verdict —
// it is report material and nothing more (pinned).
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because the
// transfer gaining or losing authorization or execution is the
// headline even when the required credentials also moved — then
// STILL NOT CONFORMING (not conforming on both sides, but not the
// same failure: a position changed underneath it) and REQUIREMENT
// CHANGED (conforming on both sides, but a position moved — and
// every such move passes through the required-credentials position:
// re-pointing a registered token's credential to a new one the
// withdrawals follow, a token becoming registered and executed, or
// a token becoming unregistered, each changes the requirement
// itself while every verdict that stands, stands on both sides).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no registry, and no UTxO, and comparing checks
// neither version and builds no transaction. Whether the registry
// proofs that mark a policy registered actually validate, and
// whether a policy's RegistryNode actually carries either version's
// transfer credential, are the registry-proof checker's positions,
// on both sides alike; the expected output value is the
// output-value family's.
export function diffTransferAuthorization(beforeClaim, afterClaim) {
  const before = checkTransferAuthorization(beforeClaim);
  const after = checkTransferAuthorization(afterClaim);
  const requiredOf = v => v.tokens.filter(t => t.registered).map(t => ({ policy: t.policy, kind: t.transferCredential.kind, hash: t.transferCredential.hash })).sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : 0));
  const positionOf = v => ({ status: v.status, requiredTransferCredentials: requiredOf(v), holderAuthorization: v.verdicts.holderAuthorization, logicExecution: v.verdicts.logicExecution });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of TRANSFER_AUTHORIZATION_COMPARE_FIELDS) {
    const differs = field === 'requiredTransferCredentials' ? JSON.stringify(beforePos[field]) !== JSON.stringify(afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const credKey = c => `${c.kind}:${c.hash}`;
  const beforeSpentSet = new Set(before.spentInputs.map(r => credKey(r.credential))), afterSpentSet = new Set(after.spentInputs.map(r => credKey(r.credential)));
  const beforeWdSet = new Set(before.withdrawals.map(credKey)), afterWdSet = new Set(after.withdrawals.map(credKey));
  const beforeSignerSet = new Set(before.signers), afterSignerSet = new Set(after.signers);
  const beforeTokenSet = new Set(before.tokens.map(t => t.policy)), afterTokenSet = new Set(after.tokens.map(t => t.policy));
  const beforeRegSet = new Set(before.tokens.filter(t => t.registered).map(t => t.policy)), afterRegSet = new Set(after.tokens.filter(t => t.registered).map(t => t.policy));
  return {
    change,
    changedFields: differences.map(d => d.label),
    differences,
    spentCredentialsAdded: [...afterSpentSet].filter(k => !beforeSpentSet.has(k)),
    spentCredentialsRemoved: [...beforeSpentSet].filter(k => !afterSpentSet.has(k)),
    spentCountBefore: before.spentInputs.length,
    spentCountAfter: after.spentInputs.length,
    withdrawalsAdded: [...afterWdSet].filter(k => !beforeWdSet.has(k)),
    withdrawalsRemoved: [...beforeWdSet].filter(k => !afterWdSet.has(k)),
    signersAdded: after.signers.filter(h => !beforeSignerSet.has(h)),
    signersRemoved: before.signers.filter(h => !afterSignerSet.has(h)),
    tokensAdded: [...afterTokenSet].filter(p => !beforeTokenSet.has(p)),
    tokensRemoved: [...beforeTokenSet].filter(p => !afterTokenSet.has(p)),
    registeredPoliciesAdded: [...afterRegSet].filter(p => !beforeRegSet.has(p)),
    registeredPoliciesRemoved: [...beforeRegSet].filter(p => !afterRegSet.has(p)),
    registeredCountBefore: before.registeredCount,
    registeredCountAfter: after.registeredCount,
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: TRANSFER_AUTHORIZATION_COMPARE_FIELDS.length,
  };
}


// CIP-113 TransferAct registry-proof resolution, modeled locally
// from the spec's delegate validation step 2, its TransferAct
// constructor, and its Reference Inputs section (re-read from the
// raw upstream spec this run): a TransferAct's TransferRedeemer
// carries one RegistryProof per distinct policy, and each proof is a
// HINT — a node_idx into the transaction's reference inputs — that
// the delegate resolves and then checks, rather than a fact it
// trusts. The authorization checker above takes each token's
// registered flag and transfer credential as told; the proof
// verifier (verifyRegistryProofs) judges a claimed proof list
// against a modeled registry KEY LIST. This checker closes the
// boundary both state: whether the node a proof names, at the index
// it names, actually proves what the proof claims, and whether that
// node carries the transfer credential the claim names for it.
//
// Four verdict positions per proof, because they fail separately
// and the fix differs:
// - nodeResolves: the proof's node_idx is in range and the reference
//   input there is a RegistryNode at all (modeled as null for any
//   other reference input — the protocol parameters UTxO, a global
//   state UTxO). An index past the end, or one landing on another
//   input, resolves to no node, and every later position for that
//   proof is verdictless.
// - proofMatchesNode: for a TokenExists proof, the resolved node's
//   key equals the policy; for a TokenDoesNotExist proof, the
//   resolved node is the COVERING node — its key is below the policy
//   and its next is above it (prev.key < policy < prev.next, the
//   spec's own formula, compared bytewise; the origin node's empty
//   key is below every policy, so an origin node can cover a policy
//   below its next). NO verdict when no node resolves.
// - transferCredentialMatches: judged for a TokenExists proof whose
//   node matched ONLY — the node's transfer_logic_script equals the
//   claimed transfer credential, kind and hash both, the credential
//   the authorization checker judges against the withdrawals. A
//   TokenDoesNotExist proof carries NO verdict here (an ordinary
//   native token has no transfer logic to agree with, whether or
//   not a credential was entered for it), and neither does an
//   exists proof against the wrong node: agreement with a different
//   token's field proves nothing about this one. An empty-hash node
//   field matches an empty claim exactly here — agreement is this
//   checker's only question; whether such a credential can execute
//   is the authorization checker's verdict, not this one's, and no
//   forbidden reading is invented for the transfer field.
// - globalStateReference: judged for a TokenExists proof whose node
//   matched ONLY, and only when that node's global_state_cs is
//   non-empty — the spec's Reference Inputs then require a reference
//   input carrying an NFT of that policy, judged against the
//   modeled NFT policies. An empty global_state_cs states no
//   requirement and carries NO verdict (the spec says so in words:
//   no reference input is expected); a covering node's own
//   global_state_cs is a different token's configuration and is
//   likewise given NO verdict here.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown or missing field, an empty proofs
// list (a TransferAct proof list naming no policy proves nothing),
// an unknown proof type, a fractional or negative node index, a
// TokenExists proof naming no transfer credential, the same policy
// proven twice, a node entry with an unknown or missing field, a
// key or next or global-state policy that is neither empty nor
// 28 bytes, a duplicated global-state policy — is refused, never
// scored in part. Hex case is canonicalised before comparison.
//
// Boundary honesty: these verdicts judge the modeled proofs,
// reference inputs, and NFT policies entered. PRISM read no
// transaction, no registry, and no UTxO: whether the reference input
// at that index in a real transaction really holds this node,
// whether the node holds the registry NFT, and whether it was
// written by the registry validator are facts about a real registry
// this model does not read. Whether the proofs list is COMPLETE
// (one per distinct spent or minted policy) and in lexicographic
// order is checkTransferProofList's position, against the modeled
// transfer's own spent and mint policies; whether the credential a matched node names was actually
// executed, and each spend authorised, is the authorization
// checker's, above; the expected output value is the output-value
// family's, below.
function transferProofEntry(value, index) {
  const label = `Proof ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming its policy, its proof type, its node index, and its transfer credential.`);
  for (const k of Object.keys(value)) if (!['policy', 'proofType', 'nodeIdx', 'transferCredential'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled proof names only its policy, its proof type, its node index, and its transfer credential.`);
  for (const k of ['policy', 'proofType', 'nodeIdx', 'transferCredential']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a proof that cannot be read in full is refused, never scored in part. The transfer credential may be null for a TokenDoesNotExist proof, but the field must be stated.`);
  const policy = registryPolicyId(value.policy, `${label}'s policy`);
  if (value.proofType !== 'TokenExists' && value.proofType !== 'TokenDoesNotExist') throw new Error(`${label}'s proof type must be TokenExists or TokenDoesNotExist — ${JSON.stringify(value.proofType)} given.`);
  if (!Number.isInteger(value.nodeIdx) || value.nodeIdx < 0) throw new Error(`${label}'s node_idx must be a non-negative integer — ${JSON.stringify(value.nodeIdx)} given, refused rather than rounded.`);
  if (value.proofType === 'TokenExists' && value.transferCredential === null) throw new Error(`${label} proves its policy registered but names no transfer credential — a registered token's transfer_logic_script is the credential whose agreement with the resolved node this checker judges, so the claim cannot be read without it.`);
  const transferCredential = value.transferCredential === null ? null : delegateLogicCredential(value.transferCredential, `${label}'s transfer_logic_script`);
  return { policy, proofType: value.proofType, nodeIdx: value.nodeIdx, transferCredential };
}

function transferNodeEntry(value, index) {
  if (value === null) return null;
  const label = `Reference input ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be null (not a RegistryNode) or a RegistryNode naming its key, its next key, its transfer credential, and its global_state_cs.`);
  for (const k of Object.keys(value)) if (!['key', 'next', 'transfer', 'globalStateCs'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled RegistryNode here names only its key, its next key, its transfer credential, and its global_state_cs; the fields this resolution reads.`);
  for (const k of ['key', 'next', 'transfer', 'globalStateCs']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a node that cannot be read in full is refused, never scored in part.`);
  const key = registryBytesHex(value.key, `${label}'s key`);
  if (key !== '' && key.length !== 56) throw new Error(`${label}'s key must be empty (the origin node's key) or a 28-byte policy ID (56 hexadecimal characters) — ${key.length / 2} bytes given, refused rather than read as a key it is not.`);
  const next = registryBytesHex(value.next, `${label}'s next`);
  if (next !== '' && next.length !== 56) throw new Error(`${label}'s next must be empty or a 28-byte policy ID (56 hexadecimal characters) — ${next.length / 2} bytes given, refused rather than read as a key it is not.`);
  const transfer = delegateLogicCredential(value.transfer, `${label}'s transfer_logic_script`);
  const globalStateCs = registryBytesHex(value.globalStateCs, `${label}'s global_state_cs`);
  if (globalStateCs !== '' && globalStateCs.length !== 56) throw new Error(`${label}'s global_state_cs must be empty or a 28-byte policy ID (56 hexadecimal characters) — ${globalStateCs.length / 2} bytes given, refused rather than read as a policy it is not.`);
  return { key, next, transfer, globalStateCs };
}

export function checkTransferRegistryProofs(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The transfer-proof claim must be an object naming the registry proofs, the modeled reference inputs, and the NFT policies those reference inputs carry.');
  const inputFields = ['proofs', 'nodes', 'globalStatePolicies'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The transfer-proof claim carries an unknown field ${JSON.stringify(k)} — it names only the proofs, the reference inputs, and their NFT policies.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The transfer-proof claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  if (!Array.isArray(claim.proofs) || !claim.proofs.length) throw new Error('The proofs must be a non-empty list, one registry proof per distinct policy the modeled transfer proves — a proof list naming no policy proves nothing.');
  const seenPolicies = new Set();
  const proofs = claim.proofs.map((entry, i) => {
    const proof = transferProofEntry(entry, i);
    if (seenPolicies.has(proof.policy)) throw new Error(`Policy ${proof.policy} is proven more than once — a policy is proven registered once, or not at all, so a duplicated proof names nothing twice over.`);
    seenPolicies.add(proof.policy);
    return proof;
  });
  if (!Array.isArray(claim.nodes)) throw new Error('The reference inputs must be a list, one entry per reference input in transaction order — a RegistryNode, or null for any other reference input.');
  const nodes = claim.nodes.map((n, i) => transferNodeEntry(n, i));
  if (!Array.isArray(claim.globalStatePolicies)) throw new Error('The global-state policies must be a list of the NFT policies the modeled reference inputs carry.');
  const seenGlobal = new Set();
  const globalStatePolicies = claim.globalStatePolicies.map((g, i) => {
    const policy = registryPolicyId(g, `Global-state policy ${i + 1}`);
    if (seenGlobal.has(policy)) throw new Error(`Global-state policy ${policy} is listed more than once — the reference inputs carry each NFT policy once in this model, so a duplicated list names nothing twice over.`);
    seenGlobal.add(policy);
    return policy;
  });
  const proofResults = proofs.map(proof => {
    const resolvedNode = proof.nodeIdx < nodes.length ? nodes[proof.nodeIdx] : null;
    const nodeResolves = resolvedNode !== null;
    let proofMatchesNode = null;
    if (nodeResolves) {
      proofMatchesNode = proof.proofType === 'TokenExists'
        ? resolvedNode.key === proof.policy
        : registryBytesCompare(resolvedNode.key, proof.policy) < 0 && resolvedNode.next !== '' && registryBytesCompare(proof.policy, resolvedNode.next) < 0;
    }
    const matched = proofMatchesNode === true;
    const transferCredentialMatches = matched && proof.proofType === 'TokenExists'
      ? resolvedNode.transfer.kind === proof.transferCredential.kind && resolvedNode.transfer.hash === proof.transferCredential.hash
      : null;
    const globalStateMode = matched && proof.proofType === 'TokenExists'
      ? (resolvedNode.globalStateCs === '' ? 'none' : 'present')
      : null;
    const globalStateReference = globalStateMode === 'present'
      ? globalStatePolicies.includes(resolvedNode.globalStateCs)
      : null;
    return { ...proof, resolvedNode, nodeResolves, proofMatchesNode, transferCredentialMatches, globalStateMode, globalStateReference };
  });
  const judgedTransfers = proofResults.filter(r => r.transferCredentialMatches !== null);
  const judgedGlobals = proofResults.filter(r => r.globalStateReference !== null);
  const verdicts = {
    nodesResolve: proofResults.every(r => r.nodeResolves),
    proofsMatchNodes: proofResults.every(r => r.proofMatchesNode === true),
    transferCredentialMatches: judgedTransfers.length ? judgedTransfers.every(r => r.transferCredentialMatches) : null,
    globalStateReference: judgedGlobals.length ? judgedGlobals.every(r => r.globalStateReference) : null,
  };
  const valid = verdicts.nodesResolve === true && verdicts.proofsMatchNodes === true
    && (verdicts.transferCredentialMatches === null || verdicts.transferCredentialMatches === true)
    && (verdicts.globalStateReference === null || verdicts.globalStateReference === true);
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    proofs: proofResults,
    nodes,
    globalStatePolicies,
    verdicts,
    referenceCount: nodes.length,
    existsCount: proofResults.filter(r => r.proofType === 'TokenExists').length,
    notExistsCount: proofResults.filter(r => r.proofType === 'TokenDoesNotExist').length,
  };
}

export const TRANSFER_REGISTRY_PROOFS_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['resolvedRequirements', 'Resolved node requirements'],
  ['nodesResolve', 'Node resolution'],
  ['proofsMatchNodes', 'Proofs match nodes'],
  ['transferCredentialMatches', 'Transfer credential agreement'],
  ['globalStateReference', 'Global-state reference'],
]);

// CIP-113 TransferAct registry-proof impact, compared locally between
// two modeled versions of the SAME transfer — the transfer’s proofs
// as resolved against the reference inputs as they stood, and as
// they would stand after some later change. The registry, base
// redeemer, delegate pairing, transfer output-value, protocol
// upgrade, global dispatch, transfer proof-list, delegate
// logic-execution, delegate paired-outputs, delegate registry-node,
// and transfer authorization families already had this temporal
// half; the transfer registry-proof family, shipped as a single
// checker in v1.108, had only the check, so a builder whose proof
// resolution conformed when they modeled it could not ask what a
// later change did to it — and the changes that stale it need never
// touch the proofs themselves (spec: delegate validation step 2,
// the TransferAct constructor, and Reference Inputs): transaction
// assembly adding a reference input ahead of a node moves the index
// every hint names, a registry update re-pointing a node’s
// transfer_logic_script or its global_state_cs changes the
// configuration a proof must agree with, a registry insertion
// changing a covering node’s next changes which policies it covers,
// and a global-state NFT joining or leaving the reference inputs
// changes whether a matched node’s global state is referenced.
//
// Both versions are checked through checkTransferRegistryProofs
// itself (validate-once, thirty-third application), so comparison
// and checking can never disagree about either version, and a
// version that cannot be read (an unknown or missing field, an
// empty proofs list, an unknown proof type, a fractional or
// negative node index, a TokenExists proof naming no transfer
// credential, the same policy proven twice, a node entry with an
// unknown or missing field, a key or next or global-state policy
// that is neither empty nor 28 bytes, a duplicated global-state
// policy) is refused on either side with the checker’s reason,
// never compared around. Hex case is canonicalised by the checker
// before comparison, so a policy, a node key, or a credential
// listed in uppercase still names the same record on either side.
//
// The comparison tracks ONE transfer claim, but the claim has no
// action or policy identity field of its own — like the
// authorization and proof-list comparisons, any two readable
// versions compare: the proofs, the reference inputs, and the NFT
// policies ARE the claim, and there is no separate identity a
// version could drift from.
//
// Six positions are compared, in the checker’s own order: the
// status, the resolved node requirements (for every proof, sorted
// by policy, what the node it resolves to demands of it — the
// requirement itself, as the dispatch comparison’s delegate
// position is: for a TokenExists proof, the resolved node’s key,
// its transfer_logic_script, and its global_state_cs; for a
// TokenDoesNotExist proof, the resolved node’s key and next, the
// bounds that make it the covering node, because a covering node’s
// transfer field and global_state_cs are a different token’s
// configuration, given no verdict by the checker and no place in
// this proof’s requirement; null fields when no node resolves),
// the node resolution verdict, the proofs-match-nodes verdict, the
// transfer credential agreement verdict, and the global-state
// reference verdict (no verdict — null — on a side where no proof
// reaches that position, and null compares equal with null while
// null against true or false differs, so a proof becoming judged
// moves this position alongside the requirement’s own move while
// both sides conform). THE SUBSTANCE is what is NOT compared as a
// position. A proof’s node_idx is a HINT — the same node at a new
// index, with the reference list adjusted, resolves identically —
// so index changes are reported per policy, never counted: the
// hint is only how the checker finds what it scores. A claimed
// transfer credential’s own change is reported per policy, never
// counted: for a TokenExists proof its only scored consequence is
// the agreement verdict’s move, so counting it would count one fact
// twice, and for a TokenDoesNotExist proof the checker gives the
// entered credential no verdict at all, so its change is report
// material and nothing more (pinned). The reference-input list’s
// own change is reported as the indices whose modeled node differs
// and the counts before and after, never counted, and the proof
// list’s and the global-state policy list’s own changes are
// reported as the policies added and removed, never counted: they
// are the causes; the verdict positions are the consequence.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because
// the resolution gaining or losing a node, a match, an agreement,
// or a global-state reference is the headline even when the
// requirement also moved — then STILL NOT CONFORMING (not
// conforming on both sides, but not the same failure: a position
// changed underneath it) and REQUIREMENT CHANGED (conforming on
// both sides, but a position moved — and every such move passes
// through the resolved-requirements position: a node’s transfer
// credential re-pointed with the claim following it, a covering
// node’s next widened while it still covers, a matched node
// gaining a global-state policy whose NFT is referenced, each
// changes what the modeled registry demands while every verdict
// that stands, stands on both sides; a verdict moving null to true
// or back alongside it does so only because a proof’s requirement
// entry itself changed shape).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction, no registry, and no UTxO, and comparing checks
// neither version and builds no transaction. Whether the proof list
// is complete and in lexicographic order is the proof-list
// checker’s position, on both sides alike; whether a matched
// node’s credential was actually executed, and each spend
// authorised, is the authorization checker’s; the expected output
// value is the output-value family’s.
export function diffTransferRegistryProofs(beforeClaim, afterClaim) {
  const before = checkTransferRegistryProofs(beforeClaim);
  const after = checkTransferRegistryProofs(afterClaim);
  const requirementOf = v => v.proofs.map(r => r.proofType === 'TokenExists'
    ? { policy: r.policy, proofType: r.proofType, key: r.resolvedNode ? r.resolvedNode.key : null, transfer: r.resolvedNode ? { kind: r.resolvedNode.transfer.kind, hash: r.resolvedNode.transfer.hash } : null, globalStateCs: r.resolvedNode ? r.resolvedNode.globalStateCs : null }
    : { policy: r.policy, proofType: r.proofType, key: r.resolvedNode ? r.resolvedNode.key : null, next: r.resolvedNode ? r.resolvedNode.next : null }
  ).sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : 0));
  const positionOf = v => ({ status: v.status, resolvedRequirements: requirementOf(v), nodesResolve: v.verdicts.nodesResolve, proofsMatchNodes: v.verdicts.proofsMatchNodes, transferCredentialMatches: v.verdicts.transferCredentialMatches, globalStateReference: v.verdicts.globalStateReference });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of TRANSFER_REGISTRY_PROOFS_COMPARE_FIELDS) {
    const differs = field === 'resolvedRequirements' ? JSON.stringify(beforePos[field]) !== JSON.stringify(afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const credKey = c => (c === null ? null : `${c.kind}:${c.hash}`);
  const beforeProofByPolicy = new Map(before.proofs.map(r => [r.policy, r]));
  const afterProofByPolicy = new Map(after.proofs.map(r => [r.policy, r]));
  const nodeIdxChanges = [];
  const claimedCredentialChanges = [];
  for (const [policy, b] of beforeProofByPolicy) {
    const a = afterProofByPolicy.get(policy);
    if (!a) continue;
    if (b.nodeIdx !== a.nodeIdx) nodeIdxChanges.push({ policy, before: b.nodeIdx, after: a.nodeIdx });
    if (credKey(b.transferCredential) !== credKey(a.transferCredential)) claimedCredentialChanges.push(policy);
  }
  const changedNodeIndices = [];
  const nodeCount = Math.max(before.nodes.length, after.nodes.length);
  for (let i = 0; i < nodeCount; i++) {
    const b = i < before.nodes.length ? JSON.stringify(before.nodes[i]) : '<absent>';
    const a = i < after.nodes.length ? JSON.stringify(after.nodes[i]) : '<absent>';
    if (b !== a) changedNodeIndices.push(i);
  }
  const beforeGlobalSet = new Set(before.globalStatePolicies), afterGlobalSet = new Set(after.globalStatePolicies);
  return {
    change,
    changedFields: differences.map(d => d.label),
    differences,
    proofsAdded: [...afterProofByPolicy.keys()].filter(p => !beforeProofByPolicy.has(p)),
    proofsRemoved: [...beforeProofByPolicy.keys()].filter(p => !afterProofByPolicy.has(p)),
    existsCountBefore: before.existsCount,
    existsCountAfter: after.existsCount,
    notExistsCountBefore: before.notExistsCount,
    notExistsCountAfter: after.notExistsCount,
    nodeIdxChanges,
    claimedCredentialChanges,
    changedNodeIndices,
    referenceCountBefore: before.referenceCount,
    referenceCountAfter: after.referenceCount,
    globalStatePoliciesAdded: [...afterGlobalSet].filter(p => !beforeGlobalSet.has(p)),
    globalStatePoliciesRemoved: [...beforeGlobalSet].filter(p => !afterGlobalSet.has(p)),
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: TRANSFER_REGISTRY_PROOFS_COMPARE_FIELDS.length,
  };
}

// CIP-113 TransferAct proof-list completeness and ordering, modeled
// locally from the spec's RegistryProof Requirements (re-read from
// the raw upstream spec this run): the proofs list in a TransferAct
// redeemer MUST satisfy three requirements at once — completeness,
// ordering, and correctness. Correctness of each individual proof is
// judged elsewhere in PRISM (verifyRegistryProofs against a modeled
// registry key list, and checkTransferRegistryProofs against modeled
// reference inputs). This checker judges the two requirements that
// are about the list AS A WHOLE, against the transfer itself:
//
// - COMPLETENESS: one proof for each distinct non-lovelace token
//   policy present in any UTxO being spent from
//   programmableLogicBase OR in tx.mint. The required set is the
//   DISTINCT UNION of the two sources: a policy both spent and
//   minted is proven ONCE, not twice — demanding a second proof for
//   it would refuse a list the delegate accepts. Mint belongs in
//   the union at all because the spec's transfer security
//   considerations say minted and burned tokens are validated
//   through the same proofs list as spent tokens: a mint-only policy
//   with no proof would bypass the registry check entirely. A
//   required policy with no proof is MISSING, a proof for a policy
//   the transfer neither spends from base nor mints is EXTRA, and a
//   policy proven more than once is a DUPLICATE — each named
//   separately, because the fix differs.
// - ORDERING: the list order MUST match the lexicographic ordering
//   of the token policies — bytewise, as the spec's own ordering
//   defines it. Every policy here is 28 bytes, compared with the
//   same registryBytesCompare the covering-node formula uses.
//   Judged on the claimed sequence as given: the first adjacent pair
//   that is not strictly increasing fails it, at that position — a
//   duplicate is out of order with itself.
//
// The modeled spent and mint lists are OCCURRENCE lists — one entry
// per policy occurrence (a policy held by two spent UTxOs, or minted
// under two asset names, appears once per occurrence) — and collapse
// to the distinct set the requirement names; a repeated occurrence
// is a fact about the transfer, never a refusal. The claimed proof
// list, by contrast, is judged exactly as given, duplicates
// included.
//
// Refusal discipline, as in PRISM's other checkers: a claim that
// cannot be READ — an unknown or missing field, a spent list naming
// no policy (a modeled transfer spending no non-lovelace policy from
// a base address states no proof requirement for this checker to
// judge), a policy that is not a 28-byte ID in any of the three
// lists — is refused, never scored in part. An EMPTY proof list, by
// contrast, is a readable claim: it fails completeness with every
// required policy named missing. Hex case is canonicalised before
// comparison.
//
// Boundary honesty: these verdicts judge the modeled spent, mint,
// and proof lists entered. PRISM read no transaction and no UTxO:
// which policies a real transaction's base UTxOs and mint actually
// carry are facts about that transaction, not judged here. Whether
// each listed proof accurately represents its policy's registration
// status (correctness) is the proof verifier's position against its
// modeled key list, and the registry-proof checker's against its
// modeled reference inputs; whether a proven-registered token's
// transfer logic executed and each spend was authorised is the
// authorization checker's; the expected output value is the
// output-value family's.
export function checkTransferProofList(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The proof-list claim must be an object naming the policies spent from programmableLogicBase, the policies in the transaction mint, and the policies the claimed proof list proves, in list order.');
  const inputFields = ['spentPolicies', 'mintPolicies', 'proofPolicies'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The proof-list claim carries an unknown field ${JSON.stringify(k)} — it names only the spent policies, the mint policies, and the proof policies.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The proof-list claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  if (!Array.isArray(claim.spentPolicies) || !claim.spentPolicies.length) throw new Error('The spent policies must be a non-empty list, one entry per non-lovelace policy occurrence in a UTxO spent from programmableLogicBase — a modeled transfer spending no such policy states no proof requirement to judge.');
  if (!Array.isArray(claim.mintPolicies)) throw new Error('The mint policies must be a list, one entry per policy occurrence in the transaction mint — an empty list models a transfer that mints and burns nothing.');
  if (!Array.isArray(claim.proofPolicies)) throw new Error('The proof policies must be a list, one entry per proof in the claimed list, in list order — an empty list models a transfer claiming no proofs at all.');
  const spent = claim.spentPolicies.map((p, i) => registryPolicyId(p, `Spent policy ${i + 1}`));
  const mint = claim.mintPolicies.map((p, i) => registryPolicyId(p, `Mint policy ${i + 1}`));
  const proofs = claim.proofPolicies.map((p, i) => registryPolicyId(p, `Proof ${i + 1}'s policy`));
  const spentSet = new Set(spent);
  const mintSet = new Set(mint);
  const required = [...new Set([...spent, ...mint])].sort((a, b) => registryBytesCompare(a, b));
  const proofCounts = new Map();
  for (const p of proofs) proofCounts.set(p, (proofCounts.get(p) ?? 0) + 1);
  const perPolicy = required.map(policy => ({
    policy,
    source: spentSet.has(policy) && mintSet.has(policy) ? 'spent-and-minted' : spentSet.has(policy) ? 'spent' : 'minted',
    proven: proofCounts.has(policy),
  }));
  const missing = perPolicy.filter(r => !r.proven).map(r => r.policy);
  const extra = [...new Set(proofs.filter(p => !spentSet.has(p) && !mintSet.has(p)))];
  const duplicates = [...proofCounts.entries()].filter(([, n]) => n > 1).map(([p]) => p);
  let firstOutOfOrder = null;
  for (let i = 1; i < proofs.length; i++) {
    if (registryBytesCompare(proofs[i], proofs[i - 1]) <= 0) { firstOutOfOrder = i; break; }
  }
  const completeness = { complete: missing.length === 0 && extra.length === 0 && duplicates.length === 0, missing, extra, duplicates };
  const ordering = { ordered: firstOutOfOrder === null, firstOutOfOrder };
  const valid = completeness.complete && ordering.ordered;
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    required,
    perPolicy,
    proofs,
    completeness,
    ordering,
    requiredCount: required.length,
    proofCount: proofs.length,
    spentDistinctCount: spentSet.size,
    mintDistinctCount: mintSet.size,
    overlapCount: perPolicy.filter(r => r.source === 'spent-and-minted').length,
    missingCount: missing.length,
    extraCount: extra.length,
    duplicateCount: duplicates.length,
  };
}

export const TRANSFER_PROOF_LIST_COMPARE_FIELDS = Object.freeze([
  ['status', 'Status'],
  ['required', 'Required policies'],
  ['completeness', 'Completeness'],
  ['ordering', 'Ordering'],
]);

// CIP-113 TransferAct proof-list impact, compared locally between two
// modeled versions of the SAME transfer — the transfer as checked
// against the spent, mint, and proof lists as they stood, and as it
// would stand after some later change (assembly adding a UTxO spent
// from a base address, a mint or burn joining the transaction, or the
// redeemer’s proof list being rebuilt in a different order). The
// registry, base redeemer, delegate pairing, transfer output-value,
// protocol upgrade, and global dispatch families already had this
// temporal half; the proof-list family, shipped as a single checker,
// had only the check, so a builder whose proof list conformed when
// they modeled it could not ask what a later assembly change did to
// it — and assembly is exactly where the spec’s three list
// requirements (RegistryProof Requirements, re-read this run from
// the raw upstream spec) are won or lost, because the required set is
// DERIVED from the transaction the list rides in: change what the
// transaction spends or mints and the list that was complete is
// complete no longer.
//
// Both versions are checked through checkTransferProofList itself
// (validate-once, twenty-eighth application), so comparison and
// checking can never disagree about either version, and a version
// that cannot be read (an unknown field, a spent list naming no
// policy, a policy that is not a 28-byte ID) is refused on either
// side with the checker’s reason, never compared around.
//
// Four positions are compared, in the checker’s own order: the
// status, the required policies (the distinct union the checker
// derives — the requirement itself, as the dispatch comparison’s
// delegate position is), completeness, and ordering. THE SUBSTANCE
// is what is NOT compared as a position. A required policy’s SOURCE
// is reported separately as sourceChangedPolicies, never counted:
// the requirement is the distinct union regardless of whether a
// policy arrives by spending, by minting, or by both, so a policy
// moving from spent-only to spent-and-minted (a second UTxO joins,
// a mint of the same policy is added) moves no position — the same
// one proof still covers it (pinned). The proof list’s own change
// is reported as the added/removed proof policies, never counted:
// it is the verdict positions above that say what the change did.
//
// The change is classified by its conformance story first — BECAME
// NOT CONFORMING and BECAME CONFORMING take precedence, because the
// list gaining or losing completeness or ordering is the headline
// even when the required set also moved — then STILL NOT
// CONFORMING (not conforming on both sides, but not the same
// failure: the requirement or the failing position changed
// underneath it) and REQUIREMENT CHANGED (conforming on both sides,
// but the required set is a different set of policies — the list
// survives, proving a different transfer than the one modeled
// before).
//
// Boundary honesty carries over from the checker: the comparison is
// between the two modeled versions entered — PRISM read no
// transaction and no UTxO, and comparing checks neither version and
// builds no transaction. Whether each proof is CORRECT for its
// policy remains the registry-proof checker’s and the proof
// verifier’s positions, on both sides alike.
export function diffTransferProofList(beforeClaim, afterClaim) {
  const before = checkTransferProofList(beforeClaim);
  const after = checkTransferProofList(afterClaim);
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const positionOf = v => ({ status: v.status, required: v.required, completeness: v.completeness.complete, ordering: v.ordering.ordered });
  const beforePos = positionOf(before), afterPos = positionOf(after);
  const differences = [];
  for (const [field, label] of TRANSFER_PROOF_LIST_COMPARE_FIELDS) {
    const differs = field === 'required' ? !sameList(beforePos[field], afterPos[field]) : beforePos[field] !== afterPos[field];
    if (differs) differences.push({ field, label, before: beforePos[field], after: afterPos[field] });
  }
  let change;
  if (!differences.length) change = 'unchanged';
  else if (before.valid && !after.valid) change = 'became-not-conforming';
  else if (!before.valid && after.valid) change = 'became-conforming';
  else if (!before.valid) change = 'still-not-conforming';
  else change = 'requirement-changed';
  const beforeSource = new Map(before.perPolicy.map(r => [r.policy, r.source]));
  const sourceChangedPolicies = after.perPolicy.filter(r => beforeSource.has(r.policy) && beforeSource.get(r.policy) !== r.source).map(r => r.policy);
  const beforeProofSet = new Set(before.proofs), afterProofSet = new Set(after.proofs);
  return {
    change,
    changedFields: differences.map(d => d.label),
    differences,
    sourceChangedPolicies,
    addedProofs: [...afterProofSet].filter(p => !beforeProofSet.has(p)),
    removedProofs: [...beforeProofSet].filter(p => !afterProofSet.has(p)),
    before,
    after,
    unchanged: differences.length === 0,
    changedCount: differences.length,
    positionCount: TRANSFER_PROOF_LIST_COMPARE_FIELDS.length,
  };
}

// CIP-113 protocol upgradability (spec section "Protocol
// upgradability", re-read from the raw upstream spec): the credentials
// that make up a deployment live in the protocol parameters datum as
// data, so a deployment can be re-pointed without redeploying the
// tokens that depend on it — every programmable token reads the wiring
// live at validation time.
//
// The modeled parameters name eight credentials:
// - global (programmableLogicGlobal), issuanceLogic (the protocol-level
//   issuance logic), and the three action delegates (transferDelegate,
//   thirdPartyDelegate, unfrackingDelegate) — the RE-POINTABLE wiring;
// - base (programmableLogicBase) — MUST NOT move: it is the payment
//   credential of every smart-wallet address in the deployment, so
//   changing it would relocate every holder's funds; a deployment with
//   a different base is a different deployment. (An individual token's
//   minting policy is likewise permanent, but it is per-token data, not
//   a protocol parameter, and is not modeled here.)
// - upgradeAuthority — the credential holding the right to upgrade;
//   the standard does not prescribe what it is (a key, a multisig, a
//   governance script all satisfy it), only how it may change hands.
// - nominee — the standing nominee for an authority handover, or null
//   when no handover is in progress.
//
// The spec's four requirements on the upgrade path:
// 1. An authority change is TWO-PHASE: a nomination, then a separate
//    promotion of the standing nominee. Replacing the authority in a
//    single step is not conforming, however it is authorised.
// 2. The promotion MUST be authorised by the nominee itself — the
//    evidence the incoming authority exists, can act, and consents.
// 3. A wiring change MUST NOT carry an authority change, and vice
//    versa: a handover is always a transaction of its own.
// 4. Each upgrade transaction MUST declare which kind it is.
//
// Refusal discipline holds throughout: a parameters state or claim
// that cannot be read (a missing field, a credential whose hash is not
// 28 bytes, an unknown upgrade kind) is REFUSED, never scored in part;
// a readable intent that cannot produce a conforming upgrade is
// UNPLANNABLE, with the reason named and no resulting state invented.
export const PROTOCOL_PARAMETER_FIELDS = ['global', 'issuanceLogic', 'transferDelegate', 'thirdPartyDelegate', 'unfrackingDelegate', 'base', 'upgradeAuthority', 'nominee'];
export const PROTOCOL_WIRING_FIELDS = ['global', 'issuanceLogic', 'transferDelegate', 'thirdPartyDelegate', 'unfrackingDelegate'];
export const PROTOCOL_UPGRADE_KINDS = ['wiring', 'nominate', 'promote'];

function protocolCredential(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a credential naming a kind (pubkey or script) and a 28-byte hash.`);
  for (const k of Object.keys(value)) if (k !== 'kind' && k !== 'hash') throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a credential names only a kind and a hash.`);
  if (value.kind === undefined || value.hash === undefined) throw new Error(`${label} must name both a kind (pubkey or script) and a hash.`);
  if (value.kind !== 'pubkey' && value.kind !== 'script') throw new Error(`${label}'s kind must be pubkey or script — ${JSON.stringify(value.kind)} given.`);
  return { kind: value.kind, hash: registryPolicyId(value.hash, `${label}'s hash`) };
}

function readProtocolParameters(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming the eight protocol parameters — the five wiring credentials, the base credential, the upgrade authority, and the standing nominee (or null).`);
  for (const k of Object.keys(value)) if (!PROTOCOL_PARAMETER_FIELDS.includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — the protocol parameters name only ${PROTOCOL_PARAMETER_FIELDS.join(', ')}.`);
  for (const k of PROTOCOL_PARAMETER_FIELDS) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — parameters that cannot be read in full are refused, never scored in part.`);
  const out = {};
  for (const k of PROTOCOL_PARAMETER_FIELDS) {
    if (k === 'nominee') { out.nominee = value.nominee === null ? null : protocolCredential(value.nominee, `${label}'s nominee`); continue; }
    out[k] = protocolCredential(value[k], `${label}'s ${k}`);
  }
  return out;
}

const credEq = (a, b) => (a === null && b === null) || (a !== null && b !== null && a.kind === b.kind && a.hash === b.hash);

function protocolChangedFields(before, after) {
  return PROTOCOL_PARAMETER_FIELDS.filter(k => !credEq(before[k], after[k]));
}

export function planProtocolUpgrade(beforeInput, intent) {
  const before = readProtocolParameters(beforeInput, 'The current protocol parameters');
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new Error('The upgrade intent must be an object naming a kind — wiring, nominate, or promote.');
  for (const k of Object.keys(intent)) if (!['kind', 'changes', 'nominee'].includes(k)) throw new Error(`The upgrade intent carries an unknown field ${JSON.stringify(k)} — an intent names only a kind, its changes (for a wiring upgrade), and its nominee (for a nomination).`);
  if (!PROTOCOL_UPGRADE_KINDS.includes(intent.kind)) throw new Error(`The upgrade kind must be wiring, nominate, or promote — ${JSON.stringify(intent.kind)} given. Each upgrade transaction must declare which of these it is.`);
  const unplannable = missing => ({ status: 'unplannable', kind: intent.kind, before, after: null, changedFields: [], requiredAuthorizer: null, missing });
  if (intent.kind === 'wiring') {
    if (!intent.changes || typeof intent.changes !== 'object' || Array.isArray(intent.changes)) throw new Error('A wiring upgrade must name its changes — the wiring credentials it re-points.');
    for (const k of Object.keys(intent.changes)) if (!PROTOCOL_PARAMETER_FIELDS.includes(k)) throw new Error(`The wiring changes name an unknown parameter ${JSON.stringify(k)} — the parameters are ${PROTOCOL_PARAMETER_FIELDS.join(', ')}.`);
    const changes = {};
    for (const [k, v] of Object.entries(intent.changes)) changes[k] = protocolCredential(v, `The wiring change to ${k}`);
    const missing = [];
    if (changes.base !== undefined && !credEq(changes.base, before.base)) missing.push('base-immovable');
    if (changes.upgradeAuthority !== undefined && !credEq(changes.upgradeAuthority, before.upgradeAuthority)) missing.push('authority-not-wiring');
    if (changes.nominee !== undefined && !credEq(changes.nominee, before.nominee)) missing.push('nominee-not-wiring');
    const after = { ...before };
    for (const k of PROTOCOL_WIRING_FIELDS) if (changes[k] !== undefined) after[k] = changes[k];
    const changedFields = protocolChangedFields(before, after);
    if (!changedFields.length && !missing.length) missing.push('no-wiring-change');
    if (missing.length) return unplannable(missing);
    return { status: 'planned', kind: 'wiring', before, after, changedFields, requiredAuthorizer: before.upgradeAuthority, missing: [] };
  }
  if (intent.kind === 'nominate') {
    if (intent.nominee === undefined) throw new Error('A nomination must name its nominee credential — the first phase of an authority handover names who would take over.');
    const nominee = protocolCredential(intent.nominee, 'The nominee');
    if (credEq(nominee, before.upgradeAuthority)) return unplannable(['nominee-is-authority']);
    if (credEq(nominee, before.nominee)) return unplannable(['nominee-already-standing']);
    const after = { ...before, nominee };
    return { status: 'planned', kind: 'nominate', before, after, changedFields: protocolChangedFields(before, after), requiredAuthorizer: before.upgradeAuthority, missing: [] };
  }
  // promote
  if (before.nominee === null) return unplannable(['no-standing-nominee']);
  const after = { ...before, upgradeAuthority: before.nominee, nominee: null };
  return { status: 'planned', kind: 'promote', before, after, changedFields: protocolChangedFields(before, after), requiredAuthorizer: before.nominee, missing: [] };
}

// CIP-113 protocol upgrade verification, checked locally against the
// same modeled parameters (validate-once discipline: the conforming
// shapes below are the planner's own — a wiring upgrade is what
// planProtocolUpgrade with kind wiring produces, a promotion is
// exactly the promotion of the standing nominee — so plan and check
// cannot drift). Six verdicts, because they fail separately and the
// fix differs:
// - baseImmovable: the base credential is unchanged (any move fails,
//   whatever else the transaction does well);
// - separation: no wiring field changed in a transaction that also
//   changed the authority path (the authority or the nominee) — the
//   promotion's own pair (authority takes the nominee, nominee clears)
//   is one authority step, not a mixture;
// - authorityPath: if the authority changed, it changed ONLY by
//   promotion — the new authority is the standing nominee and the
//   nomination is consumed; a direct replacement fails here however
//   it was authorised;
// - authorisation: the transaction's authoriser is the credential the
//   kind requires — the standing upgrade authority for a wiring change
//   or a nomination, the nominee itself for a promotion; an unstated
//   authoriser is 'not-stated' and the claim incomplete;
// - declaration: the declared kind is the kind the changes actually
//   are; unstated is 'not-stated'. A claim that changes nothing
//   declares no kind truthfully and fails here.
// - nomineeShape: outside a promotion, a nominee change must BE a
//   nomination — it sets a nominee, and not the sitting authority
//   (clearing the standing nominee without promoting it abandons a
//   handover half-done; there is no such step in the standard).
//
// Boundary honesty: a correct verdict proves only that the modeled
// before/after parameters and the stated authoriser satisfy the
// standard's upgrade-path rules — PRISM read no protocol parameters
// UTxO and no chain state, built no transaction, and does not judge
// whether the stated authoriser actually signed, what the deployment's
// authority credential IS (a key, a multisig, a governance script —
// the deployment's documented choice), or any token's own minting
// policy, which is permanent per-token data outside these parameters.
export function verifyProtocolUpgrade(beforeInput, claimed) {
  const before = readProtocolParameters(beforeInput, 'The current protocol parameters');
  if (!claimed || typeof claimed !== 'object' || Array.isArray(claimed)) throw new Error('The claimed upgrade must be an object naming a declared kind, the parameters after the upgrade, and the credential that authorised it.');
  for (const k of Object.keys(claimed)) if (!['declaredKind', 'after', 'authorizedBy'].includes(k)) throw new Error(`The claimed upgrade carries an unknown field ${JSON.stringify(k)} — a claim names only a declaredKind, the after parameters, and an authorizedBy credential.`);
  const declaredKind = claimed.declaredKind === undefined ? 'not-stated' : claimed.declaredKind;
  if (declaredKind !== 'not-stated' && !PROTOCOL_UPGRADE_KINDS.includes(declaredKind)) throw new Error(`The declared kind must be wiring, nominate, or promote — ${JSON.stringify(claimed.declaredKind)} given.`);
  if (claimed.after === undefined) throw new Error('The claimed upgrade must name the parameters after the upgrade — a claim without its resulting state cannot be read.');
  const after = readProtocolParameters(claimed.after, 'The claimed parameters after the upgrade');
  const authorizedBy = claimed.authorizedBy === undefined ? 'not-stated' : protocolCredential(claimed.authorizedBy, 'The claimed authoriser');
  const changedFields = protocolChangedFields(before, after);
  const wiringChanged = PROTOCOL_WIRING_FIELDS.some(k => changedFields.includes(k));
  const authorityChanged = changedFields.includes('upgradeAuthority');
  const nomineeChanged = changedFields.includes('nominee');
  const promotionShape = authorityChanged && before.nominee !== null && credEq(after.upgradeAuthority, before.nominee) && after.nominee === null;
  const derivedKind = authorityChanged ? 'promote' : nomineeChanged ? 'nominate' : wiringChanged ? 'wiring' : 'none';
  const requiredAuthorizer = authorityChanged ? before.nominee : before.upgradeAuthority;
  const verdicts = {
    baseImmovable: credEq(after.base, before.base),
    separation: !(wiringChanged && (authorityChanged || nomineeChanged)),
    authorityPath: !authorityChanged || promotionShape,
    authorisation: authorizedBy === 'not-stated' ? 'not-stated' : requiredAuthorizer !== null && credEq(authorizedBy, requiredAuthorizer),
    declaration: declaredKind === 'not-stated' ? 'not-stated' : declaredKind === derivedKind,
    nomineeShape: authorityChanged || !nomineeChanged || (after.nominee !== null && !credEq(after.nominee, before.upgradeAuthority)),
  };
  const values = Object.values(verdicts);
  const valid = values.every(v => v === true);
  const status = valid ? 'correct' : values.includes(false) ? 'incorrect' : 'incomplete';
  return { status, valid, before, after, declaredKind, derivedKind, authorizedBy, requiredAuthorizer, changedFields, wiringChanged, authorityChanged, nomineeChanged, promotionShape, verdicts };
}

export const PROTOCOL_UPGRADE_COMPARE_FIELDS = Object.freeze([
  ['status', 'status'],
  ['global', 'global'],
  ['issuanceLogic', 'issuance logic'],
  ['transferDelegate', 'transfer delegate'],
  ['thirdPartyDelegate', 'third-party delegate'],
  ['unfrackingDelegate', 'unfracking delegate'],
  ['base', 'base'],
  ['upgradeAuthority', 'upgrade authority'],
  ['nominee', 'nominee'],
]);

// CIP-113 protocol upgrade staleness, compared locally: ONE upgrade
// intent planned against TWO versions of the current protocol
// parameters — the parameters as they stood when the upgrade was
// planned, and the parameters as they stand now, after another upgrade
// may have landed first. This temporal shape differs from the other
// families' diffs (two versions of a transaction or registry): an
// upgrade intent is not consumed by a changing artifact, it is STALED
// by a changing baseline, because every plan reads the current
// parameters live — a promotion planned against a nominee who has
// since been replaced would promote whoever stands now, and a wiring
// change planned against an authority who has since handed over must
// be authorised by the successor. The registry, base redeemer,
// delegate pairing, and transfer output-value families already had
// their temporal half; this completes the family audit.
//
// Both parameter versions are planned through planProtocolUpgrade
// itself with the same intent (validate-once, twenty-sixth
// application), so comparison and planning can never disagree about
// the intent's effect against either version, and a version that
// cannot be read is refused on either side with the planner's reason,
// never compared around. The intent is one object shared by both
// plans, so it needs no target check: there is no second intent it
// could drift from.
//
// Nine positions are compared: the plan's status, and each of the
// eight resulting parameters (a side with no resulting state — an
// unplannable plan — reads null in every parameter position). THE
// SUBSTANCE is what is NOT compared as a position. The required
// authoriser is a restatement of the resulting authority in every
// planned case — for a wiring change or a nomination it IS the
// standing authority, which the plan leaves in place; for a promotion
// it IS the standing nominee, who becomes the resulting authority —
// so it differs only when the resulting authority or the status
// already differs, and counting it would double-count the authority's
// single move (pinned: an intervening nomination change moves a
// planned promotion's authoriser and its resulting authority together,
// counted once). It is reported separately as authorizerChanged. The
// plan's changedFields are likewise derived within each plan, not
// positions: an intervening upgrade that already applied part of a
// wiring intent leaves the plan changing fewer fields while landing on
// exactly the same resulting parameters, so that compares as unchanged
// with the effect change reported separately as effectChanged, never
// counted (pinned). And the intervening change itself — which current
// parameters moved between the two versions — is reported separately
// as interveningFields, never counted: it is the cause, the positions
// are the consequence for THIS intent, and an intervening change the
// intent's plan carries through untouched (a new nominee, under a
// wiring intent whose resulting nominee follows the current one) is a
// consequence, while one the plan overwrites identically (the same
// wiring change re-pointed to the same credential) is none.
//
// Classification puts the plannability story first — BECAME
// UNPLANNABLE (the intent no longer produces a conforming upgrade
// against the current parameters: the change it names is already
// applied, or the nominee it would promote no longer stands) and
// BECAME PLANNABLE take precedence — then STILL UNPLANNABLE (both
// sides unplannable, for different stated reasons), then RESULT
// CHANGED. Two unplannable plans with the same missing reasons compare
// as unchanged: the intent is equally impossible against both.
//
// Boundary honesty carries over from the planner: the comparison is
// between the two modeled parameter versions entered — PRISM read no
// protocol parameters UTxO and no chain state, and comparing applies
// neither plan and performs no upgrade.
export function diffProtocolUpgrade(plannedAgainstInput, currentInput, intent) {
  const planned = planProtocolUpgrade(plannedAgainstInput, intent);
  const current = planProtocolUpgrade(currentInput, intent);
  const valueOf = (plan, field) => field === 'status' ? plan.status : plan.after === null ? null : plan.after[field];
  const positions = PROTOCOL_UPGRADE_COMPARE_FIELDS.map(([field, label]) => {
    const before = valueOf(planned, field);
    const after = valueOf(current, field);
    const same = field === 'status' ? before === after : credEq(before, after);
    return { field, label, before, after, differs: !same };
  });
  const differing = positions.filter(p => p.differs);
  const missingSame = planned.missing.length === current.missing.length && planned.missing.every((m, i) => m === current.missing[i]);
  let change;
  if (planned.status === 'planned' && current.status === 'unplannable') change = 'became-unplannable';
  else if (planned.status === 'unplannable' && current.status === 'planned') change = 'became-plannable';
  else if (planned.status === 'unplannable' && current.status === 'unplannable') change = missingSame && !differing.length ? 'unchanged' : 'still-unplannable';
  else change = differing.length ? 'result-changed' : 'unchanged';
  const interveningFields = PROTOCOL_PARAMETER_FIELDS.filter(k => !credEq(planned.before[k], current.before[k]));
  const effectChanged = planned.changedFields.length !== current.changedFields.length || planned.changedFields.some((f, i) => f !== current.changedFields[i]);
  const authorizerChanged = !credEq(planned.requiredAuthorizer, current.requiredAuthorizer);
  return {
    change,
    kind: planned.kind,
    changedFields: differing.map(p => p.label),
    positions,
    interveningFields,
    parametersChanged: interveningFields.length > 0,
    effectChanged,
    authorizerChanged,
    before: planned,
    after: current,
    unchanged: change === 'unchanged',
    changedCount: differing.length,
    positionCount: positions.length,
  };
}

// CIP-113 transaction construction, checked locally against the spec's
// six MUST steps for DeFi protocols constructing transactions with
// programmable tokens (spec: "Implementing programmable tokens in DeFi
// protocols — Transaction Construction", re-read 2026-10-11 from the
// raw upstream spec). The spec warns that steps 1 and 3 are easy to
// omit when adapting an existing integration, because neither is
// visible in the token's own configuration: both are properties of
// the deployment, read at validation time.
//
// Until now PRISM judged each step only inside a separate family whose
// boundary names the others as not judged there — the base redeemer
// family plans the params_idx / wdrl_idx hints of steps 1 and 3, the
// dispatch checker judges the declared delegate's presence, the proof
// families judge step 2's proofs, the authorization checker judges the
// logic executions of step 5, and the smart-wallet tools derive step
// 6's addresses. A transaction could pass every family it was checked
// against and still omit a step nobody was asked about. This checker
// is the capstone: it judges the six steps TOGETHER, in the spec's
// own order, on presence and placement only.
//
// The six verdicts:
// 1. paramsRefIncluded — the protocol parameters UTxO is among the
//    transaction's reference inputs (its position, the params_idx
//    hint, is the base redeemer family's position, not this one's).
// 2. registryRefsComplete — for every distinct policy the transaction
//    touches, a registry node (its own, or the covering node proving
//    non-registration) is included as a reference input. Extra proved
//    policies are reported, never a verdict: the spec requires a node
//    for each policy touched and states no prohibition on another
//    reference input riding along. Whether each proof is CORRECT —
//    the right node, the right covering relationship — is the proof
//    families' position, not this one's.
// 3. globalInvoked — the programmableLogicGlobal credential the
//    parameters name is executed as a withdraw-zero.
// 4. delegateInvoked — the delegate credential for the declared
//    action is executed as a withdraw-zero.
// 5. logicInvoked — for every REGISTERED token touched, that token's
//    logic script for the declared action is executed as a
//    withdraw-zero. An unregistered token has no such script and
//    carries no requirement here; when no registered token is
//    modeled the verdict is null (no verdict), exactly the
//    verdictless discipline of the dispatch and paired-outputs
//    families.
// 6. outputsToSmartWallets — every output carrying a touched policy
//    sits at a smart-wallet address: its payment credential is the
//    deployment's programmableLogicBase credential and it carries a
//    stake credential. Outputs carrying no touched policy are
//    reported with NO verdict (ordinary change is not this step's
//    business); when no output carries a touched policy the verdict
//    is null — the AMOUNTS those outputs must hold are the
//    output-value family's position, not this one's.
//
// Refusal discipline as elsewhere: a claim that cannot be READ — an
// unknown or missing field, an unknown action, an empty token list, a
// policy listed twice among the tokens or the proved policies, a
// duplicated reference input or withdrawal, a registered token
// naming no logic credential or an unregistered token naming one, a
// policy listed twice in one output, any hash that is not 28 bytes —
// is refused with the reason, never scored in part. Hex case is
// canonicalised.
//
// Boundary honesty: a conforming verdict proves only that the six
// steps' presence and placement requirements hold for the modeled
// transaction entered. PRISM read no transaction, no protocol
// parameters UTxO, and no chain state, and built nothing: which
// credential the parameters name as global or delegate today, and
// which node covers an unregistered policy, are deployment data the
// builder supplies here.
export const TRANSACTION_CONSTRUCTION_VERDICTS = Object.freeze([
  ['paramsRefIncluded', 'Protocol parameters reference input'],
  ['registryRefsComplete', 'Registry node reference inputs'],
  ['globalInvoked', 'programmableLogicGlobal withdraw-zero'],
  ['delegateInvoked', 'Action delegate withdraw-zero'],
  ['logicInvoked', 'Token logic withdraw-zero'],
  ['outputsToSmartWallets', 'Programmable tokens to smart-wallet addresses only'],
]);

function constructionToken(value, index) {
  const label = `Token ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming its policy, whether it is registered, and its logic credential for the declared action.`);
  for (const k of Object.keys(value)) if (!['policy', 'registered', 'logicCredential'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled token names only its policy, its registered flag, and its logic credential.`);
  for (const k of ['policy', 'registered', 'logicCredential']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — a token that cannot be read in full is refused, never scored in part. The logic credential may be null for an unregistered token, but the field must be stated.`);
  const policy = registryPolicyId(value.policy, `${label}'s policy`);
  if (typeof value.registered !== 'boolean') throw new Error(`${label}'s registered flag must be true or false — ${JSON.stringify(value.registered)} given.`);
  if (value.registered && value.logicCredential === null) throw new Error(`${label} is registered but names no logic credential — a registered token's logic script for the declared action is exactly what step 5 must invoke.`);
  if (!value.registered && value.logicCredential !== null) throw new Error(`${label} is unregistered but names a logic credential — an unregistered token has no registry node and no logic script; it is treated as an ordinary native token.`);
  const logicCredential = value.logicCredential === null ? null : baseCredential(value.logicCredential, `${label}'s logic credential`);
  return { policy, registered: value.registered, logicCredential };
}

function constructionOutput(value, index) {
  const label = `Output ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming its payment credential, its stake credential, and the policies it carries.`);
  for (const k of Object.keys(value)) if (!['payment', 'stake', 'policies'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled output names only its payment credential, its stake credential, and the policies it carries.`);
  for (const k of ['payment', 'stake', 'policies']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — an output that cannot be read in full is refused, never scored in part. The stake credential may be null, but the field must be stated.`);
  const payment = baseCredential(value.payment, `${label}'s payment credential`);
  const stake = value.stake === null ? null : baseCredential(value.stake, `${label}'s stake credential`);
  if (!Array.isArray(value.policies)) throw new Error(`${label}'s policies must be an array of policy IDs.`);
  const policies = value.policies.map((pol, i) => registryPolicyId(pol, `${label}'s policy ${i + 1}`));
  const seen = new Set();
  for (const pol of policies) {
    if (seen.has(pol)) throw new Error(`${label} lists policy ${pol} more than once — one output holds each policy's value once, as a single quantity.`);
    seen.add(pol);
  }
  return { payment, stake, policies };
}

export function checkTransactionConstruction(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The construction claim must be an object naming the declared action, the deployment credentials, the tokens touched, the reference inputs and the one holding the protocol parameters, the policies proved by a registry reference input, the withdrawals, and the outputs.');
  const inputFields = ['action', 'base', 'globalCredential', 'delegateCredential', 'tokens', 'referenceInputs', 'paramsRef', 'registryRefPolicies', 'withdrawals', 'outputs'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The construction claim carries an unknown field ${JSON.stringify(k)} — it names only the declared action, the base, global, and delegate credentials, the tokens, the reference inputs, the parameters reference, the proved policies, the withdrawals, and the outputs.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The construction claim is missing its ${JSON.stringify(k)} field — a claim that cannot be read in full is refused, never scored in part.`);
  const action = globalDispatchAction(claim.action);
  const base = baseCredential(claim.base, 'The programmableLogicBase credential');
  const globalCredential = baseCredential(claim.globalCredential, 'The programmableLogicGlobal credential');
  const delegateCredential = baseCredential(claim.delegateCredential, 'The action delegate credential');
  if (!Array.isArray(claim.tokens) || !claim.tokens.length) throw new Error('The tokens touched must be a non-empty array — a construction touching no policy is not a programmable-token construction.');
  const tokens = claim.tokens.map((t, i) => constructionToken(t, i));
  const tokenPolicies = new Set();
  for (const t of tokens) {
    if (tokenPolicies.has(t.policy)) throw new Error(`Policy ${t.policy} is listed more than once among the tokens — the transaction touches each distinct policy once, however many UTxOs or mint entries carry it.`);
    tokenPolicies.add(t.policy);
  }
  const referenceInputs = baseReferenceInputs(claim.referenceInputs);
  if (typeof claim.paramsRef !== 'string' || !claim.paramsRef.trim()) throw new Error('The protocol parameters reference must name one of the reference inputs — the UTxO holding the protocol parameters NFT.');
  const paramsRef = claim.paramsRef.trim();
  if (!Array.isArray(claim.registryRefPolicies)) throw new Error('The proved policies must be an array of policy IDs — the policies a registry node reference input is included for.');
  const registryRefPolicies = claim.registryRefPolicies.map((pol, i) => registryPolicyId(pol, `Proved policy ${i + 1}`));
  const provedSet = new Set();
  for (const pol of registryRefPolicies) {
    if (provedSet.has(pol)) throw new Error(`Policy ${pol} is proved more than once — one registry node reference input proves each policy once.`);
    provedSet.add(pol);
  }
  const withdrawals = baseWithdrawals(claim.withdrawals);
  if (!Array.isArray(claim.outputs)) throw new Error('The outputs must be an array — the transaction outputs, each naming its payment and stake credentials and the policies it carries.');
  const outputs = claim.outputs.map((o, i) => constructionOutput(o, i));
  const inWithdrawals = c => withdrawals.some(w => w.kind === c.kind && w.hash === c.hash);
  const sameCred = (a, b) => a.kind === b.kind && a.hash === b.hash;
  const paramsRefIncluded = referenceInputs.includes(paramsRef);
  const missingPolicies = tokens.map(t => t.policy).filter(pol => !provedSet.has(pol));
  const extraProvedPolicies = registryRefPolicies.filter(pol => !tokenPolicies.has(pol));
  const registryRefsComplete = missingPolicies.length === 0;
  const globalInvoked = inWithdrawals(globalCredential);
  const delegateInvoked = inWithdrawals(delegateCredential);
  const logicResults = tokens.map(t => ({
    policy: t.policy,
    registered: t.registered,
    logicCredential: t.logicCredential,
    invoked: t.registered ? inWithdrawals(t.logicCredential) : null,
  }));
  const registeredResults = logicResults.filter(r => r.registered);
  const logicInvoked = registeredResults.length ? registeredResults.every(r => r.invoked) : null;
  const outputResults = outputs.map((o, i) => {
    const carried = o.policies.filter(pol => tokenPolicies.has(pol));
    return {
      index: i,
      carriedPolicies: carried,
      toSmartWallet: carried.length ? (sameCred(o.payment, base) && o.stake !== null) : null,
    };
  });
  const carryingResults = outputResults.filter(r => r.carriedPolicies.length);
  const outputsToSmartWallets = carryingResults.length ? carryingResults.every(r => r.toSmartWallet) : null;
  const verdicts = { paramsRefIncluded, registryRefsComplete, globalInvoked, delegateInvoked, logicInvoked, outputsToSmartWallets };
  const valid = Object.values(verdicts).every(v => v === true || v === null);
  return {
    status: valid ? 'conforming' : 'not-conforming',
    valid,
    action,
    base,
    globalCredential,
    delegateCredential,
    tokens,
    referenceInputs,
    paramsRef,
    registryRefPolicies,
    withdrawals,
    outputs,
    verdicts,
    missingPolicies,
    extraProvedPolicies,
    logicResults,
    outputResults,
  };
}

export const SUBSTANDARD_VERIFICATION_ACTIONS = Object.freeze(['freeze', 'unfreeze', 'seize', 'forced-transfer', 'rebase', 'other']);
export const SUBSTANDARD_TRIGGER_AUTHORITIES = Object.freeze(['designated-key-set', 'anyone', 'restricted-non-reducing', 'undetermined']);
export const SUBSTANDARD_VERIFICATION_VERDICTS = Object.freeze([
  ['actionsAnswered', 'Third-party actions without holder consent (question a)'],
  ['authorityAnswered', 'Who can trigger them (question b)'],
  ['restrictionHolds', 'Restricted to actions that cannot reduce a holder’s balance'],
]);

function substandardAction(value, index) {
  const label = `Third-party action ${index + 1}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object naming the action and whether it can reduce a holder’s balance.`);
  for (const k of Object.keys(value)) if (!['action', 'reducesBalance'].includes(k)) throw new Error(`${label} carries an unknown field ${JSON.stringify(k)} — a modeled third-party action names only the action and whether it can reduce a holder’s balance.`);
  for (const k of ['action', 'reducesBalance']) if (value[k] === undefined) throw new Error(`${label} is missing its ${JSON.stringify(k)} field — an action that cannot be read in full is refused, never scored in part.`);
  if (!SUBSTANDARD_VERIFICATION_ACTIONS.includes(value.action)) throw new Error(`${label}’s action must be one of ${SUBSTANDARD_VERIFICATION_ACTIONS.join(', ')} — ${JSON.stringify(value.action)} given. Name a capability the list does not enumerate as other, and say whether it can reduce a holder’s balance.`);
  if (typeof value.reducesBalance !== 'boolean') throw new Error(`${label}’s reducesBalance flag must be true or false — ${JSON.stringify(value.reducesBalance)} given.`);
  return { action: value.action, reducesBalance: value.reducesBalance };
}

// CIP-113 substandard verification, checked locally against the profile
// an integrator enters from reviewing one substandard (spec:
// "Implementing programmable tokens in DeFi protocols — Security
// Considerations" #1, the Lending section's SHOULD, and "Existing
// substandards", all re-read 2026-10-11).
//
// Before integrating a programmable token — above all before accepting
// it as collateral — the spec requires verifying its substandard by
// reviewing its thirdPartyLogicScript and answering TWO INDEPENDENT
// questions: (a) WHAT actions can it authorise without the holder's
// consent (freeze, seize, forced transfer, rebase, etc.), and (b) WHO
// can trigger them. The standard does not constrain either answer — a
// script may be permissioned, permissionless, or restricted to actions
// that cannot reduce a holder's balance — so neither question can be
// answered from CIP-113 conformance alone, and PRISM's other panels,
// which model what the reference substandards DO, never judge whether
// an integrator has answered the two questions for the substandard in
// front of them. This checker judges exactly that, on the profile the
// reviewer enters:
//   1. actionsAnswered — the reviewer attests the entered list is the
//      COMPLETE set of third-party actions the script can authorise
//      without the holder's consent. An incomplete review leaves
//      question (a) unanswered, however many actions it names.
//   2. authorityAnswered — the trigger authority is determined:
//      a designated key set (whose members the claim names — where a
//      script requires signatures from a designated key set, that set
//      is the substandard's admin), anyone (permissionless), or a
//      script restricted to non-reducing actions. 'undetermined'
//      states honestly that question (b) is still open.
//   3. restrictionHolds — only where the authority is claimed as
//      restricted-non-reducing: no entered action may reduce a
//      holder's balance. For every other authority the position is
//      null, NO VERDICT: a permissioned or permissionless script is
//      not claimed to be restricted, and the checker invents no
//      restriction it was not told about.
// The balance exposure is DERIVED and reported, never scored as a
// verdict: the actions that can reduce a holder's balance, and whether
// any exist. A profile can therefore VERIFY with a balance-reducing
// exposure — freeze-and-seize does — because verification means the
// two questions are answered, not that the answers are comfortable;
// whether to accept such a token as collateral is the integrator's
// decision, made with the exposure in front of them. A claim that
// cannot be read is refused, never scored in part: an unknown or
// missing field, a duplicated action, a designated key set naming no
// key, a permissionless authority naming an admin set it by definition
// does not have, a non-28-byte admin hash. Local model only: PRISM
// read no substandard script and no chain state — the profile is the
// reviewer's own review, entered here, and this checker judges its
// completeness and consistency, not the substandard itself.
export function checkSubstandardVerification(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The verification profile must be an object naming the third-party actions the substandard can authorise without the holder’s consent, whether that list is complete, who can trigger them, and the admin credentials where a designated key set triggers them.');
  const inputFields = ['actions', 'actionsComplete', 'triggerAuthority', 'adminCredentials'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The verification profile carries an unknown field ${JSON.stringify(k)} — it names only the third-party actions, whether that list is complete, the trigger authority, and the admin credentials.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The verification profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part. The admin credentials may be an empty array, but the field must be stated.`);
  if (!Array.isArray(claim.actions)) throw new Error('The third-party actions must be an array — the actions the substandard’s thirdPartyLogicScript can authorise without the holder’s consent, each naming whether it can reduce a holder’s balance. An empty array states the script authorises none.');
  const actions = claim.actions.map((a, i) => substandardAction(a, i));
  const seenActions = new Set();
  for (const a of actions) {
    if (seenActions.has(a.action)) throw new Error(`Action ${JSON.stringify(a.action)} is listed more than once — the profile names each third-party action once, with its single balance effect.`);
    seenActions.add(a.action);
  }
  if (typeof claim.actionsComplete !== 'boolean') throw new Error(`The actionsComplete flag must be true or false — ${JSON.stringify(claim.actionsComplete)} given. It attests whether the entered list is the complete set the script can authorise.`);
  if (!SUBSTANDARD_TRIGGER_AUTHORITIES.includes(claim.triggerAuthority)) throw new Error(`The trigger authority must be one of ${SUBSTANDARD_TRIGGER_AUTHORITIES.join(', ')} — ${JSON.stringify(claim.triggerAuthority)} given.`);
  if (!Array.isArray(claim.adminCredentials)) throw new Error('The admin credentials must be an array of credentials — the designated key set that can trigger the third-party actions, where the substandard has one.');
  const adminCredentials = claim.adminCredentials.map((c, i) => baseCredential(c, `Admin credential ${i + 1}`));
  const seenAdmins = new Set();
  for (const c of adminCredentials) {
    const key = `${c.kind}:${c.hash}`;
    if (seenAdmins.has(key)) throw new Error(`Admin credential ${c.hash} (${c.kind}) is listed more than once — a designated key set names each member once.`);
    seenAdmins.add(key);
  }
  if (claim.triggerAuthority === 'designated-key-set' && !adminCredentials.length) throw new Error('A designated-key-set authority names no admin credential — where a script requires signatures from a designated key set, that set is the substandard’s admin, and a permissioned profile that names none of its members cannot be read.');
  if (claim.triggerAuthority === 'anyone' && adminCredentials.length) throw new Error('A permissionless (anyone) authority names admin credentials — a script anyone can trigger has no designated key set; naming one contradicts the authority it claims.');
  const reducingActions = actions.filter(a => a.reducesBalance).map(a => a.action);
  const canReduceHolderBalance = reducingActions.length > 0;
  const actionsAnswered = claim.actionsComplete;
  const authorityAnswered = claim.triggerAuthority !== 'undetermined';
  const restrictionHolds = claim.triggerAuthority === 'restricted-non-reducing' ? !canReduceHolderBalance : null;
  const verdicts = { actionsAnswered, authorityAnswered, restrictionHolds };
  const valid = actionsAnswered && authorityAnswered && restrictionHolds !== false;
  const exposure = canReduceHolderBalance ? 'balance-reducing' : actions.length ? 'non-reducing' : 'no-third-party-actions';
  return {
    status: valid ? 'verified' : 'not-verified',
    valid,
    actions,
    actionsComplete: claim.actionsComplete,
    triggerAuthority: claim.triggerAuthority,
    adminCredentials,
    adminCount: adminCredentials.length,
    verdicts,
    reducingActions,
    canReduceHolderBalance,
    exposure,
  };
}

export const WALLET_DERIVATIONS = Object.freeze(['base-plus-stake', 'ordinary-address-only', 'none']);
export const WALLET_STAKE_SOURCES = Object.freeze(['payment', 'staking', 'either', 'none']);
export const WALLET_QUERY_SOURCES = Object.freeze(['smart-wallet', 'ordinary-address', 'none']);
export const WALLET_IDENTIFICATIONS = Object.freeze(['registry-key', 'hardcoded-list', 'none']);
export const WALLET_NATIVE_TRANSFERS = Object.freeze(['builds', 'does-not-build']);
export const WALLET_READINESS_VERDICTS = Object.freeze([
  ['derivesSmartWallet', 'Smart-wallet address derivation'],
  ['balanceQueries', 'Balance queries at the smart-wallet address'],
  ['historyTracks', 'Transaction history at the smart-wallet address'],
  ['identifiesViaRegistry', 'Programmable-token identification via the registry'],
]);

function walletEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// CIP-113 wallet readiness, checked locally against the capability
// profile a reviewer enters for one wallet (spec: "Implementing
// programmable tokens in wallets and dApps", with "Address Derivation",
// "Balance Queries", "Identifying Programmable Tokens", and
// "Transaction History", all re-read 2026-10-11).
//
// A wallet supporting programmable tokens MUST implement balance
// queries (displaying the holder's programmable-token holdings) and
// transaction history (tracking transfers in and out of the user's
// smart wallet). Both duties are duties AT THE SMART-WALLET ADDRESS:
// balances are the UTxOs at the user's programmable-token address, and
// history follows the balance changes there — a wallet querying the
// user's ordinary address performs the gestures while looking where
// programmable tokens never live. Two further positions complete the
// section. The wallet must be able to derive that address — the
// smart-wallet format is the deployment's programmableLogicBase as
// payment credential with the user's own stake credential — and,
// before treating any token as programmable, it must identify it the
// spec's way: checking whether the token's policy ID exists as a key
// in the registry, decoding the registry entries' datums. A hardcoded
// list is not that check: it goes stale as registrations land and
// cannot prove a negative. PRISM's own wallet tools derive and verify
// single addresses and connect read-only, but no panel judged the
// four duties together for a wallet as a whole. This checker judges
// exactly that, on the entered profile:
//   1. derivesSmartWallet — the derivation is base-plus-stake.
//   2. balanceQueries — balances are queried at the smart-wallet
//      address (the UTxOs there), not the ordinary address.
//   3. historyTracks — history tracks transfers in and out of the
//      smart-wallet address, not the ordinary address.
//   4. identifiesViaRegistry — identification checks the policy as a
//      registry key, not a hardcoded list.
// Two profile facts are REPORTED, never scored, because the spec
// itself scores neither: the stake-credential source (the credential
// may be derived from the user's payment key or their staking key —
// the choice is up to the team developing the substandard, so
// 'payment', 'staking', and 'either' are all conforming), and native
// transfers (building TransferAct transactions is the list's third
// item, expressly optional — nice-to-have — so a ready wallet may
// lack it, and building it cannot rescue a wallet failing a MUST).
// Issuance and third-party operations are not wallet duties at all:
// the spec assigns them to token-specific dApps, so the profile names
// no such field. A claim that cannot be read is refused, never scored
// in part: an unknown or missing field, an unknown value, a
// base-plus-stake derivation naming no stake source (the derivation
// IS the base plus a stake credential, so a profile naming none
// cannot be read), and a stake source named where no smart-wallet
// derivation is claimed (no derivation in play names nothing).
// Local model only: PRISM inspected no wallet and read no chain
// state — the profile is the reviewer's own reading of the wallet,
// entered here, and this checker judges its completeness and
// consistency against the spec's wallet duties.
export function checkWalletReadiness(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The wallet profile must be an object naming how the wallet derives the smart-wallet address, which credential it derives the stake position from, where it queries balances, where it tracks history, how it identifies programmable tokens, and whether it builds native transfers.');
  const inputFields = ['derivation', 'stakeSource', 'balanceSource', 'historySource', 'identification', 'nativeTransfers'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The wallet profile carries an unknown field ${JSON.stringify(k)} — it names only the derivation, the stake source, the balance source, the history source, the identification method, and native transfers. Issuance and third-party operations are not wallet duties — the spec assigns them to token-specific dApps — so the profile names no such field.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The wallet profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const derivation = walletEnum(claim.derivation, WALLET_DERIVATIONS, 'The derivation');
  const stakeSource = walletEnum(claim.stakeSource, WALLET_STAKE_SOURCES, 'The stake source');
  const balanceSource = walletEnum(claim.balanceSource, WALLET_QUERY_SOURCES, 'The balance source');
  const historySource = walletEnum(claim.historySource, WALLET_QUERY_SOURCES, 'The history source');
  const identification = walletEnum(claim.identification, WALLET_IDENTIFICATIONS, 'The identification method');
  const nativeTransfers = walletEnum(claim.nativeTransfers, WALLET_NATIVE_TRANSFERS, 'The native transfers field');
  if (derivation === 'base-plus-stake' && stakeSource === 'none') throw new Error('A base-plus-stake derivation names no stake source — the smart-wallet address IS the programmableLogicBase payment credential plus the user’s stake credential, so a derivation claiming that form while naming no credential it derives the stake position from cannot be read.');
  if (derivation !== 'base-plus-stake' && stakeSource !== 'none') throw new Error('A stake source is named where no smart-wallet derivation is claimed — the stake source is a property of the base-plus-stake derivation, and a profile that does not claim that derivation names no such source.');
  const verdicts = {
    derivesSmartWallet: derivation === 'base-plus-stake',
    balanceQueries: balanceSource === 'smart-wallet',
    historyTracks: historySource === 'smart-wallet',
    identifiesViaRegistry: identification === 'registry-key',
  };
  const valid = Object.values(verdicts).every(v => v === true);
  return {
    status: valid ? 'ready' : 'not-ready',
    valid,
    derivation,
    stakeSource,
    balanceSource,
    historySource,
    identification,
    nativeTransfers,
    buildsNativeTransfers: nativeTransfers === 'builds',
    verdicts,
  };
}

export const DEX_LP_DESTINATIONS = Object.freeze(['smart-wallet', 'ordinary-address', 'pool-address']);
export const DEX_SWAP_PARTS = Object.freeze(['included', 'omitted']);
export const DEX_BATCHER_MODES = Object.freeze(['batches', 'single', 'none']);
export const DEX_BATCHER_REF_INPUTS = Object.freeze(['all', 'partial', 'none', 'not-applicable']);
export const DEX_INTEGRATION_VERDICTS = Object.freeze([
  ['lpToSmartWallet', 'Liquidity provision to the user’s smart wallet'],
  ['swapInvokesTransferLogic', 'Swap transferLogicScript withdrawal'],
  ['swapReferencesRegistry', 'Swap registryNode reference input'],
  ['batcherReferencesAll', 'Batcher reference inputs'],
]);

function dexEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// CIP-113 DEX integration, checked locally against the integration
// profile a reviewer enters for one DEX (spec: "Implementing
// programmable tokens in DeFi protocols", "DEX Integration", re-read
// 2026-10-11).
//
// The DEX section names three duties. (1) Liquidity provision: LP
// tokens involving programmable tokens MUST be sent to the user's
// smart wallet address — the LP position is itself a programmable-
// token holding, so it lives where programmable tokens live, not at
// the user's ordinary address and not pooled at the DEX. (2) Swaps:
// a swap transaction MUST include the transferLogicScript withdrawal
// (the withdraw-zero pattern) AND the relevant registryNode as a
// reference input — two halves of one sentence, judged as two
// positions, because a swap can carry either without the other.
// (3) Batcher integration: batchers CAN process programmable-token
// swaps by including all required reference inputs and batching
// multiple transfers in a single transaction. PRISM's transaction
// construction checker judges the swap halves inside a generic
// transaction, but the LP destination is judged nowhere and the
// batcher's reference-input completeness is judged nowhere, and no
// panel judged the three together for a DEX as a whole. This checker
// judges exactly that, on the entered profile:
//   1. lpToSmartWallet — LP tokens go to the user's smart wallet.
//   2. swapInvokesTransferLogic — swaps include the
//      transferLogicScript withdraw-zero.
//   3. swapReferencesRegistry — swaps include the relevant
//      registryNode as a reference input.
//   4. batcherReferencesAll — where a batcher is in play, it
//      includes ALL required reference inputs; null (NO VERDICT)
//      where no batcher is claimed, because no batcher in play
//      names nothing to judge.
// The batcher's existence and shape are REPORTED, never scored:
// the spec's batcher sentence is a capability ("batchers can
// process"), not a duty — a DEX with no batcher fails no MUST, the
// preloaded example is ready with none, and batching many transfers
// versus processing them one at a time is reported the same way.
// What IS scored, when a batcher exists, is the condition the spec
// itself attaches to batcher processing: all required reference
// inputs — a batcher carrying only some of them has not performed
// the integration the sentence describes. A claim that cannot be
// read is refused, never scored in part: an unknown or missing
// field, an unknown value, a batcher reference-input handling named
// where no batcher is claimed (no batcher in play names nothing —
// the v1.121 stake-source discipline), and reference inputs named
// not-applicable where a batcher IS claimed (a batcher in play has
// reference inputs to account for).
// Local model only: PRISM inspected no DEX and read no chain
// state — the profile is the reviewer's own reading of the DEX,
// entered here, and this checker judges its completeness and
// consistency against the spec's DEX duties.
export function checkDexIntegration(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The DEX profile must be an object naming where its LP tokens are sent, whether its swaps include the transferLogicScript withdrawal and the registryNode reference input, whether a batcher processes its swaps, and which reference inputs that batcher includes.');
  const inputFields = ['lpDestination', 'swapTransferLogic', 'swapRegistryRef', 'batcher', 'batcherRefInputs'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The DEX profile carries an unknown field ${JSON.stringify(k)} — it names only the LP destination, the swap transfer logic, the swap registry reference, the batcher mode, and the batcher reference inputs.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The DEX profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const lpDestination = dexEnum(claim.lpDestination, DEX_LP_DESTINATIONS, 'The LP destination');
  const swapTransferLogic = dexEnum(claim.swapTransferLogic, DEX_SWAP_PARTS, 'The swap transfer logic field');
  const swapRegistryRef = dexEnum(claim.swapRegistryRef, DEX_SWAP_PARTS, 'The swap registry reference field');
  const batcher = dexEnum(claim.batcher, DEX_BATCHER_MODES, 'The batcher mode');
  const batcherRefInputs = dexEnum(claim.batcherRefInputs, DEX_BATCHER_REF_INPUTS, 'The batcher reference inputs field');
  if (batcher === 'none' && batcherRefInputs !== 'not-applicable') throw new Error('Batcher reference inputs are named where no batcher is claimed — the reference-input handling is a property of a batcher in play, and a profile that claims no batcher names no such handling.');
  if (batcher !== 'none' && batcherRefInputs === 'not-applicable') throw new Error('A batcher is claimed while its reference inputs are named not-applicable — a batcher in play includes some set of reference inputs, and the profile must say which.');
  const verdicts = {
    lpToSmartWallet: lpDestination === 'smart-wallet',
    swapInvokesTransferLogic: swapTransferLogic === 'included',
    swapReferencesRegistry: swapRegistryRef === 'included',
    batcherReferencesAll: batcher === 'none' ? null : batcherRefInputs === 'all',
  };
  const valid = verdicts.lpToSmartWallet && verdicts.swapInvokesTransferLogic && verdicts.swapReferencesRegistry && verdicts.batcherReferencesAll !== false;
  return {
    status: valid ? 'ready' : 'not-ready',
    valid,
    lpDestination,
    swapTransferLogic,
    swapRegistryRef,
    batcher,
    batcherRefInputs,
    hasBatcher: batcher !== 'none',
    batchesTransfers: batcher === 'batches',
    verdicts,
  };
}

export const LENDING_COLLATERAL_DESTINATIONS = Object.freeze(['protocol-smart-wallet', 'protocol-ordinary-address', 'user-smart-wallet']);
export const LENDING_TRANSFER_LOGIC = Object.freeze(['applies', 'skipped']);
export const LENDING_LIQUIDATION_PROOFS = Object.freeze(['included', 'omitted']);
export const LENDING_SUBSTANDARD_VERIFICATION = Object.freeze(['verified', 'not-verified']);
export const LENDING_INTEGRATION_VERDICTS = Object.freeze([
  ['collateralToProtocolSmartWallet', 'Collateral received at the protocol’s smart wallet'],
  ['depositInvokesTransferLogic', 'Transfer logic validation on deposit'],
  ['withdrawalInvokesTransferLogic', 'Transfer logic validation on withdrawal'],
  ['liquidationIncludesRegistryProofs', 'Liquidation registry proofs'],
]);

function lendingEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// CIP-113 lending integration, checked locally against the integration
// profile a reviewer enters for one lending protocol (spec:
// "Implementing programmable tokens in DeFi protocols", "Lending
// Protocols", re-read 2026-10-11).
//
// The lending section names the duties in three items. (1) Collateral:
// protocols receive tokens at a smart wallet address THEY CONTROL —
// collateral lives where programmable tokens live, at a smart-wallet
// address, and the address must be the protocol's own: tokens received
// at the user's smart wallet are not received by the protocol at all,
// and tokens received at an ordinary protocol address sit where
// programmable tokens never live. The same item adds that
// transferLogicScript validation applies during deposit AND withdrawal
// — two moments, judged as two positions, because a protocol can apply
// the token's logic when collateral arrives and skip it when collateral
// leaves. (2) Liquidations: liquidation transactions MUST include
// proper registry proofs — the liquidation is a transfer like any
// other, and it carries its proof of each token's registration (or
// non-registration) with it. (3) Substandard considerations: protocols
// SHOULD verify the substandard before accepting tokens as collateral,
// because some substandards permit third-party actions that move tokens
// without the holder's consent, which could affect collateral.
// PRISM's transaction families judge registry proofs and logic
// invocation inside generic transactions, and its substandard
// verification checker judges an integrator's diligence profile on its
// own, but the collateral destination was judged nowhere, the
// deposit/withdrawal pair was judged nowhere, and no panel judged the
// lending duties together for a lending protocol as a whole. This
// checker judges exactly that, on the entered profile:
//   1. collateralToProtocolSmartWallet — collateral is received at a
//      smart wallet address the protocol controls.
//   2. depositInvokesTransferLogic — transferLogicScript validation
//      applies during deposit.
//   3. withdrawalInvokesTransferLogic — transferLogicScript validation
//      applies during withdrawal.
//   4. liquidationIncludesRegistryProofs — liquidation transactions
//      include proper registry proofs.
// The substandard verification is REPORTED, never scored: the spec's
// word for it is SHOULD — a recommendation, not a MUST — and PRISM's
// own precedent is the registry-insert checker's protocol-minimum
// SHOULD, which the model reports with no verdict rather than failing
// a registration the registry itself would accept. So a protocol can
// be ready on every MUST while its substandard verification is
// reported as not done — the recommendation stands in front of the
// reviewer either way — and verifying the substandard, however
// carefully, cannot rescue a protocol failing a MUST. What the
// verification itself consists of — the two questions of the
// substandard verification checker — is that checker's position, not
// repeated here. A claim that cannot be read is refused, never scored
// in part: an unknown or missing field, an unknown value. The lending
// section states no conditional field, so no conditional refusal is
// invented for it.
// Local model only: PRISM inspected no lending protocol and read no
// chain state — the profile is the reviewer's own reading of the
// protocol, entered here, and this checker judges its completeness
// and consistency against the spec's lending duties.
export function checkLendingIntegration(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The lending profile must be an object naming where collateral is received, whether transfer logic validation applies on deposit and on withdrawal, whether liquidations include registry proofs, and whether the substandard was verified before acceptance.');
  const inputFields = ['collateralDestination', 'depositTransferLogic', 'withdrawalTransferLogic', 'liquidationRegistryProofs', 'substandardVerification'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The lending profile carries an unknown field ${JSON.stringify(k)} — it names only the collateral destination, the deposit transfer logic, the withdrawal transfer logic, the liquidation registry proofs, and the substandard verification.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The lending profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const collateralDestination = lendingEnum(claim.collateralDestination, LENDING_COLLATERAL_DESTINATIONS, 'The collateral destination');
  const depositTransferLogic = lendingEnum(claim.depositTransferLogic, LENDING_TRANSFER_LOGIC, 'The deposit transfer logic field');
  const withdrawalTransferLogic = lendingEnum(claim.withdrawalTransferLogic, LENDING_TRANSFER_LOGIC, 'The withdrawal transfer logic field');
  const liquidationRegistryProofs = lendingEnum(claim.liquidationRegistryProofs, LENDING_LIQUIDATION_PROOFS, 'The liquidation registry proofs field');
  const substandardVerification = lendingEnum(claim.substandardVerification, LENDING_SUBSTANDARD_VERIFICATION, 'The substandard verification field');
  const verdicts = {
    collateralToProtocolSmartWallet: collateralDestination === 'protocol-smart-wallet',
    depositInvokesTransferLogic: depositTransferLogic === 'applies',
    withdrawalInvokesTransferLogic: withdrawalTransferLogic === 'applies',
    liquidationIncludesRegistryProofs: liquidationRegistryProofs === 'included',
  };
  const valid = Object.values(verdicts).every(v => v === true);
  return {
    status: valid ? 'ready' : 'not-ready',
    valid,
    collateralDestination,
    depositTransferLogic,
    withdrawalTransferLogic,
    liquidationRegistryProofs,
    substandardVerification,
    substandardVerified: substandardVerification === 'verified',
    verdicts,
  };
}

export const VAULT_DEPOSIT_DESTINATIONS = Object.freeze(['vault-smart-wallet', 'vault-ordinary-address', 'user-smart-wallet']);
export const VAULT_TRANSFER_VALIDATION = Object.freeze(['applies', 'skipped']);
export const VAULT_WITHDRAWAL_DESTINATIONS = Object.freeze(['user-smart-wallet', 'user-ordinary-address', 'vault-smart-wallet']);
export const VAULT_INTEGRATION_VERDICTS = Object.freeze([
  ['depositsToVaultSmartWallet', 'Deposits received at the vault’s smart wallet'],
  ['interProtocolTransfersValidated', 'Validation on each inter-protocol transfer'],
  ['withdrawalsToUserSmartWallet', 'Withdrawals sent to the user’s smart wallet'],
]);

function vaultEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// CIP-113 yield aggregators and vaults, checked locally against the
// profile a reviewer enters for one vault (spec: "Implementing
// programmable tokens in DeFi protocols", "Yield Aggregators and
// Vaults", re-read 2026-10-11).
//
// The vault subsection states NO MUST and NO SHOULD — unlike the DEX
// subsection beside it, which imposes MUSTs, and the lending
// subsection, which adds a SHOULD. It lists, descriptively, three
// practices by which vaults manage programmable tokens: (1) receiving
// deposits at the vault's smart wallet address, (2) moving tokens
// between protocols with proper validation on each transfer, and
// (3) sending withdrawals to users' smart wallet addresses. This
// checker therefore judges FOLLOWING THE LISTED PRACTICES, and says
// so wherever it renders: READY here means the entered profile
// follows all three listed practices — it does not mean the vault
// meets a duty, because this subsection imposes none, and this
// checker invents none. A vault that skips a listed practice is not
// managing programmable tokens the way the section describes, and
// the missing practice names what it does differently.
// PRISM judged none of the three for a vault as a whole: the DEX
// checker judges where LP tokens go and the lending checker where a
// protocol receives collateral, but a vault deposit is neither; the
// transaction families judge validation inside single transactions,
// not a vault's practice across every inter-protocol move; and no
// panel judged where a vault sends withdrawals. This checker judges
// exactly that, on the entered profile:
//   1. depositsToVaultSmartWallet — deposits are received at the
//      vault's own smart wallet (the user's smart wallet fails too —
//      a deposit left there has not been received by the vault).
//   2. interProtocolTransfersValidated — moving tokens between
//      protocols applies proper validation on EACH transfer (one
//      position: the practice is stated per-transfer, so validating
//      some moves and not others is not the listed practice).
//   3. withdrawalsToUserSmartWallet — withdrawals are sent to the
//      user's smart wallet (the vault's own smart wallet fails too —
//      a withdrawal still sitting at the vault has not been sent to
//      the user — as does the user's ordinary address, where
//      programmable tokens never live).
// A claim that cannot be read is refused, never scored in part: an
// unknown or missing field, an unknown value. The section states no
// conditional field, so no conditional refusal is invented for it.
// Local model only: PRISM inspected no vault and read no chain
// state — the profile is the reviewer's own reading of the vault,
// entered here, and this checker judges its completeness and
// consistency against the spec's listed vault practices.
export function checkVaultIntegration(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The vault profile must be an object naming where deposits are received, whether proper validation applies on each transfer between protocols, and where withdrawals are sent.');
  const inputFields = ['depositDestination', 'transferValidation', 'withdrawalDestination'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The vault profile carries an unknown field ${JSON.stringify(k)} — it names only the deposit destination, the transfer validation, and the withdrawal destination.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The vault profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const depositDestination = vaultEnum(claim.depositDestination, VAULT_DEPOSIT_DESTINATIONS, 'The deposit destination');
  const transferValidation = vaultEnum(claim.transferValidation, VAULT_TRANSFER_VALIDATION, 'The transfer validation field');
  const withdrawalDestination = vaultEnum(claim.withdrawalDestination, VAULT_WITHDRAWAL_DESTINATIONS, 'The withdrawal destination');
  const verdicts = {
    depositsToVaultSmartWallet: depositDestination === 'vault-smart-wallet',
    interProtocolTransfersValidated: transferValidation === 'applies',
    withdrawalsToUserSmartWallet: withdrawalDestination === 'user-smart-wallet',
  };
  const valid = Object.values(verdicts).every(v => v === true);
  return {
    status: valid ? 'ready' : 'not-ready',
    valid,
    depositDestination,
    transferValidation,
    withdrawalDestination,
    verdicts,
  };
}

export const REGISTRY_INTEGRITY_SOURCES = Object.freeze(['canonical', 'project-run', 'unverified-copy', 'none']);
export const REGISTRY_INTEGRITY_ANCHORS = Object.freeze(['bootstrap-hash', 'registry-address', 'unpinned', 'not-applicable']);
export const REGISTRY_INTEGRITY_MONITORING = Object.freeze(['ongoing', 'setup-only', 'none']);
export const REGISTRY_INTEGRITY_VERDICTS = Object.freeze([
  ['usesCanonicalRegistry', 'Verification uses the canonical registry'],
  ['monitorsForSpoofing', 'Monitoring for spoofing attempts'],
]);

function registryIntegrityEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// CIP-113 registry integrity, checked locally against the diligence
// profile a reviewer enters for one integrator (spec: "Implementing
// programmable tokens in DeFi protocols", "Security Considerations",
// item 2, re-read 2026-10-11): "Registry Integrity: Verify using the
// canonical registry; monitor for spoofing attempts."
//
// The Security Considerations list states both practices directly to
// integrators, as imperatives in a considerations list — it attaches
// no MUST keyword to them, and this checker invents none: READY here
// means both stated practices are in place in the entered profile,
// nothing more. The two practices are independent: verifying against
// the canonical registry today says nothing about whether anyone is
// watching for a spoof tomorrow, and monitoring catches attempts only
// against a registry the integrator actually verifies with.
// PRISM judged neither for an integrator as a whole: its registry
// families judge proofs, nodes, and inserts inside transactions
// against lists a reviewer enters, and its registry reader is an
// honest unavailable stub — but which registry an integrator verifies
// against (the canonical deployment, a project-run instance, an
// unverified copy, or none at all) and whether it monitors for
// spoofing were judged nowhere, so an integrator verifying against a
// project-run copy and never watching for spoofs passed every panel
// it touched. This checker judges exactly that, on the entered
// profile:
//   1. usesCanonicalRegistry — verification uses the canonical
//      registry (a project-run instance fails too — it may be a
//      faithful copy, but it is not the canonical registry the
//      section names; an unverified copy and no registry fail too).
//   2. monitorsForSpoofing — monitoring for spoofing attempts is
//      ongoing (a one-time check at setup fails too — monitoring is
//      an ongoing practice, and a setup snapshot cannot catch a
//      spoof that appears later).
// How the integrator identifies the canonical registry — its
// canonical anchor — is REPORTED, never scored, because this item
// does not prescribe the method: the spec's CIP-113 Version section
// identifies a version by the hash of its bootstrap transaction,
// which locks in all contract hashes for that deployment, so a
// bootstrap-hash anchor is reported as pinned; a registry-address
// anchor or an unpinned identification is reported as entered, and
// a profile is ready on the two practices without one — and no
// anchor, however strong, can rescue a failed practice (pinned
// both ways in the tests).
// A claim that cannot be read is refused, never scored in part: an
// unknown or missing field, an unknown value, and the conditional
// pair — an anchor named where no registry is verified against (it
// names nothing the profile uses), and an anchor declared
// not-applicable while a registry IS verified against (the profile
// uses a registry it declines to identify).
// Local model only: PRISM inspected no integrator and read no chain
// state — the profile is the reviewer's own reading of the
// integrator, entered here, and this checker judges its completeness
// and consistency against the spec's registry-integrity practices.
export function checkRegistryIntegrity(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The registry-integrity profile must be an object naming which registry verification uses, how the canonical registry is identified, and whether monitoring for spoofing attempts is ongoing.');
  const inputFields = ['verificationRegistry', 'canonicalAnchor', 'spoofMonitoring'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The registry-integrity profile carries an unknown field ${JSON.stringify(k)} — it names only the registry verification uses, the canonical anchor, and the spoofing monitoring.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The registry-integrity profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const verificationRegistry = registryIntegrityEnum(claim.verificationRegistry, REGISTRY_INTEGRITY_SOURCES, 'The verification registry');
  const canonicalAnchor = registryIntegrityEnum(claim.canonicalAnchor, REGISTRY_INTEGRITY_ANCHORS, 'The canonical anchor');
  const spoofMonitoring = registryIntegrityEnum(claim.spoofMonitoring, REGISTRY_INTEGRITY_MONITORING, 'The spoofing monitoring field');
  if (verificationRegistry === 'none' && canonicalAnchor !== 'not-applicable') throw new Error('The profile names a canonical anchor where no registry is verified against — an anchor identifies a registry in use, and this profile uses none.');
  if (verificationRegistry !== 'none' && canonicalAnchor === 'not-applicable') throw new Error('The profile names its canonical anchor not-applicable while a registry is verified against — a registry in use is identified somehow, and the profile must say how.');
  const verdicts = {
    usesCanonicalRegistry: verificationRegistry === 'canonical',
    monitorsForSpoofing: spoofMonitoring === 'ongoing',
  };
  const valid = Object.values(verdicts).every(v => v === true);
  return {
    status: valid ? 'ready' : 'not-ready',
    valid,
    verificationRegistry,
    canonicalAnchor,
    canonicalAnchored: canonicalAnchor === 'bootstrap-hash',
    spoofMonitoring,
    verdicts,
  };
}

export const USER_STATE_MODES = Object.freeze(['none', 'spending-user', 'transfer-users']);
export const USER_STATE_INCLUSION = Object.freeze(['included', 'omitted', 'not-applicable']);
export const USER_STATE_QUERIES = Object.freeze(['nft', 'other', 'not-applicable']);
export const USER_STATE_VERDICTS = Object.freeze([
  ['senderStateIncluded', 'Sender user-state reference input'],
  ['receiverStateIncluded', 'Receiver user-state reference input'],
]);

function userStateEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// CIP-113 user-state reference inputs, checked locally against the
// transfer profile a reviewer enters for one substandard (spec:
// "Reference Inputs", item 4, and "Existing substandards", both
// re-read 2026-10-11): "Depending on the substandard implementation,
// one or more reference inputs representing user state MAY be
// required. The exact requirements depend on the substandard", and
// each substandard manages user state differently — no state at all,
// one state per user involved in the spending (queried by NFT, as
// when a sender must provide a reference input carrying their
// allowlist NFT), or one state per user involved in the transfer
// itself, inputs and outputs (both sender and receiver providing
// reference inputs proving KYC status).
//
// The requirement is CONDITIONAL ON THE SUBSTANDARD: the section
// imposes no user-state duty of its own — it makes the duty a
// property of the substandard's stated mode, which the reviewer
// enters here and this checker does not judge. READY means the
// entered transfer includes exactly the user-state reference inputs
// its entered mode requires, nothing more. PRISM judged this
// nowhere: its learn path teaches the three modes, its KYC and
// allowlist simulators model eligibility outcomes, and its
// transaction families judge the protocol-parameters, registry, and
// global-state reference inputs — but whether a transfer carries the
// user-state reference inputs its own substandard's mode requires
// was judged in no panel, so a transfer under a both-parties KYC
// substandard that omitted the receiver's state input passed every
// panel it touched. This checker judges exactly that, on the entered
// profile:
//   1. senderStateIncluded — scored in both state modes: the sender
//      is a user involved in the spending in each. Null — NO
//      VERDICT — under a stateless substandard, where no user state
//      exists to include.
//   2. receiverStateIncluded — scored only in the transfer-users
//      mode, where the receiver is also a user involved in the
//      transfer; null in the spending-user mode (the receiver is not
//      involved in the spending) and under no state.
// A stateless profile is ready vacuously: every position carries no
// verdict and nothing is required — readiness there names the
// absence of a requirement, not a passed check.
// How the state is queried is REPORTED, never scored: the spec
// presents NFT querying as the modes' stated method, in examples,
// while the requirement the section attaches is that the state
// reference inputs be provided — so a profile is ready with another
// query method, and an NFT query cannot rescue an omitted state
// input (pinned both ways in the tests).
// A claim that cannot be read is refused, never scored in part: an
// unknown or missing field, an unknown value, and the conditional
// refusals — state inputs or a query method named where the mode
// manages no state, a sender input declared not-applicable in a
// state mode (the sender is involved in both), a receiver input
// declared not-applicable where the mode involves the receiver or
// named where it does not, and a query method declared
// not-applicable while a mode manages state.
// Local model only: PRISM inspected no transfer and read no
// substandard or chain state — the profile is the reviewer's own
// reading of the substandard and the transfer, entered here, and
// this checker judges its completeness and consistency against the
// spec's user-state modes.
export function checkUserStateReferences(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The user-state profile must be an object naming the substandard state mode, whether the sender and receiver state reference inputs are included, and how the state is queried.');
  const inputFields = ['stateMode', 'senderState', 'receiverState', 'stateQuery'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The user-state profile carries an unknown field ${JSON.stringify(k)} — it names only the state mode, the sender and receiver state inputs, and the state query method.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The user-state profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const stateMode = userStateEnum(claim.stateMode, USER_STATE_MODES, 'The state mode');
  const senderState = userStateEnum(claim.senderState, USER_STATE_INCLUSION, 'The sender state field');
  const receiverState = userStateEnum(claim.receiverState, USER_STATE_INCLUSION, 'The receiver state field');
  const stateQuery = userStateEnum(claim.stateQuery, USER_STATE_QUERIES, 'The state query field');
  if (stateMode === 'none' && (senderState !== 'not-applicable' || receiverState !== 'not-applicable' || stateQuery !== 'not-applicable')) throw new Error('The profile names user state where the substandard manages no state — a stateless substandard has no state inputs to include and no state to query.');
  if (stateMode !== 'none' && senderState === 'not-applicable') throw new Error('The profile names the sender state input not-applicable in a state mode — the sender is a user involved in the spending in both state modes, so the sender input always applies.');
  if (stateMode === 'transfer-users' && receiverState === 'not-applicable') throw new Error('The profile names the receiver state input not-applicable where the mode involves the receiver — a transfer-users substandard manages state for the receiver too, so the receiver input applies.');
  if (stateMode === 'spending-user' && receiverState !== 'not-applicable') throw new Error('The profile names a receiver state input where the mode involves only the spending user — the receiver is not a user involved in the spending, so no receiver input applies.');
  if (stateMode !== 'none' && stateQuery === 'not-applicable') throw new Error('The profile names the state query method not-applicable while the substandard manages state — state that is managed is queried somehow, and the profile must say how.');
  const verdicts = {
    senderStateIncluded: stateMode === 'none' ? null : senderState === 'included',
    receiverStateIncluded: stateMode === 'transfer-users' ? receiverState === 'included' : null,
  };
  const valid = Object.values(verdicts).every(v => v !== false);
  return {
    status: valid ? 'ready' : 'not-ready',
    valid,
    stateMode,
    senderState,
    receiverState,
    stateQuery,
    stateQueriedByNft: stateQuery === 'nft',
    verdicts,
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
  const designStatedSubstandard=rawDesign.substandard!==undefined;
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
  // status PRISM cannot back. The implementation section is a second copy of
  // facts the design itself determines — which substandard it models, whether
  // its eligibility toggle plans a Midnight attestation, and the developer
  // handoff steps every PRISM export requires — so, like the token summary,
  // it is cross-checked against the design when present: a file edited to
  // name a different module than the design models, to misstate its
  // eligibility plan, or to drop the independent security review from its
  // required steps is rejected instead of silently imported.
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
    // Legacy exception: a design section that never stated a substandard
    // imports as generic by the migration rule above, so its implementation
    // copy — written against a design that had no module to name — is not
    // cross-checked. A design that DOES state its module is held to it.
    if(impl.substandard!==undefined&&designStatedSubstandard) {
      if(!impl.substandard||typeof impl.substandard!=='object'||Array.isArray(impl.substandard)) throw new Error('This manifest has a malformed implementation substandard section.');
      const sub=substandardById(rawDesign.substandard);
      const expectedSub={id:sub.id,name:sub.name,reference:sub.source,modeledLocally:true};
      for(const k of Object.keys(expectedSub)) if(impl.substandard[k]!==expectedSub[k]) throw new Error(`Manifest implementation substandard does not match its design (${k}). The file may have been edited after export — re-export it from PRISM.`);
    }
    if(impl.midnight&&typeof impl.midnight==='object'&&!Array.isArray(impl.midnight)&&impl.midnight.mode!==undefined) {
      const expectedMode=rawDesign.identity?'planned-eligibility-attestation':'none';
      if(impl.midnight.mode!==expectedMode) throw new Error(`Manifest implementation Midnight mode does not match its design (mode). The file may have been edited after export — re-export it from PRISM.`);
    }
    if(impl.required!==undefined) {
      const expectedRequired=['Reviewed issuance and transfer validators','Registered token policy and protocol deployment','Validated state and transaction builders','Independent security review'];
      if(!Array.isArray(impl.required)||impl.required.length!==expectedRequired.length||impl.required.some((v,i)=>v!==expectedRequired[i])) throw new Error('Manifest implementation required steps do not match the steps every PRISM export requires. The file may have been edited after export — re-export it from PRISM.');
    }
  }
  // Whitelist fields; imported objects never become app configuration or API endpoints.
  const design={};
  for(const k of Object.keys(fromTemplate())) design[k]=rawDesign[k];
  return {design,network:m.network};
}

// Verify a design manifest file someone was handed, WITHOUT importing it —
// the checking counterpart to the import above, as parseRegistryDatumPreview
// is to the registry preview export. Until now the only way to check a
// manifest in PRISM was to import it, and importing replaces the design on
// screen and the draft saved on this device: checking a file a collaborator
// sent cost you your own work in progress unless you exported it first.
// Verification runs exactly the import's checks — it calls parseManifest
// itself, so verify and import can never disagree about whether a file is
// genuine (validate-once) — and reports only a summary of the design the
// file describes. The design itself is deliberately NOT returned: there is
// nothing here for a caller to apply, so verifying can never become a
// quiet import. The file's own createdAt is carried only when it is a
// string, and is reported as the file's statement, never as a verified
// time; an implementation section counts as checked only when it was
// present to cross-check.
function designSummary(design) {
  const sub=substandardById(design.substandard);
  return {
    tokenName:design.tokenName,ticker:design.ticker,decimals:design.decimals,
    supply:design.supply,supplyBaseUnits:toUnits(design.supply,design.decimals).toString(),
    limitEnabled:design.limitEnabled,
    limit:design.limitEnabled?design.limit:null,
    limitBaseUnits:design.limitEnabled?toUnits(design.limit,design.decimals).toString():null,
    template:design.template,
    allowlist:design.allowlist,pausable:design.pausable,identity:design.identity,
    startsPaused:design.paused,
    substandardId:sub.id,substandardName:sub.name,
  };
}

export function verifyManifest(raw) {
  const {design,network}=parseManifest(raw);
  const m=JSON.parse(raw);
  return {network,summary:{
    ...designSummary(design),
    createdAt:typeof m.createdAt==='string'?m.createdAt:null,
    implementationChecked:m.implementation!==undefined,
  }};
}

// The fields a design comparison judges, in the order differences are
// reported. The substandard is ONE field (its id — the name is derived
// from the catalog, so counting it separately would double-count a
// single change), and the file's createdAt / implementation presence
// are NOT fields here: they are statements about the file, not about
// the design, so two exports of the same design at different times
// compare as identical.
export const DESIGN_COMPARE_FIELDS = Object.freeze([
  ['network','Network'],
  ['tokenName','Asset name'],
  ['ticker','Ticker'],
  ['decimals','Decimals'],
  ['supply','Designed supply'],
  ['supplyBaseUnits','Supply in base units'],
  ['limitEnabled','Transfer limit on'],
  ['limit','Per-transfer limit'],
  ['limitBaseUnits','Limit in base units'],
  ['template','Template'],
  ['allowlist','Allowlist'],
  ['pausable','Issuer controls'],
  ['identity','Private eligibility'],
  ['startsPaused','Starts paused'],
  ['substandard','CIP-113 substandard'],
]);

// Compare a handed design file against the design currently open,
// WITHOUT importing it — the comparison counterpart to verifyManifest.
// Verifying a file (v1.76) says what design it describes; this says how
// that design differs from yours, field by field, which is the question
// a collaborator's file actually raises: did they change only the supply,
// or the rules too? The file runs exactly the import's checks first —
// this calls verifyManifest itself, so a file that would fail import
// fails comparison with the same reason, refused whole and never
// partially compared (validate-once). Both sides are then reduced
// through the SAME designSummary builder the verifier uses, so the
// comparison can never disagree with verification about what the file
// describes, and amounts compare as exact base-unit strings (BigInt
// arithmetic in the builder — a supply past 2^53 compares bit-for-bit,
// never through a rounded number). The current design must itself be
// valid and the current network known, or there is nothing sound to
// compare against. Like the verifier, the return carries summaries and
// differences only — no design object for a caller to apply — so
// comparing can never become a quiet import either. File metadata is
// reported separately (fileCreatedAt, as the file states it, and
// fileImplementationChecked) and never counts as a difference.
export function diffDesignFile(raw, currentDesign, currentNetwork) {
  if(!NETWORKS[currentNetwork]) throw new Error('Unknown current network — choose a network before comparing.');
  if(!currentDesign||typeof currentDesign!=='object'||Array.isArray(currentDesign)) throw new Error('There is no current design to compare against.');
  const currentErrors=validateDesign(currentDesign);
  if(currentErrors.length) throw new Error(`Your current design cannot be compared yet: ${currentErrors.join(' ')}`);
  const verified=verifyManifest(raw);
  const {createdAt,implementationChecked,...fileSummary}=verified.summary;
  const currentSummary=designSummary(currentDesign);
  const valueOf=(summary,network,key)=>key==='network'?network:key==='substandard'?summary.substandardId:summary[key];
  const differences=[];
  for(const [field,label] of DESIGN_COMPARE_FIELDS) {
    const file=valueOf(fileSummary,verified.network,field);
    const current=valueOf(currentSummary,currentNetwork,field);
    if(file!==current) differences.push({field,label,file,current});
  }
  return {
    network:verified.network,
    currentNetwork,
    same:differences.length===0,
    compared:DESIGN_COMPARE_FIELDS.length,
    differences,
    fileSummary,
    currentSummary,
    fileCreatedAt:createdAt,
    fileImplementationChecked:implementationChecked,
  };
}

export function creditScenario({principal,rate,months,collateral,advance}) {
  const v=[principal,rate,months,collateral,advance].map(Number);
  if(v.some(x=>!Number.isFinite(x))||v[0]<=0||v[0]>1e12||v[1]<0||v[1]>100||v[2]<1||v[2]>360||v[3]<=0||v[3]>1e12||v[4]<1||v[4]>100) throw new Error('Use positive principal and collateral, 0–100% APR, 1–360 months, and a 1–100% advance rate.');
  const [p,r,m,c,a]=v, interest=p*(r/100)*(m/12), ceiling=c*a/100;
  return {interest,total:p+interest,ceiling,ltv:p/c*100,headroom:ceiling-p,withinLimit:p<=ceiling};
}

// Amortized repayment model for the same private-credit scenario the simple-
// interest calculator describes: equal monthly payments, each month's interest
// charged on the remaining balance, the rest reducing principal. This is the
// structure most term loans actually use, so the lab shows both side by side —
// amortizing interest is lower than simple interest on the full principal for
// the same rate and term, because the balance declines. An optional extra
// monthly payment (input.extraMonthly, default 0) models the question every
// borrower asks next — what paying more than the scheduled amount does: the
// same extra is added every month, the loan pays off early, and the result
// reports the payoff month, the months saved, and the interest saved against
// the no-extra schedule for the same terms. The extra is principal from the
// first month it is paid; this model assumes no prepayment penalty, because
// whether a real agreement charges one is a term of that agreement, not of
// the arithmetic. Illustrative math only: no fees, taxes, insurance,
// defaults, or rate changes, and not a loan offer or any product's terms.
// The final payment is adjusted to the exact remaining balance plus its
// interest, so the schedule always ends at precisely zero instead of a
// floating-point residue — with an extra payment, that final (smaller)
// payment simply arrives in an earlier month.
export function amortizationSchedule(input={}) {
  const [p,r,n]=[Number(input.principal),Number(input.rate),Number(input.months)];
  if(!Number.isFinite(p)||p<=0||p>1e12) throw new Error('Use a positive principal up to 1,000,000,000,000.');
  if(!Number.isFinite(r)||r<0||r>100) throw new Error('Use an annual interest rate between 0 and 100%.');
  if(!Number.isInteger(n)||n<1||n>360) throw new Error('Use a whole number of months between 1 and 360.');
  const extra=input.extraMonthly===undefined?0:Number(input.extraMonthly);
  if(!Number.isFinite(extra)||extra<0||extra>1e12) throw new Error('Use an extra monthly payment of 0 or more, up to 1,000,000,000,000.');
  const monthlyRate=r/100/12;
  const levelPayment=monthlyRate===0?p/n:p*monthlyRate/(1-(1+monthlyRate)**-n);
  const run=extraMonthly=>{
    const schedule=[];
    let balance=p,totalInterest=0,totalPaid=0;
    for(let month=1;month<=n;month++) {
      const interest=balance*monthlyRate;
      const scheduled=levelPayment+extraMonthly;
      let principalPart=scheduled-interest;
      let payment=scheduled;
      if(month===n||principalPart>=balance) { principalPart=balance; payment=balance+interest; }
      balance-=principalPart;
      totalInterest+=interest; totalPaid+=payment;
      schedule.push({month,payment,interest,principal:principalPart,balance:Math.max(0,balance)});
      if(balance<=0) break;
    }
    return {schedule,totalInterest,total:totalPaid};
  };
  const baseline=run(0);
  const actual=extra>0?run(extra):baseline;
  return {monthlyPayment:levelPayment,extraMonthly:extra,scheduledPayment:levelPayment+extra,totalInterest:actual.totalInterest,total:actual.total,schedule:actual.schedule,payoffMonths:actual.schedule.length,monthsSaved:n-actual.schedule.length,interestSaved:baseline.totalInterest-actual.totalInterest};
}

// The inverse of the extra-payment model above: instead of asking what a
// chosen extra does, ask what extra a chosen payoff date requires: with
// the same extra paid every month, all of it to principal, what is the
// smallest extra — to the cent — that pays
// the loan off within a target number of months? The answer is found by
// searching over whole cents and evaluating the SAME amortizationSchedule
// function the forward model uses, so the solver can never drift from the
// schedule it solves for: the returned extra, fed back into
// amortizationSchedule, pays off within the target, and one cent less
// does not (unless the extra is zero, when the target is the full term).
// A target equal to the term needs no extra at all. Same assumptions as
// the schedule itself: no prepayment penalty, no fees, taxes, insurance,
// defaults, or rate changes — illustrative math, not a loan offer.
export function extraForTargetPayoff(input={}) {
  const baseline=amortizationSchedule(input); // Validates principal / rate / months.
  const n=Number(input.months);
  const target=input.targetMonths;
  if(!Number.isInteger(target)||target<1||target>n) throw new Error(`Use a target payoff between 1 and the ${n}-month term.`);
  if(target===n) return {targetMonths:target,extraMonthly:0,monthlyPayment:baseline.monthlyPayment,scheduledPayment:baseline.monthlyPayment,payoffMonths:baseline.payoffMonths,monthsSaved:0,totalInterest:baseline.totalInterest,interestSaved:0,total:baseline.total,schedule:baseline.schedule};
  const payoffAt=cents=>amortizationSchedule({...input,extraMonthly:cents/100}).payoffMonths;
  // Find an upper bound in cents that meets the target, doubling from $1.
  let hi=100;
  while(payoffAt(hi)>target) { hi*=2; if(hi>1e14) throw new Error('No extra payment up to the modeled limit reaches that target.'); }
  // Binary search the smallest whole-cent extra that meets the target.
  let lo=0;
  while(lo<hi) { const mid=Math.floor((lo+hi)/2); if(payoffAt(mid)<=target) hi=mid; else lo=mid+1; }
  const solved=amortizationSchedule({...input,extraMonthly:lo/100});
  return {targetMonths:target,extraMonthly:lo/100,monthlyPayment:solved.monthlyPayment,scheduledPayment:solved.scheduledPayment,payoffMonths:solved.payoffMonths,monthsSaved:solved.monthsSaved,totalInterest:solved.totalInterest,interestSaved:solved.interestSaved,total:solved.total,schedule:solved.schedule};
}

// Refinance comparison for the same scenario: after `paymentsMade` scheduled
// payments on the current loan, its remaining balance (read off the SAME
// amortizationSchedule the lab displays, so the comparison can never drift
// from it) is replaced by a new loan at `newRate` over `newMonths`, with
// `closingCosts` paid up front in cash — NOT financed into the new loan, so
// the new principal is exactly the remaining balance. Break-even is found by
// walking the two actual schedules month by month and accumulating the cash
// difference (a month a loan has finished contributes $0 for it, which is
// what makes a longer new term stop "saving" once the old loan would have
// ended); it is the first month from which the cumulative difference covers
// the closing costs AND never falls back below them — a first crossing that
// later evaporates (a longer new term can do exactly that) is not a break-
// even and yields null, as does a final cumulative difference below the costs. Net benefit
// compares total remaining cost — the old schedule's remaining payments vs
// the new schedule's payments plus the closing costs — so a lower monthly
// payment achieved only by stretching the term shows up honestly as a loss
// when it is one. Scheduled payments only: the extra-payment field is not
// part of this model. No prepayment penalty, taxes, insurance, or rate
// changes — illustrative math, not a loan offer or any product's terms.
export function refinanceComparison(input={}) {
  const baseline=amortizationSchedule(input); // Validates principal / rate / months.
  const n=Number(input.months);
  const made=input.paymentsMade;
  if(!Number.isInteger(made)||made<0||made>=n) throw new Error(`Use payments already made between 0 and ${n-1} for a ${n}-month loan — a loan with all ${n} payments made has nothing left to refinance.`);
  const costs=input.closingCosts===undefined?0:Number(input.closingCosts);
  if(!Number.isFinite(costs)||costs<0||costs>1e12) throw new Error('Use closing costs of 0 or more, up to 1,000,000,000,000.');
  const balanceRemaining=made===0?Number(input.principal):baseline.schedule[made-1].balance;
  const remainingSchedule=baseline.schedule.slice(made);
  const remainingInterest=remainingSchedule.reduce((s,row)=>s+row.interest,0);
  const remainingTotal=remainingSchedule.reduce((s,row)=>s+row.payment,0);
  const refinanced=amortizationSchedule({principal:balanceRemaining,rate:input.newRate,months:input.newMonths}); // Validates newRate / newMonths.
  const horizon=Math.max(remainingSchedule.length,refinanced.schedule.length);
  let breakEvenMonths=costs===0?0:null;
  if(costs>0) { let cumulative=0,lastBelow=-1; for(let m=0;m<horizon;m++) { cumulative+=(remainingSchedule[m]?.payment??0)-(refinanced.schedule[m]?.payment??0); if(cumulative<costs) lastBelow=m; } if(lastBelow<horizon-1) breakEvenMonths=lastBelow+2; }
  const totalRefinanceCost=refinanced.total+costs;
  return {
    paymentsMade:made,
    balanceRemaining,
    current:{monthlyPayment:baseline.monthlyPayment,remainingMonths:remainingSchedule.length,remainingInterest,remainingTotal,schedule:remainingSchedule},
    refinance:{rate:Number(input.newRate),months:Number(input.newMonths),monthlyPayment:refinanced.monthlyPayment,totalInterest:refinanced.totalInterest,total:refinanced.total,schedule:refinanced.schedule},
    closingCosts:costs,
    monthlySavings:baseline.monthlyPayment-refinanced.monthlyPayment,
    interestSaved:remainingInterest-refinanced.totalInterest,
    netBenefit:remainingTotal-totalRefinanceCost,
    breakEvenMonths,
  };
}

// Collateral stress test for the same private-credit scenario: the simple-
// interest panel above says whether the loan sits within its advance ceiling
// at TODAY's collateral value; this asks what a fall in that value does. A
// drop of d% scales the collateral value, so the loan-to-value rises and the
// advance ceiling (stressed value × advance rate) falls — the two break
// points are computed exactly, not sampled: the ceiling is breached at the
// drop where the stressed ceiling equals the principal, i.e. where the
// stressed value reaches the required collateral (principal ÷ advance
// rate), and the collateral reaches par (value == principal, LTV 100%) at
// the drop where the stressed value equals the principal. A scenario that
// starts above its ceiling is reported as already breached with a maximum
// drop of 0 — distinct from a scenario sitting exactly ON its ceiling,
// which is within the limit at a 0% drop but breached by any fall. For any
// chosen drop the result gives the stressed value, LTV, ceiling, and
// headroom, the shortfall above the ceiling, and the top-up — the extra
// collateral, valued at the stressed price, that would bring the required
// collateral back — plus a table over the standard drops. The principal is
// held fixed: this models the collateral side only, not repayments, margin
// calls, or a liquidation process, and no price feed is read — the drop is
// supplied by the reader. Illustrative math, not RealFi terms, a loan
// offer, or a forecast.
export const STRESS_DROPS = Object.freeze([0, 10, 20, 30, 40, 50]);

export function collateralStressTest(input = {}) {
  const base = creditScenario({ principal: input.principal, rate: 0, months: 1, collateral: input.collateral, advance: input.advance }); // Validates principal / collateral / advance.
  const drop = input.dropPercent === undefined ? 25 : Number(input.dropPercent);
  if (!Number.isFinite(drop) || drop < 0 || drop >= 100) throw new Error('Use a collateral drop between 0 and 99% — at 100% no collateral value remains to measure against.');
  const [p, c, a] = [Number(input.principal), Number(input.collateral), Number(input.advance)];
  const requiredCollateral = p / (a / 100);
  const atDrop = d => {
    const value = c * (1 - d / 100);
    const ceiling = value * a / 100;
    return { dropPercent: d, collateralValue: value, ltv: p / value * 100, ceiling, headroom: ceiling - p, withinLimit: p <= ceiling, shortfall: Math.max(0, p - ceiling), topUp: Math.max(0, requiredCollateral - value) };
  };
  const alreadyBreached = p > base.ceiling;
  return {
    principal: p,
    collateral: c,
    advance: a,
    baseLtv: base.ltv,
    baseCeiling: base.ceiling,
    requiredCollateral,
    alreadyBreached,
    maxDropPercent: alreadyBreached ? 0 : (1 - requiredCollateral / c) * 100,
    dropToParPercent: p < c ? (1 - p / c) * 100 : p === c ? 0 : null,
    stressed: atDrop(drop),
    rows: STRESS_DROPS.map(atDrop),
  };
}

// Interest-rate stress test for the same private-credit scenario — the
// payment-side counterpart to the collateral stress test above. The panels
// above hold the rate fixed; this one raises it. Every figure is read off
// the SAME amortizationSchedule the lab displays (same principal and term,
// scheduled payments only — the extra-payment field is not part of this
// model), so the stress can never drift from the schedule it stresses.
// The reader supplies a rise in percentage POINTS (8% shocked by 3 points
// is 11%, not 8.24%) and, optionally, a monthly payment budget. For a
// budget, the model solves the highest rate — to a hundredth of a point —
// whose scheduled payment still fits: the search runs over whole
// hundredths evaluating amortizationSchedule itself, the returned rate's
// payment fits the budget, and one hundredth higher does not (unless the
// answer is capped at the 100% modeled limit, which is reported as a
// cap). A budget below even the 0% payment (principal ÷ months — the
// floor under any amortizing loan) fits no non-negative rate and returns
// null, distinct from a budget that fits the current rate with headroom
// to spare. The principal and term are held fixed and the shocked rate
// applies from the first payment: this models a loan taken (or repriced)
// at the higher rate, not a mid-loan reset, a lender's margin call, or
// any forecast that rates will move. Illustrative math, not RealFi terms,
// a loan offer, or a rate forecast.
export const RATE_SHOCKS = Object.freeze([0, 1, 2, 3, 5, 10]);

export function rateStressTest(input = {}) {
  const base0 = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const shock = input.shockPoints === undefined ? 3 : Number(input.shockPoints);
  if (!Number.isFinite(shock) || shock < 0 || shock > 100) throw new Error('Use a rate rise between 0 and 100 percentage points.');
  if (r + shock > 100) throw new Error(`A ${shock}-point rise takes this scenario's rate past the 100% modeled limit — lower the rise or the scenario rate.`);
  const atRate = rate => {
    const a = amortizationSchedule({ principal: p, rate, months: n });
    return { rate, monthlyPayment: a.monthlyPayment, totalInterest: a.totalInterest, total: a.total, paymentIncrease: a.monthlyPayment - base0.monthlyPayment, interestIncrease: a.totalInterest - base0.totalInterest };
  };
  const base = atRate(r);
  const rows = RATE_SHOCKS.filter(s => r + s <= 100).map(s => ({ shockPoints: s, ...atRate(r + s) }));
  let paymentBudget = null, zeroRatePayment = null, maxRateForBudget = null, cappedAtMax = false;
  if (input.paymentBudget !== undefined && input.paymentBudget !== null && input.paymentBudget !== '') {
    paymentBudget = Number(input.paymentBudget);
    if (!Number.isFinite(paymentBudget) || paymentBudget <= 0 || paymentBudget > 1e12) throw new Error('Use a monthly payment budget above 0, up to 1,000,000,000,000.');
    zeroRatePayment = amortizationSchedule({ principal: p, rate: 0, months: n }).monthlyPayment;
    if (paymentBudget >= zeroRatePayment) {
      // Binary search whole hundredths of a point for the largest rate that fits.
      let lo = 0, hi = 10000;
      const fits = h => amortizationSchedule({ principal: p, rate: h / 100, months: n }).monthlyPayment <= paymentBudget;
      if (fits(hi)) { maxRateForBudget = 100; cappedAtMax = true; }
      else { while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; } maxRateForBudget = lo / 100; }
    }
  }
  return {
    principal: p,
    months: n,
    baseRate: r,
    base,
    shockPoints: shock,
    shocked: atRate(r + shock),
    rows,
    paymentBudget,
    zeroRatePayment,
    maxRateForBudget,
    cappedAtMax,
    rateHeadroomPoints: maxRateForBudget === null ? null : maxRateForBudget - r,
    overBudget: paymentBudget !== null && base.monthlyPayment > paymentBudget,
  };
}

// Debt-service coverage for the same private-credit scenario — the
// income side the panels above have not modeled. Coverage is the ratio of
// a reader-supplied monthly income to the scheduled monthly payment read
// off the SAME amortizationSchedule the lab displays (scheduled payments
// only — the extra-payment field is not part of this model), so the ratio
// can never drift from the schedule it divides. The required ratio is
// also supplied by the reader: this model names no lender's or product's
// threshold, it only does the arithmetic for the threshold it is given.
// From those two inputs it derives the income the required ratio needs
// (required × payment), the cushion or shortfall against the actual
// income, and the exact percentage the income could fall before coverage
// reaches the requirement — 0, and reported as already below, when it
// starts below. It also solves the largest principal the income could
// carry at the required ratio on the same rate and term: the search runs
// over whole cents evaluating amortizationSchedule itself, so the
// returned principal's payment fits the allowable payment
// (income ÷ required) and one cent more of principal does not — unless
// the answer is capped at the modeled principal limit, reported as a
// cap. Income is assumed the same every month and is taken on trust:
// nothing about income, expenses, taxes, or other debts is verified or
// read, and real coverage definitions vary (many use annual operating
// income over annual debt service, after expenses this model ignores).
// Illustrative math, not RealFi terms, a loan offer, or an underwriting
// decision.
export const DSCR_REQUIREMENTS = Object.freeze([1, 1.1, 1.25, 1.5, 2]);

export function debtServiceCoverage(input = {}) {
  const base = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const income = input.monthlyIncome === undefined ? 6000 : Number(input.monthlyIncome);
  if (!Number.isFinite(income) || income <= 0 || income > 1e12) throw new Error('Use a monthly income above 0, up to 1,000,000,000,000.');
  const required = input.requiredDscr === undefined ? 1.25 : Number(input.requiredDscr);
  if (!Number.isFinite(required) || required < 0.01 || required > 10) throw new Error('Use a required coverage ratio between 0.01 and 10.');
  const payment = base.monthlyPayment;
  const incomeNeeded = required * payment;
  const meetsRequirement = income >= incomeNeeded;
  const cushion = income - incomeNeeded;
  const maxPayment = income / required;
  // Binary search whole cents of principal for the largest loan whose
  // scheduled payment — from the schedule function itself — fits.
  const fits = cents => amortizationSchedule({ principal: cents / 100, rate: r, months: n }).monthlyPayment <= maxPayment;
  let maxPrincipal, cappedAtMax = false;
  if (fits(1e14)) { maxPrincipal = 1e12; cappedAtMax = true; }
  else { let lo = 0, hi = 1e14; while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; } maxPrincipal = lo / 100; }
  const atRequirement = req => { const needed = req * payment; return { requiredDscr: req, incomeNeeded: needed, cushion: income - needed, meetsRequirement: income >= needed }; };
  return {
    principal: p,
    months: n,
    rate: r,
    monthlyPayment: payment,
    monthlyIncome: income,
    requiredDscr: required,
    dscr: income / payment,
    meetsRequirement,
    incomeNeeded,
    incomeCushion: cushion,
    incomeShortfall: Math.max(0, -cushion),
    incomeDropTolerancePercent: meetsRequirement ? cushion / income * 100 : 0,
    maxPaymentForRequirement: maxPayment,
    maxPrincipalForRequirement: maxPrincipal,
    principalHeadroom: maxPrincipal - p,
    cappedAtMax,
    rows: DSCR_REQUIREMENTS.map(atRequirement),
  };
}

// Balloon-payment loan for the same private-credit scenario — the term
// structure the panels above do not model. The monthly payment is the
// level payment calculated as if the loan amortized over a longer period
// (`amortizationMonths`), read off the SAME amortizationSchedule the lab
// displays, but the loan itself comes due after `balloonMonths`: at that
// month the borrower pays that month's scheduled payment PLUS the entire
// remaining balance (the balloon). Every figure is read off the full
// amortization schedule's own rows, so the model can never drift from
// the schedule it truncates: the balloon is exactly the schedule's
// balance after the due month's payment, the interest counted is the
// schedule's own interest over the months actually run, and paying the
// balloon in full means the total paid equals principal + that interest
// exactly. A due month equal to the amortization period is the plain
// amortizing loan — balloon zero, totals identical to the full schedule.
// The share of the original principal still due at the balloon date is
// reported directly, because that concentration — most of the principal
// riding on one payment — is the structure's defining risk. This model
// assumes the balloon is paid in full when due: refinancing it, selling
// the asset, or defaulting are outcomes a real agreement and a real
// market decide, and none of them is modeled or implied here. Scheduled
// payments only — the extra-payment field is not part of this model.
// Illustrative math, not RealFi terms or a loan offer.
export function balloonLoan(input = {}) {
  const amortMonths = input.amortizationMonths === undefined ? 12 : Number(input.amortizationMonths);
  const full = amortizationSchedule({ principal: input.principal, rate: input.rate, months: amortMonths }); // Validates principal / rate / amortization period.
  const [p, r] = [Number(input.principal), Number(input.rate)];
  const due = input.balloonMonths === undefined ? Math.max(1, Math.floor(amortMonths / 2)) : Number(input.balloonMonths);
  if (!Number.isInteger(due) || due < 1 || due > amortMonths) throw new Error(`Use a balloon due month between 1 and the ${amortMonths}-month amortization period.`);
  const atDue = t => {
    const rows = full.schedule.slice(0, t);
    const balloonAmount = rows[rows.length - 1].balance;
    const totalInterest = rows.reduce((s, row) => s + row.interest, 0);
    return { dueMonths: t, balloonAmount, finalPayment: rows[rows.length - 1].payment + balloonAmount, totalInterest, principalSharePercent: balloonAmount / p * 100 };
  };
  const chosen = atDue(due);
  const chosenRows = full.schedule.slice(0, due);
  const quarterMonths = [...new Set([Math.ceil(amortMonths * 0.25), Math.ceil(amortMonths * 0.5), Math.ceil(amortMonths * 0.75), amortMonths])].sort((a, b) => a - b);
  return {
    principal: p,
    rate: r,
    amortizationMonths: amortMonths,
    balloonMonths: due,
    monthlyPayment: full.monthlyPayment,
    schedule: chosenRows,
    balloonAmount: chosen.balloonAmount,
    finalPayment: chosen.finalPayment,
    principalSharePercent: chosen.principalSharePercent,
    totalInterest: chosen.totalInterest,
    totalPaid: chosenRows.reduce((s, row) => s + row.payment, 0) + chosen.balloonAmount,
    interestNotCharged: full.totalInterest - chosen.totalInterest,
    fullTermInterest: full.totalInterest,
    monthsEarly: amortMonths - due,
    rows: quarterMonths.map(atDue),
  };
}

export const APR_FEE_PERCENTS = Object.freeze([0, 1, 2, 3, 5]);

// Effective rate (APR) for the same private-credit scenario — the number
// the panels above do not quote. They price the loan at its nominal rate
// on the full principal, but a borrower who pays fees up front receives
// less than the principal while every payment is still calculated on all
// of it, so the loan costs more than the nominal rate says. This model
// counts `upfrontFees` paid in cash at the start — NOT financed into the
// loan — and solves for the annual rate at which the net proceeds
// (principal minus fees) would produce exactly the scheduled payment the
// lab displays. The search runs over whole hundredths of a point and
// evaluates the SAME amortizationSchedule function, so the solved rate
// can never drift from the schedule it reprices: at the reported rate the
// net proceeds carry a payment of at least the actual one, and one
// hundredth lower they carry less. With no fees the effective rate is
// the nominal rate exactly. Fees at or above the principal are rejected
// — the borrower would receive nothing. Fees so large relative to the
// loan that even the 100% modeled rate limit on the net proceeds cannot
// produce the payment return a null rate (exceedsLimit), never a guess.
// The total finance charge — everything paid back above the proceeds
// actually received — is exactly the schedule's interest plus the fees.
// This is an illustrative effective rate on monthly compounding that
// matches the schedule; statutory APR calculations (for example US
// Regulation Z) follow their own rules about which fees count and how
// the rate is rounded, and can differ. Not a loan offer or a disclosure.
export function effectiveRate(input = {}) {
  const base = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const fees = input.upfrontFees === undefined ? 500 : Number(input.upfrontFees);
  if (!Number.isFinite(fees) || fees < 0 || fees > 1e12) throw new Error('Use upfront fees of 0 or more, up to 1,000,000,000,000.');
  if (fees >= p) throw new Error('Upfront fees must be less than the principal — at or above it the borrower would receive nothing.');
  const payment = base.monthlyPayment;
  const solve = feeAmount => {
    if (feeAmount === 0) return r;
    const net = p - feeAmount;
    const payAt = hundredths => amortizationSchedule({ principal: net, rate: hundredths / 100, months: n }).monthlyPayment;
    if (payAt(10000) < payment) return null;
    let lo = 0, hi = 10000;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (payAt(mid) >= payment) hi = mid; else lo = mid + 1; }
    return lo / 100;
  };
  const aprPercent = solve(fees);
  return {
    principal: p,
    rate: r,
    months: n,
    upfrontFees: fees,
    netProceeds: p - fees,
    monthlyPayment: payment,
    totalInterest: base.totalInterest,
    totalPaid: base.total,
    financeCharge: base.total - (p - fees),
    aprPercent,
    premiumPoints: aprPercent === null ? null : aprPercent - r,
    exceedsLimit: aprPercent === null,
    rows: APR_FEE_PERCENTS.map(feePercent => { const feeAmount = p * feePercent / 100; return { feePercent, feeAmount, aprPercent: solve(feeAmount) }; }),
  };
}

export const IO_PERIOD_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75]);

// Interest-only period for the same private-credit scenario — the
// structure bridge and construction loans actually use, and the one
// payment shape the panels above cannot show. For the first
// `interestOnlyMonths` months the borrower pays only the month's
// interest on the full principal: the payment is lower, and the balance
// does not move at all. When the interest-only period ends, the SAME
// principal is amortized over the months that remain, so the payment
// steps up to the level payment of a shorter loan — read off the SAME
// amortizationSchedule function, applied to the remaining term, so this
// model can never drift from the schedule it builds on. The combined
// schedule always runs the full scenario term: interest-only rows
// (principal part exactly zero, balance exactly the principal) followed
// by the amortizing rows with their months offset. Because the balance
// stays at the full principal for longer, the total interest is never
// less than the plain amortizing loan's — the difference is reported as
// extraInterest, and it is exactly zero when the rate or the
// interest-only period is zero. An interest-only period of zero IS the
// plain loan: its schedule is the baseline schedule itself. The period
// must leave at least one amortizing month — a loan that never starts
// repaying inside its term is a balloon structure, modeled separately
// above. At a 0% rate the interest-only payment is $0 and the payment
// step-up is reported as an amount with a null percentage — there is
// no smaller payment to measure a percentage increase against. The rate
// is fixed for the whole term; payments missed, fees, taxes, insurance,
// and what happens if the borrower cannot meet the stepped-up payment
// are not modeled. Illustrative math only — not a loan offer or any
// product's terms.
export function interestOnlyLoan(input = {}) {
  const plain = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const io = input.interestOnlyMonths === undefined ? Math.floor(n / 2) : Number(input.interestOnlyMonths);
  if (!Number.isInteger(io) || io < 0 || io >= n) throw new Error(`Use an interest-only period between 0 and ${n - 1} months for a ${n}-month loan — at least one month must be left to repay the principal.`);
  const monthlyRate = r / 100 / 12;
  const atPeriod = t => {
    const ioPay = p * monthlyRate;
    const amort = t === n ? null : amortizationSchedule({ principal: p, rate: r, months: n - t });
    const ioRows = Array.from({ length: t }, (_, i) => ({ month: i + 1, payment: ioPay, interest: ioPay, principal: 0, balance: p }));
    const schedule = t === 0 ? plain.schedule : [...ioRows, ...amort.schedule.map(row => ({ ...row, month: row.month + t }))];
    const totalInterest = schedule.reduce((s, row) => s + row.interest, 0);
    const amortizingPayment = t === 0 ? plain.monthlyPayment : amort.monthlyPayment;
    return {
      interestOnlyMonths: t,
      ioPayment: t === 0 ? amortizingPayment : ioPay,
      amortizingPayment,
      totalInterest,
      extraInterest: totalInterest - plain.totalInterest,
      schedule,
    };
  };
  const chosen = atPeriod(io);
  const periodMonths = [...new Set(IO_PERIOD_FRACTIONS.map(f => Math.floor(n * f)))].filter(t => t < n).sort((a, b) => a - b);
  return {
    principal: p,
    rate: r,
    months: n,
    interestOnlyMonths: io,
    amortizingMonths: n - io,
    ioPayment: chosen.ioPayment,
    amortizingPayment: chosen.amortizingPayment,
    paymentIncrease: chosen.amortizingPayment - chosen.ioPayment,
    paymentIncreasePercent: chosen.ioPayment > 0 ? (chosen.amortizingPayment - chosen.ioPayment) / chosen.ioPayment * 100 : null,
    ioInterest: chosen.schedule.slice(0, io).reduce((s, row) => s + row.interest, 0),
    totalInterest: chosen.totalInterest,
    totalPaid: chosen.schedule.reduce((s, row) => s + row.payment, 0),
    extraInterest: chosen.extraInterest,
    plainMonthlyPayment: plain.monthlyPayment,
    plainTotalInterest: plain.totalInterest,
    schedule: chosen.schedule,
    rows: periodMonths.map(t => { const row = atPeriod(t); return { interestOnlyMonths: row.interestOnlyMonths, ioPayment: row.ioPayment, amortizingPayment: row.amortizingPayment, totalInterest: row.totalInterest, extraInterest: row.extraInterest }; }),
  };
}

export const LUMP_SUM_PERCENTS = Object.freeze([0, 10, 25, 50, 100]);

// Lump-sum payoff for the same private-credit scenario — the one
// payoff shape the panels above cannot show. The extra-payment model
// (v1.22) spreads extra principal evenly over every month; a lump sum
// is the opposite shape: one larger amount, paid once, in a month the
// reader chooses. It is applied immediately AFTER that month's
// scheduled payment, entirely to principal, and the scheduled payment
// itself never changes — this model holds the payment and shortens
// the term (the keep-the-payment choice), it does not recast the loan
// into a lower payment over the original term. The walk replays the
// SAME level payment amortizationSchedule computes, month by month,
// so the months before the lump are that schedule's own rows and the
// continuation is its arithmetic continued on the reduced balance —
// the model can never drift from the schedule it builds on. The lump
// actually applied is capped at the balance remaining after the
// chosen month's payment: asking for more than the loan still owes
// applies only what is owed and ends the loan that month, and a lump
// chosen for the final month applies nothing at all, because the
// final scheduled payment has already ended the loan. A lump of zero
// IS the plain loan: the returned schedule is the baseline schedule
// itself. Total paid counts the lump as cash paid, so it always
// equals the principal plus the interest actually charged. Same
// assumptions as the schedule itself: no prepayment penalty (whether
// a real agreement charges one is a term of that agreement, and a
// penalty would reduce the saving shown), no fees, taxes, insurance,
// defaults, or rate changes. Illustrative math only — not a loan
// offer or any product's terms.
export function lumpSumPayoff(input = {}) {
  const plain = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const lumpMonth = input.lumpMonth === undefined ? Math.max(1, Math.floor(n / 2)) : Number(input.lumpMonth);
  if (!Number.isInteger(lumpMonth) || lumpMonth < 1 || lumpMonth > n) throw new Error(`Use a lump-sum month between 1 and the ${n}-month term.`);
  const lump = input.lumpAmount === undefined ? 10000 : Number(input.lumpAmount);
  if (!Number.isFinite(lump) || lump < 0 || lump > 1e12) throw new Error('Use a lump sum of 0 or more, up to 1,000,000,000,000.');
  const monthlyRate = r / 100 / 12;
  const level = plain.monthlyPayment;
  const atLump = amount => {
    if (amount === 0) return { lumpApplied: 0, balanceAfterLump: plain.schedule[lumpMonth - 1].balance, payoffMonths: plain.payoffMonths, monthsSaved: 0, totalInterest: plain.totalInterest, interestSaved: 0, totalPaid: plain.total, schedule: plain.schedule };
    const schedule = [];
    let balance = p, totalInterest = 0, totalPaid = 0, applied = 0, balanceAfter = null;
    for (let month = 1; month <= n; month++) {
      const interest = balance * monthlyRate;
      let principalPart = level - interest;
      let payment = level;
      if (month === n || principalPart >= balance) { principalPart = balance; payment = balance + interest; }
      balance -= principalPart;
      totalInterest += interest; totalPaid += payment;
      const row = { month, payment, interest, principal: principalPart, balance: Math.max(0, balance) };
      if (month === lumpMonth) { applied = Math.min(amount, balance); balance -= applied; row.lump = applied; row.balance = Math.max(0, balance); balanceAfter = balance; }
      schedule.push(row);
      if (balance <= 0) break;
    }
    return { lumpApplied: applied, balanceAfterLump: balanceAfter, payoffMonths: schedule.length, monthsSaved: n - schedule.length, totalInterest, interestSaved: plain.totalInterest - totalInterest, totalPaid: totalPaid + applied, schedule };
  };
  const chosen = atLump(lump);
  return {
    principal: p,
    rate: r,
    months: n,
    lumpMonth,
    lumpAmount: lump,
    lumpApplied: chosen.lumpApplied,
    balanceAfterLump: chosen.balanceAfterLump,
    monthlyPayment: level,
    payoffMonths: chosen.payoffMonths,
    monthsSaved: chosen.monthsSaved,
    totalInterest: chosen.totalInterest,
    interestSaved: chosen.interestSaved,
    totalPaid: chosen.totalPaid,
    plainTotalInterest: plain.totalInterest,
    schedule: chosen.schedule,
    rows: LUMP_SUM_PERCENTS.map(lumpPercent => { const amount = p * lumpPercent / 100; const row = atLump(amount); return { lumpPercent, lumpAmount: amount, lumpApplied: row.lumpApplied, payoffMonths: row.payoffMonths, monthsSaved: row.monthsSaved, totalInterest: row.totalInterest, interestSaved: row.interestSaved }; }),
  };
}


export const ARM_RATE_DELTAS = Object.freeze([-2, 0, 2, 4]);

// Adjustable-rate reset for the same private-credit scenario — the
// structure the rate stress test (which reprices a loan from its first
// payment, as a hypothetical) cannot show: a loan that actually starts
// at one rate and resets to another part-way through its term. The
// initial rate charges the first resetMonth − 1 payments; starting
// with payment resetMonth the new rate applies, and the payment is
// RECAST — recomputed as the level payment that repays the balance
// standing at the reset over the months remaining, read off the SAME
// amortizationSchedule function applied to that balance and remaining
// term, so this model can never drift from the schedule it builds on.
// The months before the reset are that schedule's own rows. Two
// boundary cases are exact, not approximate: a new rate equal to the
// initial rate IS the plain loan (its schedule is returned itself),
// and a reset in month 1 IS a plain loan at the new rate. A reset in
// the final month reprices only that payment (balance plus one month
// of interest at the new rate). The term never changes — only the rate
// and, from the reset, the payment do — and the result reports the
// payment change and the total interest difference against the plain
// loan at the initial rate, signed either way: a reset down saves, a
// reset up costs. This model holds each rate exactly as entered for
// its whole phase: how a real adjustable rate is set at a reset (an
// index plus a margin, caps on each move, a floor) is a term of a real
// agreement, and none of it — nor fees, taxes, insurance, or defaults
// — is modeled. Illustrative math only — not a loan offer, any
// product's terms, or a forecast that rates will move.
export function adjustableRateLoan(input = {}) {
  const plain = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const resetMonth = input.resetMonth === undefined ? Math.max(1, Math.floor(n / 2)) : Number(input.resetMonth);
  if (!Number.isInteger(resetMonth) || resetMonth < 1 || resetMonth > n) throw new Error(`Use a reset month between 1 and the ${n}-month term.`);
  const newRate = input.newRate === undefined ? Math.min(100, r + 2) : Number(input.newRate);
  if (!Number.isFinite(newRate) || newRate < 0 || newRate > 100) throw new Error('Use a new annual interest rate between 0 and 100%.');
  const atReset = (rm, nr) => {
    const balanceAt = rm === 1 ? p : plain.schedule[rm - 2].balance;
    if (nr === r) return { resetPayment: plain.monthlyPayment, balanceAtReset: balanceAt, totalInterest: plain.totalInterest, totalPaid: plain.total, schedule: plain.schedule };
    if (rm === 1) { const s = amortizationSchedule({ principal: p, rate: nr, months: n }); return { resetPayment: s.monthlyPayment, balanceAtReset: p, totalInterest: s.totalInterest, totalPaid: s.total, schedule: s.schedule }; }
    const rest = amortizationSchedule({ principal: balanceAt, rate: nr, months: n - rm + 1 });
    const firstRate = r / 100 / 12, secondRate = nr / 100 / 12;
    const schedule = [];
    let balance = p, totalInterest = 0, totalPaid = 0;
    for (let month = 1; month <= n; month++) {
      const resetting = month >= rm;
      const interest = balance * (resetting ? secondRate : firstRate);
      const level = resetting ? rest.monthlyPayment : plain.monthlyPayment;
      let principalPart = level - interest;
      let payment = level;
      if (month === n || principalPart >= balance) { principalPart = balance; payment = balance + interest; }
      balance -= principalPart;
      totalInterest += interest; totalPaid += payment;
      schedule.push({ month, payment, interest, principal: principalPart, balance: Math.max(0, balance) });
      if (balance <= 0) break;
    }
    return { resetPayment: rest.monthlyPayment, balanceAtReset: balanceAt, totalInterest, totalPaid, schedule };
  };
  const chosen = atReset(resetMonth, newRate);
  const rowRates = [...new Set(ARM_RATE_DELTAS.map(d => Math.min(100, Math.max(0, r + d))))].sort((a, b) => a - b);
  return {
    principal: p,
    initialRate: r,
    newRate,
    months: n,
    resetMonth,
    initialPayment: plain.monthlyPayment,
    resetPayment: chosen.resetPayment,
    paymentChange: chosen.resetPayment - plain.monthlyPayment,
    paymentChangePercent: plain.monthlyPayment > 0 ? (chosen.resetPayment - plain.monthlyPayment) / plain.monthlyPayment * 100 : null,
    balanceAtReset: chosen.balanceAtReset,
    totalInterest: chosen.totalInterest,
    interestDifference: chosen.totalInterest - plain.totalInterest,
    totalPaid: chosen.totalPaid,
    plainMonthlyPayment: plain.monthlyPayment,
    plainTotalInterest: plain.totalInterest,
    schedule: chosen.schedule,
    rows: rowRates.map(rate => { const row = atReset(resetMonth, rate); return { newRate: rate, rateDelta: rate - r, resetPayment: row.resetPayment, totalInterest: row.totalInterest, interestDifference: row.totalInterest - plain.totalInterest }; }),
  };
}

export const PAYMENT_FREQUENCIES = Object.freeze([
  { id: 'monthly', label: 'Monthly', periodsPerYear: 12 },
  { id: 'biweekly', label: 'Biweekly', periodsPerYear: 26 },
  { id: 'weekly', label: 'Weekly', periodsPerYear: 52 },
]);

// Payment frequency for the same private-credit scenario — the
// accelerated biweekly/weekly plans lenders market, modeled honestly.
// An accelerated biweekly payment is HALF the monthly payment made
// every two weeks: 26 of them a year add up to thirteen monthly
// payments, one more than a monthly borrower pays in a year (the
// weekly plan is a quarter of the monthly payment, 52 times a year —
// the same thirteen). That extra payment a year, applied to principal
// as the balance falls, is where nearly all of the saving comes from
// — not the frequency itself. Merely splitting the same annual amount
// into smaller pieces (twelve monthly payments' worth spread over 26
// or 52 dates) would save only a little interest from paying earlier,
// and this panel does not present that smaller effect as the plan's
// benefit: each row reports what it actually pays per year, so the
// extra outlay is on the table next to the saving. Each frequency is
// walked period by period at its own period rate (the annual rate
// divided by the periods per year) with the final payment adjusted to
// the exact remaining balance plus its interest, so every schedule
// ends at precisely zero and total paid always equals principal plus
// the interest actually charged. The monthly row is walked by the
// same code and reproduces the plain amortizationSchedule totals
// exactly — it IS the baseline, not a copy of it. Payoff timing is
// reported in periods and in equivalent calendar months (periods ÷
// periods per year × 12), so a 24-period biweekly payoff reads as
// about 11.1 months. A 0% loan saves no interest at any frequency —
// it only finishes sooner. Same assumptions as the schedule itself:
// no prepayment penalty, no fees, taxes, insurance, defaults, or
// rate changes, and a real agreement may not offer these plans at
// all, or may charge for them. Illustrative math only — not a loan
// offer or any product's terms.
export function paymentFrequency(input = {}) {
  const plain = amortizationSchedule(input); // Validates principal / rate / months.
  const [p, r, n] = [Number(input.principal), Number(input.rate), Number(input.months)];
  const run = periodsPerYear => {
    const periodRate = r / 100 / periodsPerYear;
    const payment = periodsPerYear === 12 ? plain.monthlyPayment : plain.monthlyPayment * 13 / periodsPerYear;
    const maxPeriods = Math.ceil(n / 12) * periodsPerYear + periodsPerYear;
    const schedule = [];
    let balance = p, totalInterest = 0, totalPaid = 0;
    for (let period = 1; period <= maxPeriods; period++) {
      const interest = balance * periodRate;
      let principalPart = payment - interest;
      let paid = payment;
      if (period === maxPeriods || principalPart >= balance) { principalPart = balance; paid = balance + interest; }
      balance -= principalPart;
      totalInterest += interest; totalPaid += paid;
      schedule.push({ period, payment: paid, interest, principal: principalPart, balance: Math.max(0, balance) });
      if (balance <= 0) break;
    }
    const periods = schedule.length;
    const calendarMonths = periods / periodsPerYear * 12;
    return { periodsPerYear, payment, periods, calendarMonths, monthsSaved: n - calendarMonths, totalInterest, interestSaved: plain.totalInterest - totalInterest, totalPaid, annualOutlay: payment * periodsPerYear, schedule };
  };
  const rows = PAYMENT_FREQUENCIES.map(f => { const row = run(f.periodsPerYear); return { id: f.id, label: f.label, periodsPerYear: f.periodsPerYear, payment: row.payment, periods: row.periods, calendarMonths: row.calendarMonths, monthsSaved: row.monthsSaved, totalInterest: row.totalInterest, interestSaved: row.interestSaved, annualOutlay: row.annualOutlay }; });
  const biweekly = run(26);
  return {
    principal: p,
    rate: r,
    months: n,
    monthlyPayment: plain.monthlyPayment,
    plainTotalInterest: plain.totalInterest,
    plainTotalPaid: plain.total,
    biweeklyPayment: biweekly.payment,
    biweeklyPeriods: biweekly.periods,
    biweeklyCalendarMonths: biweekly.calendarMonths,
    monthsSaved: biweekly.monthsSaved,
    totalInterest: biweekly.totalInterest,
    interestSaved: biweekly.interestSaved,
    totalPaid: biweekly.totalPaid,
    schedule: biweekly.schedule,
    rows,
  };
}

export function checkEligibility({score,minimum,age,adult,region,approved}) {
  if(![score,minimum,age].every(Number.isFinite)||score<0||score>100||minimum<0||minimum>100||age<0||age>120) throw new Error('Use scores between 0 and 100 and an age between 0 and 120.');
  const checks=[{name:'Score threshold',pass:score>=minimum},{name:'Age threshold',pass:!adult||age>=18},{name:'Region requirement',pass:!region||approved}];
  return {eligible:checks.every(x=>x.pass),checks};
}

// A fictional cohort for the Midnight page's public-output preview. Each
// member is constructed to isolate exactly one policy check under the
// sandbox's default policy (minimum 65, adult required, region required):
// Amara passes everything, Ben fails only the score, Chandra only the age,
// Dario only the region, and Elif fails all three — so a policy change's
// effect on the cohort is attributable to a single check. The private values
// (score, age, region status) exist only as local model inputs: the
// evaluation below never copies them into its result, which is the whole
// point of the preview — a public verifier sees decisions and check
// outcomes, never the evidence behind them. Fictional people, fictional
// values; no real person's data belongs in this list.
export const ELIGIBILITY_COHORT = Object.freeze([
  Object.freeze({ id:'amara', name:'Amara — fictional participant', score:92, age:34, regionApproved:true }),
  Object.freeze({ id:'ben', name:'Ben — fictional participant', score:58, age:41, regionApproved:true }),
  Object.freeze({ id:'chandra', name:'Chandra — fictional participant', score:81, age:17, regionApproved:true }),
  Object.freeze({ id:'dario', name:'Dario — fictional participant', score:74, age:29, regionApproved:false }),
  Object.freeze({ id:'elif', name:'Elif — fictional participant', score:47, age:16, regionApproved:false }),
]);

// Evaluate a whole cohort against one public policy and return ONLY the
// public output: per participant, the decision and the pass/fail of each
// named public check — no score, no age, no region value, under any key.
// The policy itself (minimum score, which requirements are on) is public by
// design and is echoed back so the output is self-describing. Malformed
// policies and cohorts throw instead of producing a partial public record.
export function evaluateEligibilityCohort(policy, cohort=ELIGIBILITY_COHORT) {
  if(!policy||typeof policy!=='object') throw new Error('A public policy is required.');
  if(typeof policy.adult!=='boolean'||typeof policy.region!=='boolean') throw new Error('Policy requirements must be on or off.');
  if(!Array.isArray(cohort)||cohort.length===0||cohort.length>50) throw new Error('Use a cohort of 1 to 50 fictional participants.');
  const seen=new Set();
  const results=cohort.map(p=>{
    if(!p||typeof p.id!=='string'||!p.id.trim()||typeof p.name!=='string'||!p.name.trim()) throw new Error('Every cohort participant needs an id and a name.');
    if(seen.has(p.id)) throw new Error(`Duplicate cohort participant id: ${p.id}.`);
    seen.add(p.id);
    if(typeof p.regionApproved!=='boolean') throw new Error(`Cohort participant ${p.id} needs a region status.`);
    const r=checkEligibility({score:p.score,minimum:policy.minimum,age:p.age,adult:policy.adult,region:policy.region,approved:p.regionApproved});
    return {id:p.id,name:p.name,eligible:r.eligible,checks:r.checks};
  });
  return {
    policy:{minimum:policy.minimum,adult:policy.adult,region:policy.region},
    total:results.length,
    eligibleCount:results.filter(r=>r.eligible).length,
    results,
  };
}

export const SERVICE_FEE_BPS_LEVELS = Object.freeze([0, 25, 50, 100, 250, 500]);

// Disclosed service-fee model — the split PRISM's transfer models never
// priced. A designer building a fee-earning application on a programmable
// token (a swap interface, a payment tool, a marketplace) charges a small
// fee that must be disclosed to its users exactly as it is taken. This
// model performs that split in base units with BigInt arithmetic — the
// same exactness the studio's transfer modeling uses — so a fee priced
// here is the fee the design describes, with no float drift at any
// supply scale. The percentage part is FLOOR(gross × bps ÷ 10,000): the
// fee rounds DOWN to the base unit, never up, and the rounding remainder
// stays with the recipient — a fee that rounded up would take more than
// the disclosed rate. A fixed per-transfer fee (in the token's own
// units) is added after the percentage part, and an optional cap bounds
// the total; the cap binding is reported, never hidden. A fee that would
// take the whole transfer is refused outright — the recipient would
// receive nothing, and no honest fee schedule does that. The monthly
// projection multiplies the single-transfer split by a transfer count
// the designer supplies; no volume feed is read and no revenue is
// promised — it is the designer's own entered volume at the modeled
// fee. LOCAL MODEL ONLY: PRISM collects nothing, charges nothing, and
// executes no transfer; the fee modeled belongs to the design being
// priced, and presenting it to that design's users exactly as modeled
// is the designer's responsibility.
export function modelServiceFee(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const gross = toUnits(input.amount === undefined ? '0' : input.amount, decimals); // Validates amount + decimals.
  if (gross <= 0n) throw new Error('Transfer amount must be greater than zero.');
  const bps = input.feeBps === undefined ? 100 : Number(input.feeBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('Fee must be a whole number of basis points between 0 and 10,000.');
  const fixed = toUnits(input.fixedFee === undefined || input.fixedFee === '' ? '0' : input.fixedFee, decimals);
  const hasCap = !(input.maxFee === undefined || input.maxFee === null || input.maxFee === '');
  const cap = hasCap ? toUnits(input.maxFee, decimals) : null;
  const transfers = input.transfersPerMonth === undefined ? 100 : Number(input.transfersPerMonth);
  if (!Number.isInteger(transfers) || transfers < 1 || transfers > 1000000) throw new Error('Monthly transfers must be a whole number between 1 and 1,000,000.');
  const split = atBps => {
    const uncapped = gross * BigInt(atBps) / 10000n + fixed;
    const fee = cap !== null && uncapped > cap ? cap : uncapped;
    return { feeBps: atBps, uncappedFee: uncapped, fee, capApplied: cap !== null && uncapped > cap, net: gross - fee };
  };
  const main = split(bps);
  if (main.fee >= gross) throw new Error('The fee would take the whole transfer — the recipient would receive nothing. Lower the rate, the fixed fee, or the cap, or raise the amount.');
  // Effective rate as exact text: hundredths of a basis point from the
  // BigInt split, so the displayed rate is the split's own rate.
  const hundredths = main.fee * 1000000n / gross;
  const effectiveBpsText = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  const count = BigInt(transfers);
  return {
    decimals,
    gross,
    feeBps: bps,
    bpsFee: gross * BigInt(bps) / 10000n,
    fixedFee: fixed,
    maxFee: cap,
    capApplied: main.capApplied,
    uncappedFee: main.uncappedFee,
    fee: main.fee,
    net: main.net,
    effectiveBpsText,
    transfersPerMonth: transfers,
    monthly: { gross: gross * count, fee: main.fee * count, net: main.net * count },
    rows: SERVICE_FEE_BPS_LEVELS.map(level => { const s = split(level); return { feeBps: level, fee: s.fee, net: s.net, capApplied: s.capApplied, takesAll: s.fee >= gross }; }),
  };
}

// Service-fee break-even — the volume question the fee split alone does
// not answer. Pricing a disclosed fee (modelServiceFee) says what one
// transfer pays; a fee-earning design is only sustainable if those fees
// cover what running it costs. This model divides the designer's own
// entered monthly operating cost by the exact per-transfer fee from the
// split above. The break-even count rounds UP — the one rounding in the
// fee family that favours the fee — because a fractional transfer does
// not exist: at one transfer fewer, the fees collected are still short
// of the cost, and stating the lower count would claim coverage the fees
// do not reach. The fee itself still rounds down inside the split; the
// two roundings answer different questions and neither is hidden. A
// design whose fee per transfer is zero NEVER covers a positive cost —
// that is stated as a result, never a division by zero — and a cost of
// zero is covered before the first transfer. At the designer's entered
// volume the model reports the month's fee income, the signed net
// against the cost, and whether the entered volume covers it. All
// figures are the designer's own entered cost and volume at the modeled
// fee: no cost feed, no volume feed, no revenue promised. LOCAL MODEL
// ONLY, on the same boundary as the split: PRISM collects nothing,
// charges nothing, and executes no transfer.
export function serviceFeeBreakEven(input = {}) {
  const split = modelServiceFee(input); // Validates the fee inputs; its refusals (incl. takes-all) propagate.
  const monthlyCost = toUnits(input.monthlyCost === undefined || input.monthlyCost === '' ? '0' : input.monthlyCost, split.decimals);
  if (monthlyCost < 0n) throw new Error('Monthly cost cannot be negative.');
  const feePerTransfer = split.fee;
  const neverCovers = feePerTransfer === 0n && monthlyCost > 0n;
  const breakEvenTransfers = monthlyCost === 0n ? 0n : neverCovers ? null : (monthlyCost + feePerTransfer - 1n) / feePerTransfer;
  const monthlyFeeIncome = split.monthly.fee;
  const monthlyNet = monthlyFeeIncome - monthlyCost;
  return {
    decimals: split.decimals,
    feePerTransfer,
    capApplied: split.capApplied,
    monthlyCost,
    breakEvenTransfers,
    neverCovers,
    breakEvenGross: breakEvenTransfers === null ? null : breakEvenTransfers * split.gross,
    transfersPerMonth: split.transfersPerMonth,
    monthlyFeeIncome,
    monthlyNet,
    coversAtEnteredVolume: monthlyNet >= 0n,
  };
}

// Required service fee — the pricing question the break-even model
// inverts. serviceFeeBreakEven starts from a fee and asks what volume
// covers the cost; a designer setting a fee schedule starts from the
// other end: a monthly operating cost and an expected transfer volume
// are (roughly) known, and the fee is the unknown. This solver divides
// the cost by the entered volume, rounding the required per-transfer
// fee UP to the base unit — a fractional base unit cannot be charged,
// and rounding the requirement down would name a fee whose collected
// total falls short of the cost by up to a base unit per transfer.
// It then solves for the smallest whole number of basis points whose
// percentage part — computed exactly as modelServiceFee computes it,
// floor(gross × bps ÷ 10,000), plus the entered fixed fee — reaches
// that required fee: at one basis point less the collected fee is
// provably below the requirement, and that is pinned in the tests.
// Two outcomes are stated as results, never modeled around: a cap
// below the required fee makes coverage impossible at ANY rate (the
// cap, not the rate, is the binding problem), and a required fee at
// or above the whole transfer amount is impossible too — no honest
// fee takes the transfer it is charged on. A zero cost requires no
// fee at all. All figures are the designer's own entered cost and
// volume: no feed is read and no revenue is promised. LOCAL MODEL
// ONLY, on the split's boundary: PRISM collects nothing, charges
// nothing, and executes no transfer.
export function requiredServiceFee(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const gross = toUnits(input.amount === undefined ? '0' : input.amount, decimals); // Validates amount + decimals.
  if (gross <= 0n) throw new Error('Transfer amount must be greater than zero.');
  const fixed = toUnits(input.fixedFee === undefined || input.fixedFee === '' ? '0' : input.fixedFee, decimals);
  const hasCap = !(input.maxFee === undefined || input.maxFee === null || input.maxFee === '');
  const cap = hasCap ? toUnits(input.maxFee, decimals) : null;
  const transfers = input.transfersPerMonth === undefined ? 100 : Number(input.transfersPerMonth);
  if (!Number.isInteger(transfers) || transfers < 1 || transfers > 1000000) throw new Error('Monthly transfers must be a whole number between 1 and 1,000,000.');
  const monthlyCost = toUnits(input.monthlyCost === undefined || input.monthlyCost === '' ? '0' : input.monthlyCost, decimals);
  if (monthlyCost < 0n) throw new Error('Monthly cost cannot be negative.');
  const count = BigInt(transfers);
  const requiredFeePerTransfer = monthlyCost === 0n ? 0n : (monthlyCost + count - 1n) / count;
  const feeAtBps = bps => { const uncapped = gross * BigInt(bps) / 10000n + fixed; return cap !== null && uncapped > cap ? cap : uncapped; };
  const base = { decimals, gross, fixedFee: fixed, maxFee: cap, monthlyCost, transfersPerMonth: transfers, requiredFeePerTransfer };
  if (monthlyCost === 0n) { const f0 = feeAtBps(0); return { ...base, requiredBps: 0, impossible: false, impossibleReason: null, feeAtRequiredBps: f0, feeOneBpsLess: null, monthlyFeeIncomeAtRequired: f0 * count, surplusAtRequired: f0 * count, maxMonthlyFeeIncome: null }; }
  if (requiredFeePerTransfer >= gross) return { ...base, requiredBps: null, impossible: true, impossibleReason: 'takes-all', feeAtRequiredBps: null, feeOneBpsLess: null, monthlyFeeIncomeAtRequired: null, surplusAtRequired: null, maxMonthlyFeeIncome: null };
  if (cap !== null && cap < requiredFeePerTransfer) return { ...base, requiredBps: null, impossible: true, impossibleReason: 'cap', feeAtRequiredBps: null, feeOneBpsLess: null, monthlyFeeIncomeAtRequired: null, surplusAtRequired: null, maxMonthlyFeeIncome: cap * count };
  const need = requiredFeePerTransfer > fixed ? requiredFeePerTransfer - fixed : 0n;
  const requiredBps = need === 0n ? 0 : Number((need * 10000n + gross - 1n) / gross);
  const feeAtRequiredBps = feeAtBps(requiredBps);
  const feeOneBpsLess = requiredBps > 0 ? feeAtBps(requiredBps - 1) : null;
  const monthlyFeeIncomeAtRequired = feeAtRequiredBps * count;
  return { ...base, requiredBps, impossible: false, impossibleReason: null, feeAtRequiredBps, feeOneBpsLess, monthlyFeeIncomeAtRequired, surplusAtRequired: monthlyFeeIncomeAtRequired - monthlyCost, maxMonthlyFeeIncome: null };
}

// Volume-tiered service fee — the fee axis the pricing triangle does not
// cover. modelServiceFee prices one transfer at one rate, the break-even
// model asks what volume that rate needs, and requiredServiceFee solves
// the rate a cost and volume require — all three hold the rate FLAT
// across the whole month. Real fee schedules for fee-earning designs
// (swap interfaces, payment tools, marketplaces) commonly change rate
// with volume: the first tierThreshold transfers of the month pay the
// base rate, and every transfer after that pays the tier rate — a
// discount when the tier rate is lower, a premium when it is higher,
// stated either way from the signed difference against the flat month.
// Each tier's per-transfer fee is computed EXACTLY as modelServiceFee
// computes it — floor(gross × bps ÷ 10,000) plus the fixed fee, bounded
// by the cap when one is set — so a tier never invents its own rounding:
// the percentage part rounds down in both tiers and the cap binding is
// reported per tier. A tier rate whose fee would take the whole transfer
// is refused only when that tier actually carries transfers; a tier no
// transfer reaches prices nothing and refuses nothing. The blended
// effective rate is derived from the month's BigInt totals (hundredths
// of a basis point), so it is the schedule's own rate, not an average
// of the two printed rates. All figures are the designer's own entered
// volume and rates: no feed is read and no revenue is promised. LOCAL
// MODEL ONLY, on the split's boundary: PRISM collects nothing, charges
// nothing, and executes no transfer; the tiered schedule modeled
// belongs to the design being priced and must be disclosed to its users
// exactly as modeled — tiers, threshold, and rates together.
export function tieredServiceFee(input = {}) {
  const split = modelServiceFee(input); // Validates amount/decimals/base fee inputs; its takes-all refusal for the base rate propagates.
  const threshold = input.tierThreshold === undefined ? 50 : Number(input.tierThreshold);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000000) throw new Error('Tier threshold must be a whole number between 0 and 1,000,000.');
  const tierBps = input.tierBps === undefined ? 50 : Number(input.tierBps);
  if (!Number.isInteger(tierBps) || tierBps < 0 || tierBps > 10000) throw new Error('Tier fee must be a whole number of basis points between 0 and 10,000.');
  const gross = split.gross, fixed = split.fixedFee, cap = split.maxFee;
  const uncappedTier = gross * BigInt(tierBps) / 10000n + fixed;
  const tierFee = cap !== null && uncappedTier > cap ? cap : uncappedTier;
  const tierCapApplied = cap !== null && uncappedTier > cap;
  const transfers = split.transfersPerMonth;
  const baseCount = Math.min(transfers, threshold);
  const tierCount = transfers - baseCount;
  if (tierCount > 0 && tierFee >= gross) throw new Error('The tier fee would take the whole transfer — the recipient would receive nothing. Lower the tier rate, the fixed fee, or the cap, or raise the amount.');
  const monthlyFlatFee = split.monthly.fee;
  const monthlyTieredFee = split.fee * BigInt(baseCount) + tierFee * BigInt(tierCount);
  const monthlyGross = split.monthly.gross;
  const hundredths = monthlyGross === 0n ? 0n : monthlyTieredFee * 1000000n / monthlyGross;
  const blendedBpsText = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  return {
    decimals: split.decimals,
    gross,
    feeBps: split.feeBps,
    tierBps,
    tierThreshold: threshold,
    transfersPerMonth: transfers,
    baseCount,
    tierCount,
    baseFeePerTransfer: split.fee,
    tierFeePerTransfer: tierFee,
    baseCapApplied: split.capApplied,
    tierCapApplied,
    monthlyFlatFee,
    monthlyTieredFee,
    differenceVsFlat: monthlyFlatFee - monthlyTieredFee,
    monthlyGross,
    monthlyNetTiered: monthlyGross - monthlyTieredFee,
    blendedBpsText,
  };
}

// Multi-asset service fee — the fee axis the single-asset models do not
// cover. modelServiceFee and its break-even, solver, and tiered
// companions all price transfers of ONE token: one amount, one decimal
// scale, one fee taken in that token. A fee-earning design that serves
// several programmable tokens at once — a swap interface quoting many
// pairs, a marketplace settling in more than one asset — runs a fee
// schedule PER ASSET, each fee taken in the asset being transferred.
// This model prices every asset in the entered list EXACTLY as
// modelServiceFee prices it, in that asset's own base units and
// decimals: the percentage part rounds down per asset (the rounding
// remainder stays with that asset's recipient), the fixed fee and cap
// are that asset's own, the cap binding is reported per asset, and a
// fee that would take an asset's whole transfer is refused naming that
// asset — every listed asset carries transfers, so unlike an unreached
// tier the refusal is never conditional. Assets are told apart by
// label: a label is required, it is trimmed, and duplicates are
// refused case-insensitively, because two rows a reader cannot tell
// apart cannot be disclosed honestly. THE DESIGN POINT IS WHAT THE
// MODEL REFUSES TO ADD: there is no combined total. Fees in different
// assets are amounts of different things — adding their base units
// would produce a number with no asset and no meaning, and converting
// them to one asset would need a price for each, which PRISM does not
// read and will not invent. The result therefore carries the per-asset
// splits and per-asset monthly figures only, with crossAssetTotal
// stated null and totalsCombined false. All figures are the
// designer's own entered amounts, rates, and volumes: no feed is read
// and no revenue is promised. LOCAL MODEL ONLY, on the split's
// boundary: PRISM collects nothing, charges nothing, and executes no
// transfer; the schedule modeled belongs to the design being priced
// and must be disclosed to its users exactly as modeled — per asset,
// in that asset, with no combined figure the model never produced.
export function multiAssetServiceFee(input = {}) {
  const list = input.assets;
  if (!Array.isArray(list) || list.length === 0) throw new Error('At least one asset is required to model a multi-asset fee schedule.');
  if (list.length > 8) throw new Error('A multi-asset fee schedule models at most eight assets at a time.');
  const seen = new Set();
  const assets = list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Asset ${index + 1} needs its own fee inputs.`);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new Error(`Asset ${index + 1} needs a label so its fee can be told apart from the others.`);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate asset label: ${label}. Each asset in the schedule needs its own label.`);
    seen.add(key);
    let split;
    try { split = modelServiceFee(entry); } catch (e) { throw new Error(`${label}: ${e.message}`); }
    return {
      label,
      decimals: split.decimals,
      gross: split.gross,
      feeBps: split.feeBps,
      fixedFee: split.fixedFee,
      maxFee: split.maxFee,
      capApplied: split.capApplied,
      fee: split.fee,
      net: split.net,
      effectiveBpsText: split.effectiveBpsText,
      transfersPerMonth: split.transfersPerMonth,
      monthly: split.monthly,
    };
  });
  return {
    assetCount: assets.length,
    assets,
    crossAssetTotal: null,
    totalsCombined: false,
  };
}

export const SERVICE_FEE_SIZE_LADDER = Object.freeze(['1', '10', '100', '1000', '10000', '100000']);

// Service-fee size profile — the fee question every model above does
// not ask. The split, break-even, solver, tiered, and multi-asset
// models all hold the transfer AMOUNT fixed and price that one size;
// a fee schedule, once disclosed, is charged on EVERY size its users
// send, and the same schedule does not cost every size the same: the
// percentage part scales with the transfer, but the fixed part does
// not, so a fixed fee makes a small transfer pay a far higher
// effective rate than a large one — and at a small enough size the
// fixed fee alone can take the transfer whole. This profile re-splits
// ONE entered schedule at a standard ladder of sizes, exactly as
// modelServiceFee splits it — floor(gross × bps ÷ 10,000) plus the
// fixed fee, bounded by the cap when one is set, the cap binding
// reported per rung — so a designer sees the schedule as its smallest
// users will meet it, not only at the size they happened to model.
// A rung whose fee takes that rung's whole transfer is FLAGGED, not
// refused: the ladder explores sizes the designer did not enter, and
// flagging the rung is what names the smallest size the schedule can
// honestly serve. Against the designer's own stated fairness bound
// (maxEffectiveBps) the profile reports the first ladder size whose
// effective rate stays within it, and whether every larger rung
// stays within it too — computed per rung, never assumed from the
// direction of the ladder, because floor rounding can move a rung's
// exact rate back across a tight bound. It also reports the last
// size at which the fixed fee outweighs the percentage part, which
// is the size below which the schedule is really a fixed charge
// wearing a percentage label. The ladder claims are exact ON THE
// LADDER: no rate is interpolated between rungs, and a size between
// rungs pays what the split formula says at that size, which the
// designer can model directly. The fee still rounds down inside
// each split, as everywhere in this family. All figures are the
// designer's own entered schedule and bound: no feed is read and no
// revenue is promised. LOCAL MODEL ONLY, on the split's boundary:
// PRISM collects nothing, charges nothing, and executes no transfer;
// the schedule profiled belongs to the design being priced and must
// be disclosed to its users exactly as modeled — at every size.
export function serviceFeeSizeProfile(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const bps = input.feeBps === undefined ? 100 : Number(input.feeBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('Fee must be a whole number of basis points between 0 and 10,000.');
  const fixed = toUnits(input.fixedFee === undefined || input.fixedFee === '' ? '0' : input.fixedFee, decimals); // Validates fixed fee + decimals.
  const hasCap = !(input.maxFee === undefined || input.maxFee === null || input.maxFee === '');
  const cap = hasCap ? toUnits(input.maxFee, decimals) : null;
  const bound = input.maxEffectiveBps === undefined ? 500 : Number(input.maxEffectiveBps);
  if (!Number.isInteger(bound) || bound < 1 || bound > 10000) throw new Error('Fairness bound must be a whole number of basis points between 1 and 10,000.');
  const rows = SERVICE_FEE_SIZE_LADDER.map(amount => {
    const gross = toUnits(amount, decimals);
    const bpsFee = gross * BigInt(bps) / 10000n;
    const uncappedFee = bpsFee + fixed;
    const fee = cap !== null && uncappedFee > cap ? cap : uncappedFee;
    const capApplied = cap !== null && uncappedFee > cap;
    const takesAll = fee >= gross;
    // Effective rate as exact text: hundredths of a basis point from
    // the BigInt split, the same formula as modelServiceFee — stated
    // even on a takes-all rung, where the rate is at or above 10,000.
    const hundredths = fee * 1000000n / gross;
    const effectiveBpsText = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
    // The fixed fee's share of the rung's total fee, as exact text:
    // hundredths of a basis point of the fee (10,000.00 is the whole
    // fee), from fixed × 1,000,000 ÷ fee. Null when the fee is zero —
    // a share of nothing is not a number, and none is invented.
    const shareHundredths = fee === 0n ? null : fixed * 1000000n / fee;
    const fixedShareBpsText = shareHundredths === null ? null : `${shareHundredths / 100n}.${String(shareHundredths % 100n).padStart(2, '0')}`;
    const withinBound = !takesAll && fee * 10000n <= gross * BigInt(bound);
    return { amount, gross, bpsFee, fixedFee: fixed, uncappedFee, fee, net: gross - fee, capApplied, takesAll, effectiveBpsText, fixedShareBpsText, withinBound };
  });
  const firstWithin = rows.find(row => row.withinBound);
  const firstSizeWithinBound = firstWithin ? firstWithin.amount : null;
  const withinBoundFromThatSizeOn = firstWithin ? rows.slice(rows.indexOf(firstWithin)).every(row => row.withinBound) : false;
  const dominating = rows.filter(row => row.fee > 0n && row.fixedFee > row.bpsFee);
  const fixedDominatesUntil = dominating.length ? dominating[dominating.length - 1].amount : null;
  return {
    decimals,
    feeBps: bps,
    fixedFee: fixed,
    maxFee: cap,
    maxEffectiveBps: bound,
    rows,
    firstSizeWithinBound,
    withinBoundFromThatSizeOn,
    fixedDominatesUntil,
  };
}

// Service-fee revenue split — the fee question every model above does
// not ask. The split, break-even, solver, tiered, multi-asset, and
// size models all price HOW MUCH fee a transfer pays; none of them
// says WHERE a collected fee goes. A fee-earning design does not keep
// its fee in one place by accident: it is divided — an operator's
// share, a treasury's share, a community or rewards share — and a fee
// disclosed to users with its destinations undisclosed is only half
// disclosed. This model divides the exact per-transfer fee from
// modelServiceFee, and the month's total fee, among an entered list
// of recipients by entered shares in basis points. Each recipient's
// amount is FLOOR(total × share ÷ 10,000): a share rounds DOWN, so no
// recipient is ever paid more than their stated share of the fee.
// What the floors leave behind is named in two parts, because they
// are two different things: the UNALLOCATED part, when the entered
// shares sum to less than the whole fee — that part belongs to a
// recipient nobody named, and the model gives it to no one — and the
// ROUNDING REMAINDER, the base-unit dust the floors themselves leave
// (less than one base unit per recipient, plus one for the
// unallocated share). A remainder belongs to NO recipient in this
// model; a real design must say where its remainder goes, and a
// design whose shares sum past the whole fee is refused outright —
// it promises out more than it collects. The month's split is
// computed from the month's total, not by multiplying the
// per-transfer amounts: splitting the aggregate leaves its own,
// smaller dust, and the two splits are stated side by side rather
// than one being silently derived from the other. Recipients are
// told apart by label — required, trimmed, duplicates refused
// case-insensitively — because two rows a reader cannot tell apart
// cannot be disclosed honestly. All figures are the designer's own
// entered fee and shares: no feed is read and no revenue is
// promised. LOCAL MODEL ONLY, on the split's boundary: PRISM
// collects nothing, charges nothing, and executes no transfer; the
// fee divided belongs to the design being priced, and its shares
// must be disclosed to its users exactly as modeled.
export function serviceFeeRevenueSplit(input = {}) {
  const split = modelServiceFee(input); // Validates the fee inputs; its refusals (incl. takes-all) propagate.
  const list = input.shares;
  if (!Array.isArray(list) || list.length === 0) throw new Error('At least one fee recipient is required to model a revenue split.');
  if (list.length > 5) throw new Error('A revenue split models at most five recipients at a time.');
  const seen = new Set();
  const shares = list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Recipient ${index + 1} needs its own label and share.`);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new Error(`Recipient ${index + 1} needs a label so its share can be told apart from the others.`);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate recipient label: ${label}. Each recipient in the split needs its own label.`);
    seen.add(key);
    const shareBps = entry.shareBps === undefined ? NaN : Number(entry.shareBps);
    if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10000) throw new Error(`${label}: share must be a whole number of basis points between 0 and 10,000.`);
    return { label, shareBps };
  });
  const totalShareBps = shares.reduce((sum, entry) => sum + entry.shareBps, 0);
  if (totalShareBps > 10000) throw new Error(`The shares total ${totalShareBps} basis points — more than the whole fee. Lower a share so the split promises out no more than it collects.`);
  const unallocatedBps = 10000 - totalShareBps;
  const divide = total => {
    const amounts = shares.map(entry => total * BigInt(entry.shareBps) / 10000n);
    const allocated = amounts.reduce((sum, amount) => sum + amount, 0n);
    const unallocatedAmount = total * BigInt(unallocatedBps) / 10000n;
    const remainder = total - allocated;
    return { amounts, allocated, unallocatedAmount, roundingRemainder: remainder - unallocatedAmount, remainder };
  };
  const perTransfer = divide(split.fee);
  const monthly = divide(split.monthly.fee);
  return {
    decimals: split.decimals,
    gross: split.gross,
    feeBps: split.feeBps,
    fee: split.fee,
    monthlyFee: split.monthly.fee,
    transfersPerMonth: split.transfersPerMonth,
    recipients: shares.map((entry, index) => ({ label: entry.label, shareBps: entry.shareBps, amount: perTransfer.amounts[index], monthlyAmount: monthly.amounts[index] })),
    totalShareBps,
    unallocatedBps,
    fullyShared: totalShareBps === 10000,
    allocated: perTransfer.allocated,
    remainder: perTransfer.remainder,
    unallocatedAmount: perTransfer.unallocatedAmount,
    roundingRemainder: perTransfer.roundingRemainder,
    monthlyAllocated: monthly.allocated,
    monthlyRemainder: monthly.remainder,
    monthlyUnallocatedAmount: monthly.unallocatedAmount,
    monthlyRoundingRemainder: monthly.roundingRemainder,
  };
}

// Service-fee schedule over time — the fee dimension every model above
// holds still. The split prices a rate, the tiered model changes the
// rate with VOLUME, the revenue split divides what is collected — but
// every one of them holds the schedule fixed in TIME, and real fee
// schedules for fee-earning designs do not stay fixed: a design
// launches at an introductory rate and steps to its standard rate, or
// announces a rate rise (or cut) from a named month. This model prices
// ONE such step: the first initialMonths months of a horizonMonths
// horizon pay the base rate (feeBps, priced exactly as modelServiceFee
// prices it), and every month after pays laterBps, each period's fee
// computed with the same split — floor(gross × bps ÷ 10,000) plus the
// fixed fee, bounded by the cap, cap binding reported per period — so
// a period never invents its own rounding. A later rate whose fee
// would take the whole transfer is refused only when the later period
// actually carries months; a step scheduled beyond the horizon prices
// nothing and refuses nothing (the tiered model's conditional refusal,
// on the time axis). The direction of the step is stated from the
// FEES, not the rates: an increase, a decrease, or no change — a cap
// can hold two different rates to the same fee, and the honest claim
// is about what transfers pay. The blended effective rate is derived
// from the horizon's BigInt totals (hundredths of a basis point), so
// it is the schedule's own rate over the horizon, never an average of
// the two printed rates. Volume is the designer's entered monthly
// transfer count, held constant across the horizon because this model
// prices a schedule, not a growth forecast: no feed is read and no
// revenue is promised. LOCAL MODEL ONLY, on the split's boundary:
// PRISM collects nothing, charges nothing, and executes no transfer;
// the schedule modeled belongs to the design being priced and must be
// disclosed to its users exactly as modeled — both rates, and the
// month the step takes effect.
export function serviceFeeSchedule(input = {}) {
  const split = modelServiceFee(input); // Validates amount/decimals/base fee inputs; its takes-all refusal for the initial rate propagates.
  const laterBps = input.laterBps === undefined ? 200 : Number(input.laterBps);
  if (!Number.isInteger(laterBps) || laterBps < 0 || laterBps > 10000) throw new Error('Later fee must be a whole number of basis points between 0 and 10,000.');
  const horizonMonths = input.horizonMonths === undefined ? 12 : Number(input.horizonMonths);
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 36) throw new Error('Horizon must be a whole number of months between 1 and 36.');
  const initialMonths = input.initialMonths === undefined ? 3 : Number(input.initialMonths);
  if (!Number.isInteger(initialMonths) || initialMonths < 0 || initialMonths > horizonMonths) throw new Error(`Months at the initial rate must be a whole number between 0 and the horizon of ${horizonMonths}.`);
  const gross = split.gross, fixed = split.fixedFee, cap = split.maxFee;
  const uncappedLater = gross * BigInt(laterBps) / 10000n + fixed;
  const laterFee = cap !== null && uncappedLater > cap ? cap : uncappedLater;
  const laterCapApplied = cap !== null && uncappedLater > cap;
  const laterMonths = horizonMonths - initialMonths;
  if (laterMonths > 0 && laterFee >= gross) throw new Error('The later fee would take the whole transfer — the recipient would receive nothing. Lower the later rate, the fixed fee, or the cap, or raise the amount.');
  const transfers = BigInt(split.transfersPerMonth);
  const monthlyInitialFee = split.fee * transfers;
  const monthlyLaterFee = laterFee * transfers;
  const initialTotalFee = monthlyInitialFee * BigInt(initialMonths);
  const laterTotalFee = monthlyLaterFee * BigInt(laterMonths);
  const totalFee = initialTotalFee + laterTotalFee;
  const totalGross = gross * transfers * BigInt(horizonMonths);
  const flatTotalAtInitialFee = split.fee * transfers * BigInt(horizonMonths);
  const hundredths = totalGross === 0n ? 0n : totalFee * 1000000n / totalGross;
  const blendedBpsText = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  const change = laterFee > split.fee ? 'increase' : laterFee < split.fee ? 'decrease' : 'none';
  return {
    decimals: split.decimals,
    gross,
    feeBps: split.feeBps,
    laterBps,
    initialMonths,
    laterMonths,
    horizonMonths,
    transfersPerMonth: split.transfersPerMonth,
    initialFeePerTransfer: split.fee,
    laterFeePerTransfer: laterFee,
    initialCapApplied: split.capApplied,
    laterCapApplied,
    monthlyInitialFee,
    monthlyLaterFee,
    periods: [
      { key: 'initial', months: initialMonths, feePerTransfer: split.fee, monthlyFee: monthlyInitialFee, totalFee: initialTotalFee, capApplied: split.capApplied },
      { key: 'later', months: laterMonths, feePerTransfer: laterFee, monthlyFee: monthlyLaterFee, totalFee: laterTotalFee, capApplied: laterCapApplied },
    ],
    totalFee,
    totalGross,
    totalNet: totalGross - totalFee,
    flatTotalAtInitialFee,
    differenceVsFlatInitial: flatTotalAtInitialFee - totalFee,
    blendedBpsText,
    change,
    firstLaterMonth: laterMonths > 0 ? initialMonths + 1 : null,
  };
}

export const FEE_DISCLOSURE_RATES = Object.freeze(['exact', 'rate-only', 'none']);
export const FEE_DISCLOSURE_RECIPIENTS = Object.freeze(['named', 'unnamed', 'none']);
export const FEE_DISCLOSURE_TIMINGS = Object.freeze(['before-confirm', 'after', 'never']);
export const FEE_DISCLOSURE_ROUNDING = Object.freeze(['stated', 'unstated']);
export const FEE_DISCLOSURE_NET = Object.freeze(['shown', 'not-shown']);
export const FEE_DISCLOSURE_CHANGES = Object.freeze(['fixed', 'changes-with-notice', 'changes-without-notice']);
export const FEE_DISCLOSURE_NOTICES = Object.freeze(['advance', 'at-change', 'none', 'not-applicable']);
export const FEE_DISCLOSURE_VERDICTS = Object.freeze([
  ['rateStated', 'Fee rate, fixed fee, and cap stated exactly'],
  ['recipientsNamed', 'Fee recipients named'],
  ['shownBeforeTransfer', 'Fee shown before the user confirms'],
  ['roundingStated', 'Rounding and the remainder’s owner stated'],
  ['netAmountShown', 'Recipient’s net amount shown before confirming'],
  ['changeTermsStated', 'Fee-change terms stated'],
]);

function feeDisclosureEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')} — ${JSON.stringify(value)} given.`);
  return value;
}

// Service-fee disclosure, checked locally against the disclosure profile
// a reviewer enters for one fee-earning design (a swap interface, payment
// tool, marketplace, or launchpad built on a programmable token).
//
// The v1.127–v1.134 fee family prices a fee exactly — its rate, volume,
// cost, tiers, asset, size, distribution, and schedule over time — but
// pricing a fee and disclosing it are different acts, and PRISM judged
// the second nowhere. The profit mandate this family serves carries its
// own condition: a fee is taken only when it is honestly disclosed and
// plainly labeled. This checker judges a design's user-facing
// disclosure in five positions, plus a sixth that is conditional:
//   1. rateStated — the exact rate is stated: the percentage rate AND
//      the fixed fee AND the cap, when the schedule carries them. A
//      percentage stated alone leaves a fixed fee or a cap to surprise
//      the user at transfer time.
//   2. recipientsNamed — who receives the fee is named, including every
//      recipient of a split. "A fee is charged" with no destination is
//      half a disclosure: the destination is part of the fee.
//   3. shownBeforeTransfer — the fee is shown before the user confirms
//      the transfer. A fee first visible afterwards is a deduction,
//      not a disclosure.
//   4. roundingStated — the rounding is stated: the fee floors, and who
//      keeps the remainder. The models above floor every fee; a design
//      that does not say so lets users assume the remainder is theirs.
//   5. netAmountShown — what the recipient actually receives is shown
//      before confirming, so the fee's size is judged against the net,
//      not the gross.
//   6. changeTermsStated — CONDITIONAL: null, no verdict, when the fee
//      is fixed (there are no change terms to state); scored when the
//      fee can change — its terms are stated only when changes are
//      announced in advance.
// Whether the fee CAN change is REPORTED, never scored: a changeable
// fee is a legitimate design (the schedule model prices announced
// steps), and a fixed fee is not more honest than a changeable one —
// what this checker scores is whether the change terms, where they
// exist, are stated, the same treatment the DEX checker gives a
// batcher: the capability is reported, the condition the claim carries
// is scored when the capability is claimed.
// Refusal discipline as elsewhere: a profile that cannot be read is
// refused, never scored in part — an unknown or missing field, an
// unknown value, a fixed fee naming a change notice (a fixed fee has
// no changes to notice), and a changeable fee naming its notice
// not-applicable (a fee that can change names how, or the profile
// cannot be read).
// Local model only: PRISM inspected no application and read no user
// interface — the profile is the reviewer's own reading of the design's
// disclosure, entered here, and this checker judges its completeness
// and consistency. PRISM collects nothing itself.
export function checkFeeDisclosure(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('The fee disclosure profile must be an object naming how the design states its rate, its recipients, when it shows the fee, whether it states its rounding, whether it shows the net amount, whether the fee can change, and how changes are noticed.');
  const inputFields = ['rateDisclosure', 'recipientDisclosure', 'timing', 'roundingDisclosure', 'netDisclosure', 'feeChanges', 'changeNotice'];
  for (const k of Object.keys(claim)) if (!inputFields.includes(k)) throw new Error(`The fee disclosure profile carries an unknown field ${JSON.stringify(k)} — it names only the rate disclosure, the recipient disclosure, the timing, the rounding disclosure, the net disclosure, whether the fee changes, and the change notice.`);
  for (const k of inputFields) if (claim[k] === undefined) throw new Error(`The fee disclosure profile is missing its ${JSON.stringify(k)} field — a profile that cannot be read in full is refused, never scored in part.`);
  const rateDisclosure = feeDisclosureEnum(claim.rateDisclosure, FEE_DISCLOSURE_RATES, 'The rate disclosure');
  const recipientDisclosure = feeDisclosureEnum(claim.recipientDisclosure, FEE_DISCLOSURE_RECIPIENTS, 'The recipient disclosure');
  const timing = feeDisclosureEnum(claim.timing, FEE_DISCLOSURE_TIMINGS, 'The timing');
  const roundingDisclosure = feeDisclosureEnum(claim.roundingDisclosure, FEE_DISCLOSURE_ROUNDING, 'The rounding disclosure');
  const netDisclosure = feeDisclosureEnum(claim.netDisclosure, FEE_DISCLOSURE_NET, 'The net disclosure');
  const feeChanges = feeDisclosureEnum(claim.feeChanges, FEE_DISCLOSURE_CHANGES, 'The fee changes field');
  const changeNotice = feeDisclosureEnum(claim.changeNotice, FEE_DISCLOSURE_NOTICES, 'The change notice');
  if (feeChanges === 'fixed' && changeNotice !== 'not-applicable') throw new Error('A fixed fee names a change notice — a fee that never changes has no changes to announce, so a profile claiming both cannot be read.');
  if (feeChanges !== 'fixed' && changeNotice === 'not-applicable') throw new Error('A changeable fee names its change notice not-applicable — a fee that can change carries change terms, and a profile that names none cannot be read.');
  const verdicts = {
    rateStated: rateDisclosure === 'exact',
    recipientsNamed: recipientDisclosure === 'named',
    shownBeforeTransfer: timing === 'before-confirm',
    roundingStated: roundingDisclosure === 'stated',
    netAmountShown: netDisclosure === 'shown',
    changeTermsStated: feeChanges === 'fixed' ? null : changeNotice === 'advance',
  };
  const valid = Object.values(verdicts).every(v => v === true || v === null);
  return {
    status: valid ? 'complete' : 'incomplete',
    valid,
    rateDisclosure,
    recipientDisclosure,
    timing,
    roundingDisclosure,
    netDisclosure,
    feeChanges,
    changeNotice,
    canChange: feeChanges !== 'fixed',
    verdicts,
  };
}

// Escrow release model — the lifecycle the fee family never modeled.
// The v1.127–v1.135 fee family prices what a disclosed fee takes from a
// transfer, but an escrow flow is not one transfer: a funder locks an
// amount, and what happens next has three distinct outcomes — the
// amount is RELEASED to the seller on completion, REFUNDED to the
// funder when the conditions are unmet or time out, or PARTIALLY
// released, with the rest refunded. This model states all three in
// base units with the split's own BigInt discipline, reusing
// modelServiceFee on the full amount so its validation and refusals —
// including the takes-all refusal on a full release — propagate
// unchanged. The disclosed platform fee is taken AT RELEASE, never at
// funding: funding collects no fee (feeAtFunding is zero), because
// at funding no service has been completed. On a full release the fee
// is the split's exact fee (floor percentage part plus fixed fee,
// bounded by the cap, binding reported) and the seller receives the
// rest. On a refund the fee is ZERO and the funder receives the full
// gross back — a fee on refunded money would charge for a service
// never completed, and that is this model's disclosed rule, stated
// in the panel and the README as plainly as the fee itself. On a
// partial release of releasedBps of the amount, the released gross is
// floor(gross × releasedBps ÷ 10,000) and the fee is taken ONLY on
// the released part, computed with the same split rules on that part
// (floor percentage part plus the fixed fee, bounded by the cap,
// binding reported); the unreleased remainder is refunded in full
// with no fee. A computed partial fee that would take the whole
// released part does NOT refuse the model — the partial explores a
// size the full-release input did not, so it is flagged takesAll on
// the partial outcome, the fee taken is the whole released part, and
// the released net is zero (the ladder treatment the size profile
// uses). The accounting identity holds on every outcome:
// releasedNet + releasedFee + refundedRemainder === gross. All
// figures are the designer's own entered amount and fee: no feed is
// read. LOCAL MODEL ONLY: PRISM holds no funds, locks nothing, and
// executes no release or refund; the escrow modeled belongs to the
// design being priced, and its fee timing and refund rule must be
// disclosed to its users exactly as modeled.
export function modelEscrow(input = {}) {
  const split = modelServiceFee(input); // Validates amount/decimals/fee inputs on the FULL amount; its refusals (incl. takes-all) propagate.
  const releasedBps = input.releasedBps === undefined ? 5000 : Number(input.releasedBps);
  if (!Number.isInteger(releasedBps) || releasedBps < 0 || releasedBps > 10000) throw new Error('releasedBps must be a whole number of basis points between 0 and 10,000.');
  const gross = split.gross, fixed = split.fixedFee, cap = split.maxFee;
  const feeOn = part => {
    if (part === 0n) return { fee: 0n, computedFee: 0n, capApplied: false, takesAll: false };
    const uncapped = part * BigInt(split.feeBps) / 10000n + fixed;
    const computedFee = cap !== null && uncapped > cap ? cap : uncapped;
    const capApplied = cap !== null && uncapped > cap;
    const takesAll = computedFee >= part;
    return { fee: takesAll ? part : computedFee, computedFee, capApplied, takesAll };
  };
  const rateText = (fee, base) => {
    if (base === 0n) return '0.00';
    const hundredths = fee * 1000000n / base;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  const partialFee = feeOn(gross * BigInt(releasedBps) / 10000n);
  const releasedGross = gross * BigInt(releasedBps) / 10000n;
  const releasedNet = releasedGross - partialFee.fee;
  return {
    decimals: split.decimals,
    gross,
    feeBps: split.feeBps,
    fixedFee: fixed,
    maxFee: cap,
    releasedBps,
    feeAtFunding: 0n,
    release: {
      gross,
      fee: split.fee,
      platformFee: split.fee,
      sellerNet: split.net,
      net: split.net,
      uncappedFee: split.uncappedFee,
      capApplied: split.capApplied,
      effectiveBpsText: split.effectiveBpsText,
    },
    refund: {
      fee: 0n,
      refunded: gross,
      funderReceives: gross,
    },
    partial: {
      releasedBps,
      releasedGross,
      fee: partialFee.fee,
      releasedFee: partialFee.fee,
      computedFee: partialFee.computedFee,
      capApplied: partialFee.capApplied,
      takesAll: partialFee.takesAll,
      releasedNet,
      refundedRemainder: gross - releasedGross,
      effectiveBpsText: rateText(partialFee.fee, releasedGross),
    },
  };
}

export const MARKETPLACE_ROYALTY_LEVELS = Object.freeze([0, 250, 500, 750, 1000]);

// Marketplace sale model — two deductions from one price.
// The fee family prices what one disclosed fee takes from a transfer,
// and the escrow model states a locked amount’s outcomes, but a
// marketplace sale carries TWO deductions from the same price at the
// same moment: the platform fee (the service-fee split — floor
// percentage part plus fixed fee, bounded by the cap) and a creator
// royalty. Two deductions raise a question neither single-fee model
// answers: what base is each computed on, and what happens when
// together they reach the whole price? This model states both
// plainly. The platform fee is computed by reusing modelServiceFee
// on the full price, so its validation and refusals — including the
// takes-all refusal when the platform fee alone would take the whole
// price — propagate unchanged. The royalty is a share OF THE SALE:
// floor(gross × royaltyBps ÷ 10,000) on the FULL price, never on the
// after-fee remainder, because a royalty is a share of what the item
// sold for, not of what the platform leaves; that base is disclosed
// here, in the panel, and in the README, and it means a cap on the
// platform fee changes the platform fee and the seller’s net but
// never the royalty. The seller receives what remains, and the
// accounting identity holds on every sale: platformFee + royalty +
// sellerNet === gross. If the two deductions TOGETHER would take the
// whole price — each modest alone, ruinous together — the sale is
// REFUSED with its own message, never modeled with a negative or
// zero seller: a design whose deductions leave the seller nothing is
// not a sale split, it is a confiscation schedule, and it must be
// redesigned, not priced. The royalty-level rows explore other
// royalty rates at the same platform fee and FLAG a takes-all level
// instead of refusing it (the ladder treatment: rows explore rates
// the main input would refuse). Monthly figures are the per-sale
// figures at the designer’s entered monthly sales count, computed
// from the totals. All figures are the designer’s own entered price
// and rates: no feed is read and no revenue is promised. LOCAL MODEL
// ONLY: PRISM runs no marketplace, lists nothing, and executes no
// sale; the sale modeled belongs to the design being priced, and its
// deductions — their bases, their rounding, and their recipients —
// must be disclosed to its users exactly as modeled.
export function modelMarketplaceSale(input = {}) {
  const sales = input.salesPerMonth === undefined ? 20 : Number(input.salesPerMonth);
  if (!Number.isInteger(sales) || sales < 1 || sales > 1000000) throw new Error('Monthly sales must be a whole number between 1 and 1,000,000.');
  const royaltyBps = input.royaltyBps === undefined ? 250 : Number(input.royaltyBps);
  if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 10000) throw new Error('Royalty must be a whole number of basis points between 0 and 10,000.');
  const split = modelServiceFee({ ...input, transfersPerMonth: sales }); // Validates price/fee inputs on the FULL price; its refusals (incl. platform takes-all) propagate.
  const gross = split.gross;
  const royaltyOn = bps => gross * BigInt(bps) / 10000n;
  const royalty = royaltyOn(royaltyBps);
  const combined = split.fee + royalty;
  if (combined >= gross) throw new Error('The platform fee and the royalty together would take the whole price — the seller would receive nothing. Lower the fee rate, the fixed fee, the cap, or the royalty, or raise the price.');
  const sellerNet = gross - combined;
  const rateText = amount => {
    const hundredths = amount * 1000000n / gross;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  const count = BigInt(sales);
  return {
    decimals: split.decimals,
    gross,
    feeBps: split.feeBps,
    fixedFee: split.fixedFee,
    maxFee: split.maxFee,
    royaltyBps,
    salesPerMonth: sales,
    platformFee: split.fee,
    platformUncappedFee: split.uncappedFee,
    capApplied: split.capApplied,
    royalty,
    sellerNet,
    net: sellerNet,
    combinedDeductions: combined,
    platformEffectiveBpsText: split.effectiveBpsText,
    royaltyEffectiveBpsText: rateText(royalty),
    combinedEffectiveBpsText: rateText(combined),
    monthly: { gross: gross * count, platformFee: split.fee * count, royalty: royalty * count, sellerNet: sellerNet * count },
    rows: MARKETPLACE_ROYALTY_LEVELS.map(level => { const r = royaltyOn(level); return { royaltyBps: level, royalty: r, sellerNet: gross - split.fee - r, takesAll: split.fee + r >= gross }; }),
  };
}

export const LAUNCHPAD_SUBSCRIPTION_LEVELS = Object.freeze([2500, 5000, 7500, 10000, 15000, 20000]);

// Launchpad sale model — a capped raise, a fee on what filled.
// The marketplace model states the deductions on one sale; a launch
// is a different lifecycle: the issuer offers a raise up to a HARD
// CAP, subscribers commit amounts, and only the part of the
// subscriptions that fits under the cap is actually sold — the rest
// was never the issuer’s to keep. This model states the launch’s
// three outcomes in base units. The FILL is the smaller of the
// subscriptions and the cap. The platform fee is charged on the
// FILLED amount only, computed by reusing modelServiceFee on it, so
// its validation and refusals — including the takes-all refusal,
// judged on the filled amount, not on the larger subscribed figure —
// propagate unchanged: a launchpad that charged its fee on the full
// subscriptions would be charging for a raise that never happened.
// The OVERSUBSCRIPTION is refunded in full and charged nothing —
// the escrow model’s disclosed rule, for the same reason: a fee on
// refunded money would charge for a service never completed. The
// issuer receives the filled amount minus the fee, and the
// accounting identity holds on every launch: platformFee +
// issuerNet + refunded === subscribed. The fill rate and the
// subscription rate are derived from the BigInt amounts, never the
// entered figures — the subscription rate can pass 10,000 basis
// points when a launch is oversubscribed, and it is stated as
// computed. The subscription-level rows explore other subscription
// totals as shares of the cap at the same fee and FLAG a level whose
// fee would take its whole fill instead of refusing it (the ladder
// treatment: rows explore fills the main input did not enter).
// Volume held as entered: the model prices a launch, not a demand
// forecast. LOCAL MODEL ONLY: PRISM runs no launchpad, sells no
// tokens, and takes no subscriptions; the amounts are the designer’s
// own entered figures, no feed is read, and no raise is promised —
// and a real design must disclose the fee’s base (the filled amount),
// the refund rule (in full, fee-free), and the fee’s recipient to
// its subscribers exactly as modeled.
export function modelLaunchpadSale(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const hardCap = toUnits(input.hardCap === undefined ? '0' : input.hardCap, decimals); // Validates cap + decimals.
  if (hardCap <= 0n) throw new Error('Hard cap must be greater than zero.');
  const subscribed = toUnits(input.subscribed === undefined ? '0' : input.subscribed, decimals); // Validates subscriptions + decimals.
  if (subscribed <= 0n) throw new Error('Subscribed amount must be greater than zero.');
  const filled = subscribed < hardCap ? subscribed : hardCap;
  const refunded = subscribed - filled;
  const split = modelServiceFee({ amount: formatUnits(filled, decimals), decimals, feeBps: input.feeBps, fixedFee: input.fixedFee, maxFee: input.maxFee, transfersPerMonth: 1 }); // Fee on the FILLED amount; its refusals (incl. takes-all on the fill) propagate.
  const issuerNet = filled - split.fee;
  const rateText = (amount, base) => {
    const hundredths = amount * 1000000n / base;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  const feeAt = fill => {
    const uncapped = fill * BigInt(split.feeBps) / 10000n + split.fixedFee;
    const fee = split.maxFee !== null && uncapped > split.maxFee ? split.maxFee : uncapped;
    return { fee, takesAll: fee >= fill };
  };
  return {
    decimals: split.decimals,
    hardCap,
    subscribed,
    filled,
    refunded,
    unsoldCap: hardCap - filled,
    oversubscribed: subscribed > hardCap,
    feeBps: split.feeBps,
    fixedFee: split.fixedFee,
    maxFee: split.maxFee,
    platformFee: split.fee,
    platformUncappedFee: split.uncappedFee,
    capApplied: split.capApplied,
    issuerNet,
    net: issuerNet,
    fillRateBpsText: rateText(filled, subscribed),
    subscriptionRateBpsText: rateText(subscribed, hardCap),
    feeEffectiveBpsText: split.effectiveBpsText,
    rows: LAUNCHPAD_SUBSCRIPTION_LEVELS.map(level => {
      const at = hardCap * BigInt(level) / 10000n;
      const fill = at < hardCap ? at : hardCap;
      const f = feeAt(fill);
      return { levelBps: level, subscribed: at, filled: fill, refunded: at - fill, platformFee: f.fee, issuerNet: fill - f.fee, takesAll: f.takesAll };
    }),
  };
}

export const LAUNCH_ESCROW_RELEASE_LEVELS = Object.freeze([0, 2500, 5000, 7500, 10000]);

// Launch-escrow milestone model — a launch whose proceeds enter
// escrow, priced end to end. The launchpad model (v1.138) states a
// capped raise on its own and the escrow model (v1.136) states a
// locked amount on its own, but a real raise often chains them: the
// launch fills, and what the issuer actually receives is held in
// escrow until milestones are met. Chaining them raises two
// questions neither model answers alone, and this model states both
// plainly. FIRST, THE ESCROW STAGE'S BASE: the escrow prices the
// PROCEEDS — the fill minus the launch fee — never the fill itself,
// because the launch fee is already taken when the proceeds are
// locked; pricing the escrow fee on the fill would charge a second
// fee on money the platform already kept. Both stages reuse their
// own models unchanged (modelLaunchpadSale, then modelEscrow on the
// proceeds), so each stage's validation and refusals propagate,
// judged on that stage's own base: the launch's takes-all refusal on
// the fill, the escrow's on the proceeds. SECOND, THE FAILURE
// REFUND: if the milestones fail, the escrow stage charges ZERO and
// everything still escrowed returns (the escrow model's disclosed
// rule), on top of the launch's own fee-free refund of the
// oversubscription; the LAUNCH fee is retained, disclosed here, in
// the panel, and in the README — the raise itself completed, and
// the escrow refund rule governs the escrow stage only. On a full
// release the two fees are the whole cost and the accounting
// identity holds across both stages: launchFee + escrowFee +
// issuerFinalNet + launchRefunded === subscribed. On a partial
// release the escrow's partial discipline applies to the released
// share of the proceeds (fee only on the released part, capped at
// the part and flagged takesAll when the computed fee would take
// it, the uncapped figure exposed), and launchFee + releasedFee +
// releasedNet + stillHeld + launchRefunded === subscribed always.
// The total fee rate is derived from the two fees over the FILLED
// amount — the money actually raised — never from the entered
// rates. The release-level rows explore other release shares of the
// proceeds at the same two fees and FLAG a takes-all level instead
// of refusing it (the ladder treatment). LOCAL MODEL ONLY: PRISM
// runs no launchpad, holds no escrow, and takes no subscriptions;
// no feed is read and no raise or return is promised — and a real
// design must disclose both fees, each fee's base (the fill, then
// the proceeds), both refund rules, and each fee's recipient to its
// subscribers exactly as modeled.
export function modelLaunchEscrow(input = {}) {
  const launch = modelLaunchpadSale({ hardCap: input.hardCap, subscribed: input.subscribed, decimals: input.decimals, feeBps: input.launchFeeBps, fixedFee: input.launchFixedFee, maxFee: input.launchMaxFee }); // Stage 1: its validation and takes-all refusal (on the fill) propagate.
  const decimals = launch.decimals;
  const proceeds = launch.issuerNet;
  const escrow = modelEscrow({ amount: formatUnits(proceeds, decimals), decimals, feeBps: input.escrowFeeBps, fixedFee: input.escrowFixedFee, maxFee: input.escrowMaxFee, releasedBps: input.releasedBps }); // Stage 2: priced on the PROCEEDS; its full-release takes-all refusal (on the proceeds) propagates.
  const totalFeesFull = launch.platformFee + escrow.release.fee;
  const hundredthsOf = (amount, base) => {
    const hundredths = amount * 1000000n / base;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  const feeOnPart = part => {
    if (part === 0n) return { fee: 0n, computedFee: 0n, capApplied: false, takesAll: false };
    const uncapped = part * BigInt(escrow.feeBps) / 10000n + escrow.fixedFee;
    const computedFee = escrow.maxFee !== null && uncapped > escrow.maxFee ? escrow.maxFee : uncapped;
    const takesAll = computedFee >= part;
    return { fee: takesAll ? part : computedFee, computedFee, capApplied: escrow.maxFee !== null && uncapped > escrow.maxFee, takesAll };
  };
  return {
    decimals,
    hardCap: launch.hardCap,
    subscribed: launch.subscribed,
    filled: launch.filled,
    launchRefunded: launch.refunded,
    refundedAtLaunch: launch.refunded,
    oversubscribed: launch.oversubscribed,
    launchFeeBps: launch.feeBps,
    launchFee: launch.platformFee,
    platformFee: launch.platformFee,
    launchUncappedFee: launch.platformUncappedFee,
    launchCapApplied: launch.capApplied,
    proceeds,
    escrowed: proceeds,
    escrowFeeBps: escrow.feeBps,
    escrowFixedFee: escrow.fixedFee,
    escrowMaxFee: escrow.maxFee,
    releasedBps: escrow.releasedBps,
    release: {
      escrowFee: escrow.release.fee,
      escrowUncappedFee: escrow.release.uncappedFee,
      escrowCapApplied: escrow.release.capApplied,
      issuerFinalNet: escrow.release.net,
      totalFees: totalFeesFull,
    },
    refund: {
      escrowFee: 0n,
      refundedTotal: launch.refunded + proceeds,
      escrowedReturned: proceeds,
      launchFeeRetained: launch.platformFee,
    },
    partial: {
      releasedBps: escrow.partial.releasedBps,
      releasedGross: escrow.partial.releasedGross,
      releasedFee: escrow.partial.releasedFee,
      computedFee: escrow.partial.computedFee,
      capApplied: escrow.partial.capApplied,
      takesAll: escrow.partial.takesAll,
      releasedNet: escrow.partial.releasedNet,
      stillHeld: escrow.partial.refundedRemainder,
      totalFees: launch.platformFee + escrow.partial.releasedFee,
    },
    totalFeesFull,
    totalFeeRateBpsText: hundredthsOf(totalFeesFull, launch.filled),
    rows: LAUNCH_ESCROW_RELEASE_LEVELS.map(level => {
      const releasedGross = proceeds * BigInt(level) / 10000n;
      const f = feeOnPart(releasedGross);
      return { levelBps: level, releasedGross, escrowFee: f.fee, computedFee: f.computedFee, capApplied: f.capApplied, takesAll: f.takesAll, releasedNet: releasedGross - f.fee, stillHeld: proceeds - releasedGross, totalFees: launch.platformFee + f.fee };
    }),
  };
}

export const MARKETPLACE_ESCROW_RELEASE_LEVELS = Object.freeze([0, 2500, 5000, 7500, 10000]);

// Marketplace-escrow settlement model — a marketplace sale whose
// seller proceeds are held in escrow until delivery, priced end to
// end. The marketplace model (v1.137) states a sale’s two deductions
// on its own and the escrow model (v1.136) states a locked amount’s
// outcomes on its own, but a real marketplace sale often chains
// them: the buyer pays the price, and what the seller would receive
// is held until the item is delivered. Chaining them raises two
// questions neither model answers alone, and this model states both
// plainly. FIRST, THE ESCROW STAGE’S BASE: the escrow prices the
// SELLER PROCEEDS — the price minus the platform fee minus the
// royalty — never the price itself, because the platform fee and
// the royalty are the sale’s deductions, taken on the full price
// exactly as the marketplace model states them; pricing the escrow
// fee on the price would charge a third deduction on money the
// seller never stood to receive. Both stages reuse their own models
// unchanged (modelMarketplaceSale, then modelEscrow on the
// proceeds), so each stage’s validation and refusals propagate,
// judged on that stage’s own base: the marketplace stage’s refusals
// on the price (the platform fee alone taking it, or the platform
// fee and the royalty together taking it), the escrow’s takes-all
// refusal on the proceeds. SECOND, THE FAILURE REFUND: if delivery
// fails, the buyer receives the WHOLE price back and NO deduction
// is retained — the platform fee is not kept, the royalty is not
// kept, and the escrow stage charges zero. That is deliberately
// different from the launch-escrow model (v1.139), where the launch
// fee is retained on a milestone failure: there the launch had
// already completed before the escrow began, so its fee priced a
// completed stage. Here the sale and its escrow are ONE settlement
// — a sale whose item never delivers never completes, so none of
// its deductions is earned. On a full release the three deductions
// are the whole cost and the accounting identity holds across both
// stages: platformFee + royalty + escrowFee + sellerFinalNet ===
// gross. On a partial release the escrow’s partial discipline
// applies to the released share of the proceeds (fee only on the
// released part, capped at the part and flagged takesAll when the
// computed fee would take it, the uncapped figure exposed), and
// platformFee + royalty + releasedFee + releasedNet + stillHeld
// === gross always. The total deduction rate is derived from the
// three deductions over the PRICE — the money the buyer paid —
// never from the entered rates. The release-level rows explore
// other release shares of the proceeds at the same three rates and
// FLAG a takes-all level instead of refusing it (the ladder
// treatment). LOCAL MODEL ONLY: PRISM runs no marketplace, holds
// no escrow, and executes no sale; no feed is read and no revenue
// is promised — and a real design must disclose all three
// deductions, each deduction’s base (the price, the price, then
// the proceeds), the refund rule (the whole price, nothing
// retained), and each deduction’s recipient to its buyers and
// sellers exactly as modeled.
export function modelMarketplaceEscrow(input = {}) {
  const sale = modelMarketplaceSale({ amount: input.amount, decimals: input.decimals, feeBps: input.feeBps, fixedFee: input.fixedFee, maxFee: input.maxFee, royaltyBps: input.royaltyBps, salesPerMonth: 1 }); // Stage 1: its validation and refusals (on the price) propagate.
  const decimals = sale.decimals;
  const proceeds = sale.sellerNet;
  const escrow = modelEscrow({ amount: formatUnits(proceeds, decimals), decimals, feeBps: input.escrowFeeBps, fixedFee: input.escrowFixedFee, maxFee: input.escrowMaxFee, releasedBps: input.releasedBps }); // Stage 2: priced on the PROCEEDS; its full-release takes-all refusal (on the proceeds) propagates.
  const totalDeductionsFull = sale.platformFee + sale.royalty + escrow.release.fee;
  const hundredthsOf = (amount, base) => {
    const hundredths = amount * 1000000n / base;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  const feeOnPart = part => {
    if (part === 0n) return { fee: 0n, computedFee: 0n, capApplied: false, takesAll: false };
    const uncapped = part * BigInt(escrow.feeBps) / 10000n + escrow.fixedFee;
    const computedFee = escrow.maxFee !== null && uncapped > escrow.maxFee ? escrow.maxFee : uncapped;
    const takesAll = computedFee >= part;
    return { fee: takesAll ? part : computedFee, computedFee, capApplied: escrow.maxFee !== null && uncapped > escrow.maxFee, takesAll };
  };
  return {
    decimals,
    gross: sale.gross,
    price: sale.gross,
    feeBps: sale.feeBps,
    fixedFee: sale.fixedFee,
    maxFee: sale.maxFee,
    platformFee: sale.platformFee,
    platformUncappedFee: sale.platformUncappedFee,
    capApplied: sale.capApplied,
    royaltyBps: sale.royaltyBps,
    royalty: sale.royalty,
    proceeds,
    sellerProceeds: proceeds,
    escrowed: proceeds,
    escrowFeeBps: escrow.feeBps,
    escrowFixedFee: escrow.fixedFee,
    escrowMaxFee: escrow.maxFee,
    releasedBps: escrow.releasedBps,
    release: {
      escrowFee: escrow.release.fee,
      escrowUncappedFee: escrow.release.uncappedFee,
      escrowCapApplied: escrow.release.capApplied,
      sellerFinalNet: escrow.release.net,
      totalDeductions: totalDeductionsFull,
    },
    refund: {
      escrowFee: 0n,
      platformFeeRetained: 0n,
      royaltyRetained: 0n,
      buyerReceives: sale.gross,
      refundedTotal: sale.gross,
    },
    partial: {
      releasedBps: escrow.partial.releasedBps,
      releasedGross: escrow.partial.releasedGross,
      releasedFee: escrow.partial.releasedFee,
      computedFee: escrow.partial.computedFee,
      capApplied: escrow.partial.capApplied,
      takesAll: escrow.partial.takesAll,
      releasedNet: escrow.partial.releasedNet,
      stillHeld: escrow.partial.refundedRemainder,
      totalDeductions: sale.platformFee + sale.royalty + escrow.partial.releasedFee,
    },
    totalDeductionsFull,
    totalDeductionRateBpsText: hundredthsOf(totalDeductionsFull, sale.gross),
    rows: MARKETPLACE_ESCROW_RELEASE_LEVELS.map(level => {
      const releasedGross = proceeds * BigInt(level) / 10000n;
      const f = feeOnPart(releasedGross);
      return { levelBps: level, releasedGross, escrowFee: f.fee, computedFee: f.computedFee, capApplied: f.capApplied, takesAll: f.takesAll, releasedNet: releasedGross - f.fee, stillHeld: proceeds - releasedGross, totalDeductions: sale.platformFee + sale.royalty + f.fee };
    }),
  };
}

// Staking rewards dev fee (v1.147): the profit mandate names staking
// tools with a dev fee, and PRISM modeled no staking at all. A staking
// lifecycle has two different kinds of money in it — the staker's
// principal, which was theirs before the tool did anything, and the
// rewards the staking earns — and an honest dev fee may be charged
// ONLY on the second. New modelStakingRewards states that base
// discipline exactly: the dev fee is floor(totalRewards × devFeeBps ÷
// 10,000), the principal is returned whole in every outcome, and a
// dev fee that would take ALL the rewards is refused (at zero
// rewards the fee is zero and nothing is refused — nothing was
// earned, so nothing can be taken). Rewards are priced two ways,
// stated as entered: SIMPLE, a constant per-period reward of
// floor(principal × rewardBps ÷ 10,000); and COMPOUND, where each
// period's reward is floored on the balance of principal plus the
// rewards already accrued, so later periods earn on more. Every
// period's reward floors — rounding never favours the fee or the
// rewards. The effective dev share and the total reward rate are
// derived from the BigInt amounts, never from the entered rates.
// Horizon rows price the same design at 1, 6, 12, 24, and 36 periods
// under the same mode. All figures are the designer's own entered
// principal and rates: no yield feed is read and no return is
// promised. LOCAL MODEL ONLY: PRISM stakes nothing, holds no stake,
// and pays no rewards; the dev fee modeled belongs to the design
// being priced, and its base — the rewards only, never the
// principal — must be disclosed to its stakers exactly as modeled.
export const STAKING_HORIZON_PERIODS = Object.freeze([1, 6, 12, 24, 36]);
export const STAKING_MODES = Object.freeze(['simple', 'compound']);
export function modelStakingRewards(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const principal = toUnits(input.amount === undefined ? '0' : input.amount, decimals); // Validates amount + decimals.
  if (principal <= 0n) throw new Error('Staked principal must be greater than zero.');
  const rewardBps = input.rewardBps === undefined ? 500 : Number(input.rewardBps);
  if (!Number.isInteger(rewardBps) || rewardBps < 0 || rewardBps > 10000) throw new Error('Reward rate must be a whole number of basis points between 0 and 10,000.');
  const periods = input.periods === undefined ? 12 : Number(input.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 120) throw new Error('Periods must be a whole number between 1 and 120.');
  const devFeeBps = input.devFeeBps === undefined ? 1000 : Number(input.devFeeBps);
  if (!Number.isInteger(devFeeBps) || devFeeBps < 0 || devFeeBps > 10000) throw new Error('Dev fee must be a whole number of basis points between 0 and 10,000.');
  const mode = input.mode === undefined ? 'simple' : String(input.mode);
  if (!STAKING_MODES.includes(mode)) throw new Error('Mode must be simple or compound.');
  const rewardsThrough = n => {
    const schedule = [];
    let balance = principal;
    for (let i = 0; i < n; i++) {
      const base = mode === 'compound' ? balance : principal;
      const reward = base * BigInt(rewardBps) / 10000n;
      schedule.push(reward);
      balance += reward;
    }
    return { schedule, totalRewards: balance - principal, finalBalance: balance };
  };
  const rateText = (part, base) => {
    if (base === 0n) return '0.00';
    const hundredths = part * 1000000n / base;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  const main = rewardsThrough(periods);
  const totalRewards = main.totalRewards;
  const devFee = totalRewards * BigInt(devFeeBps) / 10000n;
  if (totalRewards > 0n && devFee >= totalRewards) throw new Error('The dev fee would take all the rewards — the staker would earn nothing. Lower the dev fee rate.');
  const stakerRewardsNet = totalRewards - devFee;
  const stakerFinal = principal + stakerRewardsNet;
  return {
    decimals,
    principal,
    amount: principal,
    rewardBps,
    periods,
    devFeeBps,
    mode,
    schedule: main.schedule,
    perPeriodReward: main.schedule[0] ?? 0n,
    firstPeriodReward: main.schedule[0] ?? 0n,
    lastPeriodReward: main.schedule[main.schedule.length - 1] ?? 0n,
    totalRewards,
    devFee,
    stakerRewardsNet,
    stakerFinal,
    principalReturned: principal, // The principal is never the fee's base: it returns whole in every outcome.
    devFeeShareBpsText: rateText(devFee, totalRewards),
    totalRewardRateBpsText: rateText(totalRewards, principal),
    rows: STAKING_HORIZON_PERIODS.map(n => {
      const h = rewardsThrough(n);
      const fee = h.totalRewards * BigInt(devFeeBps) / 10000n;
      return { periods: n, totalRewards: h.totalRewards, devFee: fee, takesAll: h.totalRewards > 0n && fee >= h.totalRewards, stakerRewardsNet: h.totalRewards - fee, stakerFinal: principal + (h.totalRewards - fee) };
    }),
  };
}

// Token vesting schedule (v1.147): PRISM designs programmable tokens
// but modeled no vesting, yet nearly every real allocation — team,
// treasury, investor — unlocks over time behind a cliff. New
// modelVestingSchedule prices one allocation's schedule exactly, by
// the cumulative-floor method: the cumulative vested amount at period
// n is 0 while n <= 0 or n < cliffPeriods, and floor(total × n ÷
// vestingPeriods) at n >= cliffPeriods. Cliff semantics are stated
// plainly: nothing vests before the cliff, and at the cliff period
// the whole accrued share — floor(total × cliff ÷ vestingPeriods) —
// releases at once. Each period's release is cumulative[n] −
// cumulative[n−1], so the schedule's releases sum to the total
// EXACTLY: at n = vestingPeriods the cumulative is floor(total × D ÷
// D), the total itself, and the final period takes whatever remainder
// the floors left — the cumulative-floor method leaves no dust. At
// the elapsed point being priced, vested + locked === total always,
// and the vested share is derived from the BigInt amounts (hundredths
// of a basis point over the total), never from period ratios.
// Milestone rows price the same schedule at the distinct sorted
// periods 0, the cliff, the midpoint (ceil of half the duration), and
// the full duration. All figures are the designer's own entered
// allocation and periods: no chain state is read and no release date
// is promised. LOCAL MODEL ONLY: PRISM vests nothing, holds no
// allocation, and releases no tokens; a real design must disclose its
// cliff, its duration, and its release schedule to its holders
// exactly as modeled.
export function vestingMilestonePeriods(cliffPeriods, vestingPeriods) {
  return [...new Set([0, cliffPeriods, Math.ceil(vestingPeriods / 2), vestingPeriods])].sort((a, b) => a - b);
}
export function modelVestingSchedule(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const total = toUnits(input.amount === undefined ? '0' : input.amount, decimals); // Validates amount + decimals.
  if (total <= 0n) throw new Error('Vesting amount must be greater than zero.');
  const cliffPeriods = input.cliffPeriods === undefined ? 0 : Number(input.cliffPeriods);
  if (!Number.isInteger(cliffPeriods) || cliffPeriods < 0 || cliffPeriods > 120) throw new Error('Cliff periods must be a whole number between 0 and 120.');
  const vestingPeriods = input.vestingPeriods === undefined ? 1 : Number(input.vestingPeriods);
  if (!Number.isInteger(vestingPeriods) || vestingPeriods < 1 || vestingPeriods > 120) throw new Error('Vesting periods must be a whole number between 1 and 120.');
  if (cliffPeriods > vestingPeriods) throw new Error('Cliff periods cannot exceed the vesting periods.');
  const elapsedPeriods = input.elapsedPeriods === undefined ? cliffPeriods : Number(input.elapsedPeriods);
  if (!Number.isInteger(elapsedPeriods) || elapsedPeriods < 0 || elapsedPeriods > vestingPeriods) throw new Error('Elapsed periods must be a whole number between 0 and the vesting periods.');
  const cumulativeAt = n => (n <= 0 || n < cliffPeriods ? 0n : total * BigInt(n) / BigInt(vestingPeriods));
  const schedule = [];
  let previous = 0n;
  for (let period = 1; period <= vestingPeriods; period++) {
    const cumulative = cumulativeAt(period);
    schedule.push({ period, released: cumulative - previous, cumulative });
    previous = cumulative;
  }
  const vested = cumulativeAt(elapsedPeriods);
  const locked = total - vested;
  const hundredths = vested * 1000000n / total;
  return {
    decimals,
    total,
    amount: total,
    cliffPeriods,
    vestingPeriods,
    elapsedPeriods,
    schedule,
    vested,
    locked,
    vestedShareBpsText: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`,
    cliffRelease: cumulativeAt(cliffPeriods), // The whole accrued share that releases at once at the cliff period (0 when the cliff is period 0).
    rows: vestingMilestonePeriods(cliffPeriods, vestingPeriods).map(n => {
      const rowVested = cumulativeAt(n);
      return { periods: n, vested: rowVested, locked: total - rowVested };
    }),
  };
}

// Vesting revocation model (v1.147): the vesting schedule model
// (v1.142) prices an allocation that runs to its full duration,
// but a standard real design is REVOCABLE — team and contractor
// allocations are often revocable, for example when the recipient
// leaves — and what happens on revocation is part of the design.
// New modelVestingRevocation composes modelVestingSchedule
// UNCHANGED, pricing the schedule at the revocation period as its
// elapsed point, so the base model's validation and its
// cumulative-floor schedule propagate exactly. Its semantics are
// stated plainly: at the revocation period the recipient keeps
// EXACTLY what had vested by then — the cumulative-floor amount at
// that period, which is zero when revocation comes before the
// cliff, because nothing had vested yet — everything not yet
// vested returns to the issuer/treasury, no release after
// revocation occurs, and revoking at or after the full duration
// changes nothing: the recipient keeps the whole allocation and
// nothing returns. At every revocation point kept + returned ===
// total always, and the kept and returned shares are derived from
// the BigInt amounts (hundredths of a basis point over the total),
// never from period ratios. Milestone rows reuse the schedule's
// own milestone periods, each priced as the kept and returned
// amounts if revocation happened at that period instead. All
// figures are the designer's own entered allocation and periods:
// no chain state is read and no revocation is executed. LOCAL
// MODEL ONLY — PRISM revokes nothing, holds no allocation,
// returns no tokens; a real design must disclose whether vesting
// is revocable, by whom, and what happens on revocation, exactly
// as modeled.
export function modelVestingRevocation(input = {}) {
  const revocationPeriod = input.revocationPeriod === undefined ? Number(input.cliffPeriods ?? 0) : Number(input.revocationPeriod);
  if (!Number.isInteger(revocationPeriod) || revocationPeriod < 0) throw new Error('Revocation period must be a whole number between 0 and the vesting periods.');
  let base;
  try {
    base = modelVestingSchedule({ amount: input.amount, decimals: input.decimals, cliffPeriods: input.cliffPeriods, vestingPeriods: input.vestingPeriods, elapsedPeriods: revocationPeriod }); // Composed unchanged: its validation propagates, judged at the revocation point.
  } catch (err) {
    if (err.message.startsWith('Elapsed periods')) throw new Error('Revocation period must be a whole number between 0 and the vesting periods.'); // The base judges the revocation point as its elapsed point; a point past the duration is this model's own refusal.
    throw err;
  }
  if (revocationPeriod > base.vestingPeriods) throw new Error('Revocation period must be a whole number between 0 and the vesting periods.');
  const total = base.total;
  const kept = base.vested;
  const returned = total - kept;
  const shareText = amount => {
    const hundredths = amount * 1000000n / total;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  return {
    decimals: base.decimals,
    total,
    cliffPeriods: base.cliffPeriods,
    vestingPeriods: base.vestingPeriods,
    revocationPeriod,
    kept,
    returned,
    keptShareBpsText: shareText(kept),
    returnedShareBpsText: shareText(returned),
    beforeCliff: revocationPeriod < base.cliffPeriods, // Revoked before the cliff: nothing had vested, so nothing is kept.
    noEffect: revocationPeriod >= base.vestingPeriods, // Revoked at or after the full duration: the schedule had already completed.
    rows: base.rows.map(row => ({ periods: row.periods, kept: row.vested, returned: total - row.vested })),
  };
}

// Vesting acceleration model (v1.147): the vesting schedule model
// (v1.142) prices an allocation that unlocks on its entered
// schedule, and the revocation model (v1.143) prices ending it
// early — but a standard real design also ACCELERATES vesting on
// a stated event (an acquisition, a milestone, a departure on
// good terms): part or all of what has not yet vested releases at
// once, and what that means in amounts was modeled nowhere. New
// modelVestingAcceleration composes modelVestingSchedule
// UNCHANGED, pricing the schedule at the acceleration period as
// its elapsed point, so the base model's validation and its
// cumulative-floor schedule propagate exactly. Its semantics are
// stated plainly: the accelerated amount is floor(unvested ×
// acceleratedBps ÷ 10,000) — a share of the UNVESTED remainder at
// that period, never of the total, because what already vested
// needs no acceleration — the recipient's final amount is what
// had vested normally plus the accelerated amount, and the rest
// stays locked on the original schedule. Acceleration before the
// cliff is priced as entered: nothing had vested normally yet,
// so the accelerated share applies to the whole allocation as the
// unvested remainder. Accelerating at or after the full duration
// changes nothing: everything had already vested, the unvested
// remainder is zero, and the accelerated amount is zero.
// recipientFinal + stillLocked === total always, and the
// recipient and locked shares are derived from the BigInt amounts
// (hundredths of a basis point over the total), never from period
// ratios. Milestone rows reuse the schedule's own milestone
// periods, each priced as the final and locked amounts if
// acceleration happened at that period instead, at the same
// accelerated share. All figures are the designer's own entered
// allocation and periods: no chain state is read and no
// acceleration is executed. LOCAL MODEL ONLY — PRISM accelerates
// nothing, holds no allocation, releases no tokens; a real design
// must disclose whether vesting accelerates, on what event, and
// by how much, exactly as modeled.
export function modelVestingAcceleration(input = {}) {
  const accelerationPeriod = input.accelerationPeriod === undefined ? Number(input.cliffPeriods ?? 0) : Number(input.accelerationPeriod);
  if (!Number.isInteger(accelerationPeriod) || accelerationPeriod < 0) throw new Error('Acceleration period must be a whole number between 0 and the vesting periods.');
  const acceleratedBps = input.acceleratedBps === undefined ? 5000 : Number(input.acceleratedBps);
  if (!Number.isInteger(acceleratedBps) || acceleratedBps < 0 || acceleratedBps > 10000) throw new Error('Accelerated share must be a whole number of basis points between 0 and 10000.');
  let base;
  try {
    base = modelVestingSchedule({ amount: input.amount, decimals: input.decimals, cliffPeriods: input.cliffPeriods, vestingPeriods: input.vestingPeriods, elapsedPeriods: accelerationPeriod }); // Composed unchanged: its validation propagates, judged at the acceleration point.
  } catch (err) {
    if (err.message.startsWith('Elapsed periods')) throw new Error('Acceleration period must be a whole number between 0 and the vesting periods.'); // The base judges the acceleration point as its elapsed point; a point past the duration is this model's own refusal.
    throw err;
  }
  if (accelerationPeriod > base.vestingPeriods) throw new Error('Acceleration period must be a whole number between 0 and the vesting periods.');
  const total = base.total;
  const priceAt = vested => {
    const unvested = total - vested;
    const accelerated = unvested * BigInt(acceleratedBps) / 10000n; // BigInt floor: the accelerated share of the unvested remainder, never of the total.
    const recipientFinal = vested + accelerated;
    return { normallyVested: vested, unvestedAtPeriod: unvested, accelerated, recipientFinal, stillLocked: total - recipientFinal };
  };
  const priced = priceAt(base.vested);
  const shareText = amount => {
    const hundredths = amount * 1000000n / total;
    return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
  };
  return {
    decimals: base.decimals,
    total,
    cliffPeriods: base.cliffPeriods,
    vestingPeriods: base.vestingPeriods,
    accelerationPeriod,
    acceleratedBps,
    normallyVested: priced.normallyVested,
    unvestedAtPeriod: priced.unvestedAtPeriod,
    accelerated: priced.accelerated,
    recipientFinal: priced.recipientFinal,
    stillLocked: priced.stillLocked,
    recipientShareBpsText: shareText(priced.recipientFinal),
    lockedShareBpsText: shareText(priced.stillLocked),
    beforeCliff: accelerationPeriod < base.cliffPeriods, // Accelerated before the cliff: nothing had vested normally, so the share applies to the whole allocation.
    fullAcceleration: acceleratedBps === 10000, // The whole unvested remainder accelerates, so nothing stays locked.
    zeroAcceleration: acceleratedBps === 0, // No share accelerates: the recipient's final amount is exactly what had vested normally.
    noEffect: accelerationPeriod >= base.vestingPeriods, // Accelerated at or after the full duration: the schedule had already completed, so nothing remains to accelerate.
    rows: base.rows.map(row => ({ periods: row.periods, ...priceAt(row.vested) })),
  };
}

// Pro-rata holder distribution model (v1.147): a distribution to a
// token's holders — an airdrop, a revenue share, a reward pool —
// divides ONE pool among holders in proportion to what each one
// HOLDS, and PRISM modeled no such division. This is a different
// question from the revenue split (v1.133), which divides a fee
// among named recipients by ENTERED percentage shares: here no
// share is ever entered — each holder's share is DERIVED from
// their balance, so the model's first discipline is its base:
// every amount is priced on the balances, never on what a holder
// receives. New modelHolderDistribution states the division
// exactly: each holder receives floor(pool × balance ÷
// totalBalances), in BigInt, so a holder's fraction of the pool
// is their fraction of the total balance, floored per holder.
// Per-holder flooring leaves dust: distributed is the sum of the
// floored receives, undistributed is pool − distributed, and
// distributed + undistributed === pool always — the undistributed
// remainder belongs to NO holder in this model, and because each
// holder's floor loses less than one base unit it is always
// >= 0 and < the holder count in base units. A zero-balance
// holder receives zero and holds a zero share; one holder
// holding the whole total balance (soleHolder) receives the
// whole pool exactly, with no dust. Each holder's holding share
// is derived from the BALANCE amounts (hundredths of a basis
// point over totalBalances), never from the receives — flooring
// can move a receive by a base unit, and the share a design
// discloses is the holding that priced it, not its floored
// result. Holders are told apart by label — required, trimmed,
// duplicates refused case-insensitively (the revenue split's
// discipline) — because two rows a reader cannot tell apart
// cannot be disclosed honestly. All figures are the designer's
// own entered pool and balances: no chain state is read, no
// snapshot is taken, and no balance is verified. LOCAL MODEL
// ONLY — PRISM distributes nothing, holds no pool, and pays no
// holder; a real design must disclose the snapshot of balances
// a distribution is priced on and what happens to the
// undistributed remainder, exactly as modeled.
export function modelHolderDistribution(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const pool = toUnits(input.pool === undefined ? '0' : input.pool, decimals); // Validates pool + decimals.
  if (pool <= 0n) throw new Error('Distribution pool must be greater than zero.');
  const list = input.holders;
  if (!Array.isArray(list) || list.length === 0) throw new Error('At least one holder is required to model a holder distribution.');
  if (list.length > 5) throw new Error('A holder distribution models at most five holders at a time.');
  const seen = new Set();
  const holders = list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Holder ${index + 1} needs its own label and balance.`);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new Error(`Holder ${index + 1} needs a label so its share can be told apart from the others.`);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate holder label: ${label}. Each holder in the distribution needs its own label.`);
    seen.add(key);
    const balance = toUnits(entry.balance === undefined ? '0' : entry.balance, decimals); // Zero is allowed: a zero-balance holder receives zero.
    return { label, balance };
  });
  const totalBalances = holders.reduce((sum, entry) => sum + entry.balance, 0n);
  if (totalBalances <= 0n) throw new Error('Total holder balance must be greater than zero.');
  const priced = holders.map(entry => {
    const receives = pool * entry.balance / totalBalances; // BigInt floor: the holder's balance share of the pool, floored per holder.
    const hundredths = entry.balance * 1000000n / totalBalances;
    return { label: entry.label, balance: entry.balance, receives, holdingShareBpsText: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}` };
  });
  const distributed = priced.reduce((sum, entry) => sum + entry.receives, 0n);
  const undistributed = pool - distributed; // Floor dust: belongs to no holder; always >= 0 and < the holder count in base units.
  return {
    decimals,
    pool,
    totalBalances,
    holders: priced,
    distributed,
    undistributed,
    soleHolder: holders.some(entry => entry.balance === totalBalances), // One holder holds the whole total balance, so they receive the whole pool and there is no dust.
    hasDust: undistributed > 0n, // Per-holder flooring left a remainder that belongs to no holder.
  };
}

// Capped pro-rata holder distribution model (v1.147): the holder
// distribution (v1.145) divides a pool by holdings with no limit,
// but a standard real design CAPS what any one holder may receive
// — an airdrop fairness cap, a whale cap on a revenue share — and
// redistributes what the cap holds back to the holders still
// under it. That changes the division itself, so this is a new
// model, not a knob on the old one: the division runs in ROUNDS
// (water-filling). Each round prices the still-active holders'
// shares on the round's remaining pool over their total balance,
// exactly as the uncapped division prices its shares —
// floor(roundPool × balance ÷ totalActiveBalance), in BigInt —
// and a holder whose share passes the room they have left under
// the cap receives only that room, is capped, and leaves the
// active set; what they did not take is priced again among the
// holders who remain. A round in which no holder is capped ends
// the division: its leftover is floor dust, as in the uncapped
// model. The cap also changes what the remainder MEANS: when
// every positive-balance holder is at the cap (allCapped), the
// undistributed remainder is cap-blocked, not dust — it is not
// bounded by the holder count and can be most of the pool, and a
// real design must say where it goes. No holder ever receives
// more than the cap, distributed + undistributed === pool
// always, and each holder's holding share is still derived from
// the BALANCE amounts, never from the receives — a capped
// holder's receive understates their holding, and the share a
// design discloses is the holding that priced it. Holders are
// told apart by label exactly as in the uncapped model —
// required, trimmed, duplicates refused case-insensitively.
// All figures are the designer's own entered pool, cap, and
// balances: no chain state is read, no snapshot is taken, and no
// balance is verified. LOCAL MODEL ONLY — PRISM distributes
// nothing, holds no pool, pays no holder, and enforces no cap; a
// real design must disclose its cap, the snapshot of balances a
// distribution is priced on, and what happens to any remainder
// the cap leaves undistributed, exactly as modeled.
export function modelCappedHolderDistribution(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const pool = toUnits(input.pool === undefined ? '0' : input.pool, decimals); // Validates pool + decimals.
  if (pool <= 0n) throw new Error('Distribution pool must be greater than zero.');
  const cap = toUnits(input.cap === undefined ? '0' : input.cap, decimals); // Validates cap in the same units.
  if (cap <= 0n) throw new Error('Per-holder cap must be greater than zero.');
  const list = input.holders;
  if (!Array.isArray(list) || list.length === 0) throw new Error('At least one holder is required to model a holder distribution.');
  if (list.length > 5) throw new Error('A holder distribution models at most five holders at a time.');
  const seen = new Set();
  const holders = list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Holder ${index + 1} needs its own label and balance.`);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new Error(`Holder ${index + 1} needs a label so its share can be told apart from the others.`);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate holder label: ${label}. Each holder in the distribution needs its own label.`);
    seen.add(key);
    const balance = toUnits(entry.balance === undefined ? '0' : entry.balance, decimals); // Zero is allowed: a zero-balance holder receives zero.
    return { label, balance };
  });
  const totalBalances = holders.reduce((sum, entry) => sum + entry.balance, 0n);
  if (totalBalances <= 0n) throw new Error('Total holder balance must be greater than zero.');
  const received = holders.map(() => 0n);
  let remaining = pool;
  let rounds = 0;
  let active = holders.map((entry, index) => index).filter(index => holders[index].balance > 0n);
  while (remaining > 0n && active.length > 0) {
    rounds++;
    const roundPool = remaining;
    const totalActive = active.reduce((sum, index) => sum + holders[index].balance, 0n);
    let granted = 0n;
    let cappedAny = false;
    const stillActive = [];
    for (const index of active) {
      const share = roundPool * holders[index].balance / totalActive; // BigInt floor, priced on this round's remaining pool and the still-active balances.
      const headroom = cap - received[index];
      const grant = share < headroom ? share : headroom;
      if (share > headroom) cappedAny = true; // The cap held this holder back this round: what they did not take is priced again among the rest.
      received[index] += grant;
      granted += grant;
      if (received[index] < cap) stillActive.push(index);
    }
    remaining -= granted;
    if (!cappedAny) break; // Nobody was capped: the leftover is floor dust from this round's flooring, and the division is done.
    active = stillActive; // At least one holder reached the cap this round, so the active set shrank and the loop terminates.
  }
  const priced = holders.map((entry, index) => {
    const hundredths = entry.balance * 1000000n / totalBalances;
    return { label: entry.label, balance: entry.balance, receives: received[index], holdingShareBpsText: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`, capped: received[index] === cap };
  });
  const distributed = priced.reduce((sum, entry) => sum + entry.receives, 0n);
  const undistributed = pool - distributed; // Floor dust when the cap never binds everyone; cap-blocked remainder when it does — allCapped says which.
  return {
    decimals,
    pool,
    cap,
    totalBalances,
    holders: priced,
    distributed,
    undistributed,
    cappedCount: priced.filter(entry => entry.capped).length,
    allCapped: priced.filter(entry => entry.balance > 0n).every(entry => entry.capped), // Every holder who holds anything is at the cap, so nothing more can be distributed under it.
    rounds,
  };
}

// Minimum-guarantee holder distribution model (v1.147): the holder
// distribution (v1.145) divides a pool by holdings with no limit,
// and the capped distribution (v1.146) caps what any one holder
// may receive; a standard real design does the opposite — it
// GUARANTEES each eligible holder a minimum, an airdrop floor so
// small holders are not dusted out, then divides what remains
// pro-rata by holdings. That changes the design question, so this
// is a new model, not a knob on the old ones: the guarantees are
// reserved FIRST, they are feasible only if minimum × eligible
// count fits in the pool, and only holders who actually hold are
// eligible for the guarantee — a zero-balance holder receives
// zero and is guaranteed nothing. Division: guaranteeTotal =
// minimum × eligibleCount is reserved first; remainderPool =
// pool − guaranteeTotal is divided among eligible holders exactly
// as the uncapped model divides its pool —
// floor(remainderPool × balance ÷ totalBalances) in BigInt — and
// each eligible holder receives minimum + their remainder share.
// Distributed + undistributed === pool always, and the
// undistributed remainder is floor dust from the remainder
// division only: it is < eligibleCount in base units when
// eligibleCount > 0. A minimum of zero is allowed and reproduces
// the uncapped division exactly. Each holder's holding share is
// still derived from the BALANCE amounts, never from the
// receives. Holders are told apart by label exactly as in the
// uncapped model — required, trimmed, duplicates refused
// case-insensitively. All figures are the designer's own entered
// pool, minimum, and balances: no chain state is read, no
// snapshot is taken, and no balance is verified. LOCAL MODEL
// ONLY — PRISM distributes nothing, holds no pool, pays no
// holder, and guarantees nothing; a real design must disclose
// its minimum, who is eligible for it, the snapshot of balances
// it is priced on, and what happens to the undistributed
// remainder, exactly as modeled.
export function modelMinimumHolderDistribution(input = {}) {
  const decimals = input.decimals === undefined ? 6 : Number(input.decimals);
  const pool = toUnits(input.pool === undefined ? '0' : input.pool, decimals); // Validates pool + decimals.
  if (pool <= 0n) throw new Error('Distribution pool must be greater than zero.');
  if (input.minimum !== undefined && String(input.minimum).trim().startsWith('-')) throw new Error('Per-holder minimum cannot be negative.'); // Checked before toUnits, whose amount layer would otherwise refuse a negative with its generic message.
  const minimum = toUnits(input.minimum === undefined ? '0' : input.minimum, decimals); // Validates minimum in the same units; zero is allowed.
  if (minimum < 0n) throw new Error('Per-holder minimum cannot be negative.');
  const list = input.holders;
  if (!Array.isArray(list) || list.length === 0) throw new Error('At least one holder is required to model a holder distribution.');
  if (list.length > 5) throw new Error('A holder distribution models at most five holders at a time.');
  const seen = new Set();
  const holders = list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Holder ${index + 1} needs its own label and balance.`);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new Error(`Holder ${index + 1} needs a label so its share can be told apart from the others.`);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate holder label: ${label}. Each holder in the distribution needs its own label.`);
    seen.add(key);
    const balance = toUnits(entry.balance === undefined ? '0' : entry.balance, decimals); // Zero is allowed: a zero-balance holder receives zero and is guaranteed nothing.
    return { label, balance };
  });
  const totalBalances = holders.reduce((sum, entry) => sum + entry.balance, 0n);
  if (totalBalances <= 0n) throw new Error('Total holder balance must be greater than zero.');
  const eligibleCount = holders.filter(entry => entry.balance > 0n).length;
  const guaranteeTotal = minimum * BigInt(eligibleCount); // Reserved first, before any pro-rata division.
  if (guaranteeTotal > pool) throw new Error('Per-holder minimum times the eligible holder count exceeds the pool.');
  const remainderPool = pool - guaranteeTotal;
  const priced = holders.map(entry => {
    const eligible = entry.balance > 0n;
    const guaranteed = eligible ? minimum : 0n;
    const proRata = eligible ? remainderPool * entry.balance / totalBalances : 0n; // BigInt floor, priced on the remainder over the total balance exactly as the uncapped division.
    const hundredths = entry.balance * 1000000n / totalBalances;
    return { label: entry.label, balance: entry.balance, eligible, guaranteed, proRata, receives: guaranteed + proRata, holdingShareBpsText: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}` };
  });
  const distributed = priced.reduce((sum, entry) => sum + entry.receives, 0n);
  const undistributed = pool - distributed; // Floor dust from the remainder division only; < eligibleCount in base units when eligibleCount > 0.
  return {
    decimals,
    pool,
    minimum,
    totalBalances,
    holders: priced,
    eligibleCount,
    guaranteeTotal,
    remainderPool,
    distributed,
    undistributed,
  };
}
