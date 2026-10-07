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
