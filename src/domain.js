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
