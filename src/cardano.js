// Dependency-free CIP-19 Bech32 codec. Used only for reading/deriving addresses.
// No keys, transaction signing, or transaction submission are implemented here.
const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  let chk=1;
  const gen=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  for(const v of values) {const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^v;for(let i=0;i<5;i++) if((top>>>i)&1)chk^=gen[i];}
  return chk>>>0;
}
function expand(hrp) {return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31));}
function convert(data,from,to,pad) {
  let acc=0,bits=0;const out=[],max=(1<<to)-1;
  for(const v of data){if(v<0||v>>from)throw new Error('Invalid encoded value.');acc=((acc<<from)|v)&((1<<(from+to-1))-1);bits+=from;while(bits>=to){bits-=to;out.push((acc>>>bits)&max);}}
  if(pad){if(bits)out.push((acc<<(to-bits))&max);}else if(bits>=from||((acc<<(to-bits))&max))throw new Error('Invalid address padding.');
  return out;
}
export function encodeBech32(hrp, bytes) {
  const data=convert(bytes,8,5,true),p=polymod([...expand(hrp),...data,0,0,0,0,0,0])^1;
  const sum=Array.from({length:6},(_,i)=>(p>>>(5*(5-i)))&31);
  return `${hrp}1${[...data,...sum].map(v=>CHARSET[v]).join('')}`;
}
export function encodeAddress(bytes) {
  return encodeBech32((bytes[0]&15)===1?'addr':'addr_test', bytes);
}
export function hexToBytes(hex) {
  if(typeof hex!=='string'||!/^([a-f0-9]{2})+$/i.test(hex))throw new Error('Invalid hexadecimal data.');
  return Uint8Array.from(hex.match(/../g),b=>parseInt(b,16));
}
export function decodeAddress(address) {
  if(typeof address!=='string'||address.length>200)throw new Error('Enter a Shelley payment address.');
  // The hex form — the raw address bytes as hexadecimal, which is how
  // CIP-30 wallet APIs and Koios return addresses. A Bech32 string can
  // never be all-hex (its addr / addr_test prefix contains 'r'), so a
  // purely hexadecimal string is unambiguously the hex form. Hex carries
  // NO checksum: the byte checks below (header, lengths, strict pointer
  // parsing) are the only validation it gets, and the decoded result is
  // labelled with its form so callers can state that difference.
  if(/^[0-9a-f]+$/i.test(address)){
    if(address.length%2)throw new Error('Address hex must have an even number of characters — each byte is two hex digits.');
    return decodeAddressBytes(hexToBytes(address.toLowerCase()),'hex');
  }
  if(address!==address.toLowerCase()&&address!==address.toUpperCase())throw new Error('Mixed-case Bech32 address.');
  const s=address.toLowerCase(),split=s.lastIndexOf('1'),hrp=s.slice(0,split);
  if(!['addr','addr_test'].includes(hrp)||s.length-split<7)throw new Error('Enter a Cardano addr or addr_test payment address.');
  const data=[...s.slice(split+1)].map(c=>CHARSET.indexOf(c));
  if(data.some(v=>v<0)||polymod([...expand(hrp),...data])!==1)throw new Error('Address checksum is invalid.');
  const bytes=Uint8Array.from(convert(data.slice(0,-6),5,8,false));
  if((bytes[0]&15)===1!==(hrp==='addr'))throw new Error('Address network prefix does not match its header.');
  return decodeAddressBytes(bytes,'bech32');
}
// Shared structural validation for both encodings of the same bytes: the
// network nibble, the CIP-19 type, and each type's exact shape. Bech32
// inputs have already had their checksum and prefix verified by the
// caller; hex inputs get only these checks, by the encoding's nature.
function decodeAddressBytes(bytes, form) {
  const type=bytes[0]>>>4,network=bytes[0]&15;
  if(![0,1].includes(network))throw new Error('Address network prefix does not match its header.');
  if([4,5].includes(type)){
    // Pointer addresses are variable-length: header + 28-byte payment
    // credential + the pointer's three variable-length coordinates.
    if(bytes.length<32)throw new Error('A pointer address is too short: a header, a 28-byte payment credential, and three pointer coordinates are required.');
    return {bytes,type,network,payment:bytes.slice(1,29),paymentIsScript:type===5,pointer:parsePointer(bytes.slice(29)),form};
  }
  if(![0,1,2,3,6,7].includes(type)||bytes.length!==(type<4?57:29))throw new Error('Use a Shelley base, enterprise, or pointer address; Byron and reward addresses are not supported.');
  return {bytes,type,network,payment:bytes.slice(1,29),paymentIsScript:[1,3,7].includes(type),pointer:null,form};
}
// CIP-19 chain pointer: three coordinates — absolute slot, transaction
// index within the slot, certificate index within the transaction — each a
// variable-length natural: 7-bit groups, most significant first, with the
// high bit set on every byte except a number's last. Parsing is strict so
// an address decodes to exactly one pointer or none: a truncated number
// (continuation bit still set at the end), trailing bytes after the third
// coordinate, a non-canonical leading zero group, and a coordinate beyond
// the safe-integer range are all refused rather than guessed at.
function readVariableLengthUint(bytes, offset) {
  let value=0n,groups=0,start=offset;
  while(true){
    if(offset>=bytes.length)throw new Error('Pointer is truncated: a coordinate runs past the end of the address.');
    const byte=bytes[offset++];
    if(groups===0&&byte===0x80)throw new Error('Pointer coordinate is not in canonical form: a leading zero group would give the same pointer a second byte form.');
    value=(value<<7n)|BigInt(byte&0x7f);groups++;
    if(groups>9)throw new Error('Pointer coordinate is too large to read exactly.');
    if(!(byte&0x80))break;
  }
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Pointer coordinate is too large to read exactly.');
  return {value:Number(value),next:offset,bytes:offset-start};
}
function parsePointer(bytes) {
  const names=['slot','txIndex','certIndex'],pointer={};let offset=0;
  for(const name of names){const r=readVariableLengthUint(bytes,offset);pointer[name]=r.value;offset=r.next;}
  if(offset!==bytes.length)throw new Error('Pointer has trailing bytes after its three coordinates, so the address does not decode to exactly one pointer.');
  return pointer;
}
export function bytesToHex(bytes) {
  if(!(bytes instanceof Uint8Array)) throw new Error('Expected bytes to render as hex.');
  return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}
// CIP-19 header nibble meanings for the address types this codec supports.
// Base addresses carry a payment credential (bytes 1–28) and a stake
// credential (bytes 29–56); enterprise addresses carry only the payment
// credential. Each credential is independently a key hash or a script hash.
const ADDRESS_TYPES = Object.freeze({
  0:{kind:'Base',payment:'key',stake:'key'},
  1:{kind:'Base',payment:'script',stake:'key'},
  2:{kind:'Base',payment:'key',stake:'script'},
  3:{kind:'Base',payment:'script',stake:'script'},
  4:{kind:'Pointer',payment:'key',stake:null},
  5:{kind:'Pointer',payment:'script',stake:null},
  6:{kind:'Enterprise',payment:'key',stake:null},
  7:{kind:'Enterprise',payment:'script',stake:null},
});
// A read-only structural breakdown of a Shelley address, decoded locally —
// nothing is looked up on chain, so this says what an address IS, never what
// it holds or whether any deployment recognises it. The CIP-113 smart-wallet
// shape is a base address whose payment credential is a script hash (the
// shared programmable base script) and whose stake-position credential is
// the owner's original payment credential; matching that shape is reported
// as `smartWalletShape` only — the same shape could belong to any script
// payment address, and membership in a CIP-113 deployment is proven by the
// registry and the deployed base script hash, not by shape alone.
// CIP-19 reward address construction from a stake credential: a header
// byte (type 14 = key credential, 15 = script credential; low nibble =
// network) followed by the 28-byte stake credential, Bech32-encoded under
// stake / stake_test. Pure construction — the same bytes any wallet or
// explorer derives — performing no lookup, registration, or delegation.
function rewardAddressFor(network, stakeCredential, stakeBytes) {
  const type=stakeCredential==='script'?15:14;
  const bytes=Uint8Array.from([(type<<4)|network,...stakeBytes]);
  return {address:encodeBech32(network===1?'stake':'stake_test',bytes),hex:bytesToHex(bytes),type};
}
export function inspectAddress(address) {
  const decoded=decodeAddress(address);
  const meta=ADDRESS_TYPES[decoded.type];
  if(!meta) throw new Error('Unsupported Shelley address type.');
  const payment={credential:meta.payment,hash:bytesToHex(decoded.bytes.slice(1,29))};
  const stake=meta.stake?{credential:meta.stake,hash:bytesToHex(decoded.bytes.slice(29,57))}:null;
  const smartWalletShape=meta.kind==='Base'&&meta.payment==='script';
  const reward=stake?rewardAddressFor(decoded.network,meta.stake,decoded.bytes.slice(29,57)):null;
  return {
    address:encodeAddress(decoded.bytes),
    network:decoded.network,
    networkName:decoded.network===1?'Mainnet':'Testnet',
    type:decoded.type,
    kind:meta.kind,
    byteLength:decoded.bytes.length,
    payment,
    stake,
    // Pointer addresses carry no stake credential: their delegation part
    // is the decoded chain pointer (or null for every other kind). The
    // pointer names where a stake registration certificate sits on chain;
    // resolving which credential it registered is a chain lookup, so no
    // reward address is derived for a pointer address (reward stays null).
    pointer:decoded.pointer,
    // Which encoding the address was entered in ('bech32' or 'hex'): the
    // decoded structure is identical either way, but Bech32's checksum was
    // verified while hex has none — the UI states which guarantee applies.
    inputForm:decoded.form,
    rewardAddress:reward?reward.address:null,
    smartWalletShape,
    ownerCredential:smartWalletShape?stake.hash:null,
  };
}
// CIP-19 reward (stake) addresses: 29 bytes — a header byte (type 14 = key
// credential, 15 = script credential; low nibble = network) followed by the
// 28-byte stake credential. CIP-30 returns them as hex; the bech32 stake /
// stake_test form is accepted too. Decoded locally like payment addresses —
// this says what the credential IS, never what it controls or holds. The
// two encodings are NOT equally safe, so the result records which one was
// entered, exactly as the payment inspector does (v1.44): Bech32's checksum
// is verified, while hex carries no checksum at all — a purely hexadecimal
// string is unambiguously the hex form, because a Bech32 reward string can
// never be all-hex (its stake / stake_test prefix contains 'k', 's', 't').
export function inspectRewardAddress(raw) {
  if(typeof raw!=='string'||raw.length>200) throw new Error('Enter a Shelley reward address.');
  let bytes,form;
  if(/^[0-9a-f]+$/i.test(raw)) {
    if(raw.length%2) throw new Error('Reward address hex must have an even number of characters — each byte is two hex digits.');
    bytes=hexToBytes(raw.toLowerCase()); form='hex';
  } else {
    if(raw!==raw.toLowerCase()&&raw!==raw.toUpperCase()) throw new Error('Mixed-case Bech32 address.');
    const s=raw.toLowerCase(),split=s.lastIndexOf('1'),hrp=s.slice(0,split);
    if(!['stake','stake_test'].includes(hrp)||s.length-split<7) throw new Error('Enter a Cardano stake or stake_test reward address.');
    const data=[...s.slice(split+1)].map(c=>CHARSET.indexOf(c));
    if(data.some(v=>v<0)||polymod([...expand(hrp),...data])!==1) throw new Error('Address checksum is invalid.');
    bytes=Uint8Array.from(convert(data.slice(0,-6),5,8,false));
    if((bytes[0]&15)===1!==(hrp==='stake')) throw new Error('Address network prefix does not match its header.');
    form='bech32';
  }
  const type=bytes[0]>>>4,network=bytes[0]&15;
  if(bytes.length!==29||![14,15].includes(type)||![0,1].includes(network)) throw new Error('Use a Shelley reward address (header type 14 or 15, 29 bytes).');
  return {
    address:encodeBech32(network===1?'stake':'stake_test',bytes),
    hex:bytesToHex(bytes),
    network,
    networkName:network===1?'Mainnet':'Testnet',
    type,
    credential:type===14?'key':'script',
    hash:bytesToHex(bytes.slice(1,29)),
    byteLength:bytes.length,
    // Which encoding the address was entered in ('bech32' or 'hex'): the
    // decoded credential is identical either way, but Bech32's checksum was
    // verified while hex has none — callers state which guarantee applies.
    inputForm:form,
  };
}
// Derive a base address's reward (stake) address locally: a base address's
// stake credential alone determines it — header type 14 when the stake
// credential is a key hash, 15 when it is a script hash, on the payment
// address's own network. The payment credential plays no part. An
// enterprise address carries no stake credential, so it has no reward
// address and derivation is refused rather than faked. Derivation is
// construction, not registration: it delegates nothing, registers no stake
// certificate, and looks nothing up — whether this stake credential is
// registered or delegated is a chain question the derivation cannot answer.
export function deriveRewardAddress(address) {
  const decoded=decodeAddress(address);
  const meta=ADDRESS_TYPES[decoded.type];
  if(!meta) throw new Error('Unsupported Shelley address type.');
  if(meta.kind==='Pointer') throw new Error(`Pointer addresses carry no stake credential in the address itself — their stake rights follow the stake registration certificate at slot ${decoded.pointer.slot}, transaction ${decoded.pointer.txIndex}, certificate ${decoded.pointer.certIndex}, which only a chain lookup can resolve, so no reward address can be derived locally.`);
  if(!meta.stake) throw new Error('Enterprise addresses carry no stake credential, so no reward address can be derived from one — staking rewards accrue to the stake credential a base address carries.');
  const stakeBytes=decoded.bytes.slice(29,57);
  const reward=rewardAddressFor(decoded.network,meta.stake,stakeBytes);
  return {
    address:reward.address,
    hex:reward.hex,
    network:decoded.network,
    networkName:decoded.network===1?'Mainnet':'Testnet',
    type:reward.type,
    credential:meta.stake,
    hash:bytesToHex(stakeBytes),
    sourceType:decoded.type,
    byteLength:29,
  };
}
// Reward (stake) address construction — the inverse of inspectRewardAddress,
// and the standalone form of deriveRewardAddress: assemble a CIP-19 reward
// address directly from a stake credential (kind + 28-byte hash) and a
// network, entirely locally, without needing a payment address to derive it
// from. The credential kind alone picks the header type (14 = key, 15 =
// script); there is no payment credential in a reward address at all.
// Construction is strict so every built address inspects back to exactly
// its inputs: a hash that is not exactly 28 bytes is refused with its byte
// count, because a shorter or longer hash is not a Cardano credential under
// any reading. Building a reward address creates no stake account or key,
// registers no stake certificate, delegates to no pool, and proves nothing
// about the credential: whether it is registered or delegated is chain
// state, and a script hash names no script until a deployed script hashes
// to it. The address built from a base address's stake credential is
// exactly the address deriveRewardAddress derives from that base address —
// the two constructions are the same bytes, pinned by test.
export function buildRewardAddress(stakeCredential, stakeHashHex, network) {
  if (!['key', 'script'].includes(stakeCredential)) throw new Error('Stake credential must be a key hash or a script hash.');
  if (![0, 1].includes(network)) throw new Error('Network must be 0 (testnet) or 1 (mainnet).');
  const stakeBytes = credentialBytes('Stake credential', stakeHashHex);
  const reward = rewardAddressFor(network, stakeCredential, stakeBytes);
  return {
    address: reward.address,
    hex: reward.hex,
    network,
    networkName: network === 1 ? 'Mainnet' : 'Testnet',
    type: reward.type,
    credential: stakeCredential,
    hash: bytesToHex(stakeBytes),
    byteLength: 29,
  };
}
// Shelley address construction — the inverse of inspectAddress: assemble a
// CIP-19 payment address from its credentials, entirely locally. The header
// byte is fully determined by the credential kinds: base types 0–3 pair a
// payment credential (key / script) with a stake credential (key / script),
// enterprise types 6–7 carry a payment credential alone. Construction is
// strict so every built address inspects back to exactly its inputs
// (round-trip): a credential hash that is not exactly 28 bytes cannot be a
// Cardano credential under any reading, and a stake hash supplied alongside
// "no stake credential" is refused rather than silently dropped — dropping
// it would build a different address (an enterprise one, with no staking
// rights) from the one the builder described. Building an address creates
// no wallet, key, or account, registers nothing, and proves nothing about
// the credentials: a script hash names no script until a deployed script
// hashes to it, and a key hash controls nothing until its key exists.
const ADDRESS_TYPE_BY_CREDENTIALS = Object.freeze({
  'key/key': 0, 'script/key': 1, 'key/script': 2, 'script/script': 3,
  'key/none': 6, 'script/none': 7,
});
function credentialBytes(label, hashHex) {
  if (typeof hashHex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(hashHex)) {
    const got = typeof hashHex === 'string' && /^(?:[a-f0-9]{2})*$/i.test(hashHex) && hashHex ? `${hashHex.length / 2} bytes` : 'not even-length hexadecimal';
    throw new Error(`${label} hash must be exactly 28 bytes (56 hexadecimal characters) — got ${got}.`);
  }
  if (hashHex.length !== 56) throw new Error(`${label} hash must be exactly 28 bytes (56 hexadecimal characters) — got ${hashHex.length / 2} bytes.`);
  return hexToBytes(hashHex.toLowerCase());
}
export function buildAddress(paymentCredential, paymentHashHex, stakeCredential, stakeHashHex, network) {
  if (!['key', 'script'].includes(paymentCredential)) throw new Error('Payment credential must be a key hash or a script hash.');
  if (stakeCredential !== null && !['key', 'script'].includes(stakeCredential)) throw new Error('Stake credential must be a key hash, a script hash, or none (enterprise).');
  if (![0, 1].includes(network)) throw new Error('Network must be 0 (testnet) or 1 (mainnet).');
  const paymentBytes = credentialBytes('Payment credential', paymentHashHex);
  let stakeBytes = null;
  if (stakeCredential === null) {
    if (stakeHashHex) throw new Error('No stake credential was chosen (enterprise), but a stake hash was supplied — an enterprise address carries no stake credential, so that hash would be silently dropped. Clear the stake hash, or choose a stake credential kind to build a base address.');
  } else {
    if (!stakeHashHex) throw new Error('A stake credential kind was chosen, but no stake hash was supplied — a base address carries both credentials. Supply the stake hash, or choose no stake credential to build an enterprise address.');
    stakeBytes = credentialBytes('Stake credential', stakeHashHex);
  }
  const type = ADDRESS_TYPE_BY_CREDENTIALS[`${paymentCredential}/${stakeCredential === null ? 'none' : stakeCredential}`];
  const bytes = Uint8Array.from([(type << 4) | network, ...paymentBytes, ...(stakeBytes ?? [])]);
  const reward = stakeBytes ? rewardAddressFor(network, stakeCredential, stakeBytes) : null;
  return {
    address: encodeAddress(bytes),
    hex: bytesToHex(bytes),
    network,
    networkName: network === 1 ? 'Mainnet' : 'Testnet',
    type,
    kind: stakeBytes ? 'Base' : 'Enterprise',
    byteLength: bytes.length,
    payment: { credential: paymentCredential, hash: bytesToHex(paymentBytes) },
    stake: stakeBytes ? { credential: stakeCredential, hash: bytesToHex(stakeBytes) } : null,
    rewardAddress: reward ? reward.address : null,
    smartWalletShape: !!stakeBytes && paymentCredential === 'script',
  };
}
export function normalizeWalletAddress(raw) {
  const address=raw?.startsWith('addr')?raw:encodeAddress(hexToBytes(raw));
  decodeAddress(address); return address;
}
// BLAKE2b (RFC 7693), unkeyed, implemented with BigInt 64-bit words so the
// browser needs no dependency and no WebCrypto extension (SubtleCrypto has
// no BLAKE2b). Only what CIP-14 needs is exposed: a digest of 1–64 bytes.
const B2_IV=[0x6a09e667f3bcc908n,0xbb67ae8584caa73bn,0x3c6ef372fe94f82bn,0xa54ff53a5f1d36f1n,0x510e527fade682d1n,0x9b05688c2b3e6c1fn,0x1f83d9abfb41bd6bn,0x5be0cd19137e2179n];
const B2_SIGMA=[[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],[11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],[7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],[9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],[2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],[12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],[13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],[6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],[10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3]];
const B2_MASK=(1n<<64n)-1n;
const b2Rotr=(x,r)=>((x>>BigInt(r))|(x<<BigInt(64-r)))&B2_MASK;
export function blake2b(input, outLength=64) {
  if(!(input instanceof Uint8Array)) throw new Error('BLAKE2b input must be bytes.');
  if(!Number.isInteger(outLength)||outLength<1||outLength>64) throw new Error('BLAKE2b digest length must be between 1 and 64 bytes.');
  const h=[...B2_IV];
  h[0]^=0x01010000n^BigInt(outLength); // depth 1, fanout 1, no key
  const compress=(block, count, isLast)=>{
    const m=Array.from({length:16},(_,i)=>{
      let w=0n; for(let j=7;j>=0;j--) w=(w<<8n)|BigInt(block[i*8+j]); return w;
    });
    const v=[...h,...B2_IV];
    v[12]^=count&B2_MASK; v[13]^=(count>>64n)&B2_MASK;
    if(isLast) v[14]=~v[14]&B2_MASK;
    const G=(a,b,c,d,x,y)=>{v[a]=(v[a]+v[b]+x)&B2_MASK;v[d]=b2Rotr(v[d]^v[a],32);v[c]=(v[c]+v[d])&B2_MASK;v[b]=b2Rotr(v[b]^v[c],24);v[a]=(v[a]+v[b]+y)&B2_MASK;v[d]=b2Rotr(v[d]^v[a],16);v[c]=(v[c]+v[d])&B2_MASK;v[b]=b2Rotr(v[b]^v[c],63);};
    for(let round=0;round<12;round++){
      const s=B2_SIGMA[round];
      G(0,4,8,12,m[s[0]],m[s[1]]);G(1,5,9,13,m[s[2]],m[s[3]]);G(2,6,10,14,m[s[4]],m[s[5]]);G(3,7,11,15,m[s[6]],m[s[7]]);
      G(0,5,10,15,m[s[8]],m[s[9]]);G(1,6,11,12,m[s[10]],m[s[11]]);G(2,7,8,13,m[s[12]],m[s[13]]);G(3,4,9,14,m[s[14]],m[s[15]]);
    }
    for(let i=0;i<8;i++) h[i]^=v[i]^v[i+8];
  };
  let offset=0, count=0n;
  while(input.length-offset>128){const block=input.subarray(offset,offset+128);count+=128n;compress(block,count,false);offset+=128;}
  const lastBlock=new Uint8Array(128); lastBlock.set(input.subarray(offset));
  count+=BigInt(input.length-offset);
  compress(lastBlock,count,true);
  const out=new Uint8Array(64);
  for(let i=0;i<8;i++){let w=h[i];for(let j=0;j<8;j++){out[i*8+j]=Number(w&0xffn);w>>=8n;}}
  return out.slice(0,outLength);
}
// CIP-14 user-facing asset fingerprint: the Bech32 ('asset') encoding of
// the BLAKE2b-160 digest of policyId ‖ assetName (raw bytes, not hex text).
// Computed entirely locally from the two identifiers a builder already has —
// no lookup, and nothing about the asset beyond its identity is implied.
export function assetFingerprint(policyHex, assetNameHex) {
  if(typeof policyHex!=='string'||!/^[a-f0-9]{56}$/i.test(policyHex)) throw new Error('Policy ID must be 56 hexadecimal characters.');
  if(typeof assetNameHex!=='string'||!/^(?:[a-f0-9]{2}){0,32}$/i.test(assetNameHex)) throw new Error('Asset name must contain 0–32 bytes of even-length hexadecimal.');
  const bytes=new Uint8Array(28+assetNameHex.length/2);
  bytes.set(hexToBytes(policyHex.toLowerCase()),0);
  if(assetNameHex) bytes.set(hexToBytes(assetNameHex.toLowerCase()),28);
  return encodeBech32('asset', blake2b(bytes,20));
}
// CIP-67 asset-name labels as registered for CIP-68: the first four bytes
// of the asset name declare the token's role, and the remaining bytes are
// the shared token name both the reference and the user token carry.
export const CIP68_LABELS = Object.freeze({
  '000643b0': Object.freeze({label:100, role:'Reference token', detail:'Holds the CIP-68 metadata datum at a script address.'}),
  '000de140': Object.freeze({label:222, role:'User NFT', detail:'The user-facing non-fungible token.'}),
  '0014df10': Object.freeze({label:333, role:'User fungible token', detail:'The user-facing fungible token.'}),
  '001bc280': Object.freeze({label:444, role:'User rich fungible token', detail:'The user-facing rich fungible token.'}),
});
// Decode an asset name (hex, as explorers and Koios report it) locally:
// a registered CIP-67/CIP-68 label prefix when one is present, and the
// UTF-8 text of the remaining bytes when they are valid printable UTF-8.
// Bytes that are not printable UTF-8 are reported as such — the text is
// never guessed, lossy-decoded, or invented. Decoding a name says what
// its bytes claim; it does not prove CIP-68 metadata exists in a datum,
// and says nothing about authenticity, backing, or registry membership.
export function decodeAssetName(nameHex) {
  if(typeof nameHex!=='string'||!/^(?:[a-f0-9]{2}){0,32}$/i.test(nameHex)) throw new Error('Asset name must contain 0–32 bytes of even-length hexadecimal.');
  const hex=nameHex.toLowerCase();
  if(!hex) return {empty:true,byteLength:0,label:null,contentHex:'',text:'',textDecodable:true};
  const prefix=hex.slice(0,8);
  const label=CIP68_LABELS[prefix]??null;
  const contentHex=label?hex.slice(8):hex;
  let text=null;
  if(!contentHex) text='';
  else try{
    const decoded=new TextDecoder('utf-8',{fatal:true}).decode(hexToBytes(contentHex));
    if(![...decoded].some(ch=>{const c=ch.codePointAt(0);return c<0x20||c===0x7f;})) text=decoded;
  }catch{/* Not valid UTF-8: text stays null and the name is shown as hex only. */}
  return {empty:false,byteLength:hex.length/2,label: label?{...label,prefixHex:prefix}:null,contentHex,text,textDecodable:text!==null};
}
// CIP-68 pairing: a user token (label 222 / 333 / 444) and its reference
// token (label 100) are minted under the SAME policy and share the SAME
// name bytes after the label prefix — the reference token is the one locked
// at a script address holding the metadata datum. Pairing is therefore a
// pure name computation: swap the prefix, keep the content bytes exactly.
// From a reference token's name alone the user token's label cannot be
// known (any of 222 / 333 / 444 could have been minted), so all three
// candidates are returned rather than one guessed. Pairing says what the
// paired asset WOULD be named — it does not prove that token was minted,
// exists on chain, or holds any datum; existence is a lookup question.
const CIP68_PREFIX_BY_LABEL = Object.freeze(Object.fromEntries(
  Object.entries(CIP68_LABELS).map(([prefix, meta]) => [meta.label, prefix]),
));
export function cip68Pair(nameHex) {
  const decoded = decodeAssetName(nameHex);
  const hex = nameHex.toLowerCase();
  if (decoded.empty || !decoded.label) {
    return { nameHex: hex, kind: 'unlabeled', decoded, pairs: [] };
  }
  const isReference = decoded.label.label === 100;
  const pairLabels = isReference ? [222, 333, 444] : [100];
  const pairs = pairLabels.map(label => {
    const pairedHex = CIP68_PREFIX_BY_LABEL[label] + decoded.contentHex;
    const paired = decodeAssetName(pairedHex);
    return {
      label,
      role: paired.label.role,
      prefixHex: CIP68_PREFIX_BY_LABEL[label],
      nameHex: pairedHex,
      text: paired.text,
      textDecodable: paired.textDecodable,
    };
  });
  return { nameHex: hex, kind: isReference ? 'reference' : 'user', decoded, pairs };
}
// CIP-68 name construction — the inverse of decodeAssetName: build the
// exact asset-name hex for a chosen label and a human-readable name, so a
// builder designing a token pair works from the same bytes explorers will
// report instead of hand-assembling a prefix. The name is built entirely
// locally; nothing is minted. Construction is deliberately strict so that
// every name it returns decodes back to exactly the inputs (round-trip):
// the text must be printable (the decoder's own rule — no control
// characters), it must survive UTF-8 encoding exactly (a lone surrogate,
// which TextEncoder would silently replace, is refused), and the total
// name — 4 label bytes plus the text's UTF-8 bytes, or the text alone when
// unlabeled — must fit Cardano's 32-byte asset-name limit, counted in
// BYTES, not characters: a multibyte character costs its full UTF-8 length.
export function encodeAssetName(label, text) {
  if (label !== null && !Object.values(CIP68_LABELS).some(meta => meta.label === label)) {
    throw new Error('CIP-68 label must be 100, 222, 333, or 444 — or null for an unlabeled name.');
  }
  if (typeof text !== 'string') throw new Error('Asset name text must be a string.');
  if ([...text].some(ch => { const c = ch.codePointAt(0); return c < 0x20 || c === 0x7f; })) {
    throw new Error('Asset name text must be printable — control characters are not encoded.');
  }
  const textBytes = new TextEncoder().encode(text);
  let roundTrip;
  try { roundTrip = new TextDecoder('utf-8', { fatal: true }).decode(textBytes); } catch { roundTrip = null; }
  if (roundTrip !== text) throw new Error('Asset name text cannot be represented exactly as UTF-8.');
  const prefixHex = label === null ? '' : CIP68_PREFIX_BY_LABEL[label];
  const contentHex = bytesToHex(textBytes);
  const nameHex = prefixHex + contentHex;
  const byteLength = nameHex.length / 2;
  if (byteLength > 32) {
    throw new Error(`Asset name would be ${byteLength} bytes — Cardano asset names are limited to 32 bytes (${label === null ? 'the text alone' : `the label prefix takes 4, leaving ${32 - 4} for the text`}; this text is ${textBytes.length} UTF-8 bytes).`);
  }
  return {
    nameHex,
    byteLength,
    label: label === null ? null : { ...CIP68_LABELS[prefixHex], prefixHex },
    contentHex,
    text,
    textByteLength: textBytes.length,
    maxTextBytes: label === null ? 32 : 28,
  };
}
// Asset unit splitting: explorers, Koios asset lists, and wallet APIs
// commonly identify a native asset by its UNIT — the policy ID (28 bytes)
// and the asset name (0–32 bytes) concatenated as one hex string. Splitting
// is a pure byte-boundary operation: the first 28 bytes are always the
// policy, everything after is the name, and there is no other valid split.
// The split is strict so a malformed unit is refused rather than silently
// mis-split: a unit shorter than a policy ID cannot name an asset under any
// policy, and a name part over Cardano's 32-byte limit cannot be a real
// asset name — accepting either would invent an asset that cannot exist.
// The fingerprint returned is the CIP-14 fingerprint of the split parts,
// so a split unit can be checked against the asset1… identifier explorers
// show. Splitting identifies an asset; it does not prove the asset exists
// on chain, and implies nothing about authenticity, backing, or registry
// membership — existence is a lookup question, answered by the lookup above.
export function parseAssetUnit(unitHex) {
  if(typeof unitHex!=='string'||!/^(?:[a-f0-9]{2})+$/i.test(unitHex)) throw new Error('Asset unit must be non-empty even-length hexadecimal (a policy ID followed by an asset name).');
  const hex=unitHex.toLowerCase();
  const byteLength=hex.length/2;
  if(byteLength<28) throw new Error(`Asset unit is ${byteLength} bytes — shorter than a 28-byte policy ID, so it cannot be a policy ID plus an asset name.`);
  const nameByteLength=byteLength-28;
  if(nameByteLength>32) throw new Error(`Asset unit's name part would be ${nameByteLength} bytes — Cardano asset names are limited to 32 bytes, so this cannot be a real asset unit (a fingerprint, asset1…, is a hash and cannot be split back — enter the unit hex instead).`);
  const policyId=hex.slice(0,56);
  const assetNameHex=hex.slice(56);
  return {
    unitHex: hex,
    byteLength,
    policyId,
    policyByteLength: 28,
    assetNameHex,
    nameByteLength,
    fingerprint: assetFingerprint(policyId, assetNameHex),
    decoded: decodeAssetName(assetNameHex),
  };
}
// Asset unit construction — the inverse of parseAssetUnit: join a policy
// ID (exactly 28 bytes) and an asset name (0–32 bytes) into the single
// concatenated unit hex explorers, Koios asset lists, and wallet APIs use
// to identify a native asset. Built entirely locally; nothing is minted
// or looked up. Construction is strict so every built unit splits back to
// exactly its inputs (round-trip): a policy ID that is not exactly 28
// bytes cannot name the asset's policy under any reading, and a name over
// Cardano's 32-byte limit cannot be a real asset name — accepting either
// would produce a unit string for an asset that cannot exist, which is
// worse than refusing: a downstream reader would split it differently or
// reject it silently. Odd-length or non-hex input is refused rather than
// padded, because padding would change the bytes being identified.
export function buildAssetUnit(policyHex, assetNameHex) {
  if(typeof policyHex!=='string'||!/^[a-f0-9]{56}$/i.test(policyHex)) {
    const got=typeof policyHex==='string'&&/^(?:[a-f0-9]{2})*$/i.test(policyHex)?`${policyHex.length/2} bytes`:'not even-length hexadecimal';
    throw new Error(`Policy ID must be exactly 28 bytes (56 hexadecimal characters) — got ${got}.`);
  }
  if(typeof assetNameHex!=='string'||!/^(?:[a-f0-9]{2}){0,32}$/i.test(assetNameHex)) {
    const got=typeof assetNameHex==='string'&&/^(?:[a-f0-9]{2})+$/i.test(assetNameHex)?`${assetNameHex.length/2} bytes — over Cardano's 32-byte asset-name limit`:'not 0–32 bytes of even-length hexadecimal';
    throw new Error(`Asset name must contain 0–32 bytes of even-length hexadecimal — got ${got}.`);
  }
  const policyId=policyHex.toLowerCase();
  const nameHex=assetNameHex.toLowerCase();
  const unitHex=policyId+nameHex;
  return {
    unitHex,
    byteLength: unitHex.length/2,
    policyId,
    policyByteLength: 28,
    assetNameHex: nameHex,
    nameByteLength: nameHex.length/2,
    fingerprint: assetFingerprint(policyId, nameHex),
    decoded: decodeAssetName(nameHex),
  };
}
// ---------------------------------------------------------------------------
// Byron-era (bootstrap) addresses: the pre-Shelley address form, kept for
// backward compatibility (CIP-19). A Byron address is Base58 text carrying
// a CBOR object: an array of a tag-24 byte string — the payload — and a
// CRC32 of the payload bytes. The payload is itself CBOR: an array of the
// 28-byte address root, an attributes map, and an address type. The root
// is a double hash (SHA3-256, then Blake2b-224) of the spending data and
// attributes, so the key or script behind an address cannot be recovered
// from it — decoding reports the root, never the spending data itself.
// Attribute values are double-CBOR-encoded byte strings: key 1 is the
// encrypted derivation path legacy "random" wallets stored in the address
// (28 bytes of ChaCha20/Poly1305 ciphertext — reported as present, never
// decrypted: decryption needs the wallet's spending password, which PRISM
// never asks for), and key 2 is a CBOR uint32 network discriminant,
// present only on test networks (Byron mainnet addresses carry none).
// Byron predates staking entirely: no stake credential, no delegation,
// and no reward address exists for this form.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function decodeBase58(text) {
  for (const ch of text) if (!BASE58_ALPHABET.includes(ch)) throw new Error(`Byron addresses are Base58 — the character "${ch}" is not in the Base58 alphabet.`);
  let zeros = 0; while (zeros < text.length && text[zeros] === '1') zeros++;
  const rest = text.slice(zeros);
  if (!rest) return new Uint8Array(zeros);
  const bytes = [0];
  for (const ch of rest) {
    let carry = BASE58_ALPHABET.indexOf(ch);
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}
// CRC32 (IEEE 802.3, reflected, polynomial 0xEDB88320) — the checksum a
// Byron address carries over its payload bytes. Exported so tests can pin
// it against reference implementations independently of the inspector.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('CRC32 input must be bytes.');
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// A minimal, strict CBOR reader covering only the types a Byron address
// can contain (unsigned integers, byte strings, arrays, maps, tag 24).
// Parsing is canonical-form strict — shortest-form arguments, definite
// lengths only — so an address decodes to exactly one structure or none:
// a second byte form of the same address is refused rather than silently
// accepted, and callers additionally require exact end-of-input.
function readCborArgument(bytes, offset, ai) {
  if (ai < 24) return { value: BigInt(ai), next: offset };
  const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[ai];
  if (!width) throw new Error('Byron address CBOR uses an indefinite length or a reserved form, which canonical CBOR never does.');
  if (offset + width > bytes.length) throw new Error('Byron address CBOR is truncated.');
  let value = 0n; for (let i = 0; i < width; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
  if (value < { 1: 24n, 2: 256n, 4: 65536n, 8: 4294967296n }[width]) throw new Error('Byron address CBOR is not in canonical (shortest) form.');
  return { value, next: offset + width };
}
function readCborItem(bytes, offset, depth = 0) {
  if (depth > 4) throw new Error('Byron address CBOR is nested too deeply.');
  if (offset >= bytes.length) throw new Error('Byron address CBOR is truncated.');
  const first = bytes[offset], major = first >>> 5, ai = first & 31;
  if (major === 0) {
    const r = readCborArgument(bytes, offset + 1, ai);
    if (r.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Byron address CBOR integer is too large to read exactly.');
    return { kind: 'uint', value: Number(r.value), next: r.next };
  }
  if (major === 2) {
    const r = readCborArgument(bytes, offset + 1, ai);
    if (r.value > BigInt(bytes.length)) throw new Error('Byron address CBOR is truncated.');
    const length = Number(r.value);
    if (r.next + length > bytes.length) throw new Error('Byron address CBOR is truncated.');
    return { kind: 'bytes', value: bytes.slice(r.next, r.next + length), next: r.next + length };
  }
  if (major === 4 || major === 5) {
    const r = readCborArgument(bytes, offset + 1, ai);
    if (r.value > BigInt(bytes.length)) throw new Error('Byron address CBOR is truncated.');
    const count = Number(r.value);
    let o = r.next;
    if (major === 4) {
      const items = [];
      for (let i = 0; i < count; i++) { const item = readCborItem(bytes, o, depth + 1); items.push(item); o = item.next; }
      return { kind: 'array', items, next: o };
    }
    const entries = [];
    for (let i = 0; i < count; i++) {
      const key = readCborItem(bytes, o, depth + 1);
      const value = readCborItem(bytes, key.next, depth + 1);
      entries.push([key, value]); o = value.next;
    }
    return { kind: 'map', entries, next: o };
  }
  if (major === 6) {
    const r = readCborArgument(bytes, offset + 1, ai);
    const item = readCborItem(bytes, r.next, depth + 1);
    return { kind: 'tag', tag: Number(r.value), item, next: item.next };
  }
  throw new Error('Byron address CBOR contains a type a Byron address never uses.');
}
const BYRON_ADDRESS_TYPES = Object.freeze({ 0: 'Public key', 1: 'Script', 2: 'Redemption key' });
// Decode a Byron (bootstrap) address locally: Base58, strict canonical
// CBOR, and the payload's CRC32 verified before anything in the payload
// is read — a corrupted address fails its checksum, it is never partially
// decoded. Anchored externally on the cardano-wallet design document's
// two byte-by-byte worked examples (a Yoroi mainnet address and a
// Daedalus testnet address), the Byron example in CIP-19's own table, and
// the SLIP-0023 vectors: every one decodes to its published root, type,
// attributes, and stored CRC32.
export function inspectByronAddress(raw) {
  if (typeof raw !== 'string' || raw.length < 30 || raw.length > 200) throw new Error('Enter a Byron (bootstrap) address — Base58 text of roughly 60–115 characters.');
  const bytes = decodeBase58(raw);
  const outer = readCborItem(bytes, 0);
  if (outer.kind !== 'array' || outer.items.length !== 2 || outer.next !== bytes.length) throw new Error('A Byron address is a CBOR array of exactly two items: the tagged payload and its CRC32.');
  const [tagged, crcItem] = outer.items;
  if (tagged.kind !== 'tag' || tagged.tag !== 24 || tagged.item.kind !== 'bytes') throw new Error('A Byron address payload is a CBOR tag-24 byte string.');
  if (crcItem.kind !== 'uint') throw new Error('A Byron address ends with its CRC32 as a CBOR unsigned integer.');
  const payload = tagged.item.value;
  const checksum = crc32(payload);
  if (checksum !== crcItem.value) throw new Error('Byron address checksum failed: the stored CRC32 does not match the payload bytes, so the address was copied incorrectly or is not a Byron address.');
  const inner = readCborItem(payload, 0);
  if (inner.kind !== 'array' || inner.items.length !== 3 || inner.next !== payload.length) throw new Error('A Byron address payload is a CBOR array of exactly three items: root, attributes, and type.');
  const [rootItem, attributesItem, typeItem] = inner.items;
  if (rootItem.kind !== 'bytes' || rootItem.value.length !== 28) throw new Error(`Byron address root must be exactly 28 bytes — got ${rootItem.kind === 'bytes' ? `${rootItem.value.length} bytes` : 'a non-byte-string'}.`);
  if (attributesItem.kind !== 'map') throw new Error('Byron address attributes must be a CBOR map.');
  if (typeItem.kind !== 'uint' || !(typeItem.value in BYRON_ADDRESS_TYPES)) throw new Error(`Unknown Byron address type ${typeItem.kind === 'uint' ? typeItem.value : '(not a number)'} — Byron types are 0 (public key), 1 (script), and 2 (redemption key).`);
  let derivationPathCiphertext = null, networkDiscriminant = null;
  const unknownAttributes = [], seen = new Set();
  for (const [keyItem, valueItem] of attributesItem.entries) {
    if (keyItem.kind !== 'uint' || valueItem.kind !== 'bytes') throw new Error('Byron address attributes map unsigned-integer keys to byte strings.');
    if (seen.has(keyItem.value)) throw new Error(`Byron address attribute ${keyItem.value} appears twice — a canonical attribute map has one value per key.`);
    seen.add(keyItem.value);
    if (keyItem.value === 1) {
      const innerAttr = readCborItem(valueItem.value, 0);
      if (innerAttr.kind !== 'bytes' || innerAttr.next !== valueItem.value.length) throw new Error('The derivation-path attribute is not a CBOR byte string.');
      if (innerAttr.value.length !== 28) throw new Error(`The encrypted derivation path must be 28 bytes — got ${innerAttr.value.length}.`);
      derivationPathCiphertext = bytesToHex(innerAttr.value);
    } else if (keyItem.value === 2) {
      const innerAttr = readCborItem(valueItem.value, 0);
      if (innerAttr.kind !== 'uint' || innerAttr.next !== valueItem.value.length) throw new Error('The network attribute is not a CBOR unsigned integer.');
      networkDiscriminant = innerAttr.value;
    } else unknownAttributes.push(keyItem.value);
  }
  return {
    address: raw,
    era: 'Byron',
    root: bytesToHex(rootItem.value),
    type: typeItem.value,
    typeName: BYRON_ADDRESS_TYPES[typeItem.value],
    networkDiscriminant,
    networkName: networkDiscriminant === null ? 'Mainnet' : 'Test network',
    hasDerivationPath: derivationPathCiphertext !== null,
    derivationPathCiphertext,
    unknownAttributes,
    checksum,
    checksumHex: checksum.toString(16).padStart(8, '0'),
    payloadByteLength: payload.length,
    byteLength: bytes.length,
  };
}
// Base58 encoding — the inverse of decodeBase58 above: leading zero
// bytes become leading '1' characters, the rest is converted as one
// big number from base 256 to base 58.
function encodeBase58(bytes) {
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  if (bytes.length === zeros) return '1'.repeat(zeros);
  return '1'.repeat(zeros) + digits.reverse().map((d) => BASE58_ALPHABET[d]).join('');
}
// A minimal canonical CBOR writer covering only the types a Byron
// address can contain (unsigned integers, byte strings, arrays, maps,
// tag 24). Every argument is written in its shortest form — the exact
// form the strict reader above accepts — so a built address always
// decodes, and decodes to exactly the values it was built from.
function cborHead(major, value) {
  if (value < 24) return Uint8Array.from([(major << 5) | value]);
  if (value < 256) return Uint8Array.from([(major << 5) | 24, value]);
  if (value < 65536) return Uint8Array.from([(major << 5) | 25, (value >>> 8) & 255, value & 255]);
  if (value < 4294967296) return Uint8Array.from([(major << 5) | 26, (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
  const out = new Uint8Array(9); out[0] = (major << 5) | 27;
  let v = BigInt(value); for (let i = 8; i >= 1; i--) { out[i] = Number(v & 255n); v >>= 8n; }
  return out;
}
const cborUint = (value) => cborHead(0, value);
const cborBytes = (bytes) => Uint8Array.from([...cborHead(2, bytes.length), ...bytes]);
const cborConcat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
function byronBytes(label, hashHex) {
  if (typeof hashHex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(hashHex)) {
    const got = typeof hashHex === 'string' && /^(?:[a-f0-9]{2})*$/i.test(hashHex) && hashHex ? `${hashHex.length / 2} bytes` : 'not even-length hexadecimal';
    throw new Error(`${label} must be exactly 28 bytes (56 hexadecimal characters) — got ${got}.`);
  }
  if (hashHex.length !== 56) throw new Error(`${label} must be exactly 28 bytes (56 hexadecimal characters) — got ${hashHex.length / 2} bytes.`);
  return hexToBytes(hashHex.toLowerCase());
}
// Byron (bootstrap) address construction — the inverse of
// inspectByronAddress: assemble a Byron address entirely locally from
// its 28-byte root, its type, and its optional attributes (a network
// discriminant for test networks, and/or the encrypted derivation-path
// ciphertext a legacy random wallet stored). The payload — CBOR array
// of root, attributes map, and type — is written in canonical form,
// its CRC32 is appended exactly as the inspector verifies it, and the
// outer array (tag-24 payload, CRC32) is Base58-encoded. Attribute
// values are double-CBOR-encoded byte strings, as the inspector reads
// them: key 1 wraps the CBOR byte string of the 28-byte ciphertext,
// key 2 wraps the CBOR uint32 discriminant; keys are written in
// ascending order, the canonical map order. Construction is strict so
// every built address inspects back to exactly its inputs: a root or
// ciphertext that is not exactly 28 bytes is refused with its byte
// count, and a discriminant outside the CBOR uint32 range is refused
// rather than truncated. Building assembles the Base58 text from a
// root the caller supplies — it does NOT derive that root from any
// key or script (the root is a double hash, SHA3-256 then
// Blake2b-224, of the spending data), creates no wallet or key,
// recovers no spending data, and decrypts nothing: a derivation-path
// value supplied here is carried as the ciphertext it already is.
export function buildByronAddress(rootHex, type, networkDiscriminant = null, derivationPathHex = null) {
  const rootBytes = byronBytes('Byron address root', rootHex);
  if (![0, 1, 2].includes(type)) throw new Error('Byron address type must be 0 (public key), 1 (script), or 2 (redemption key).');
  if (networkDiscriminant !== null && (!Number.isInteger(networkDiscriminant) || networkDiscriminant < 0 || networkDiscriminant > 4294967295)) throw new Error('Network discriminant must be a CBOR uint32 (an integer from 0 to 4294967295), or no discriminant for mainnet.');
  const pathBytes = derivationPathHex === null ? null : byronBytes('Encrypted derivation path', derivationPathHex);
  const entries = [];
  if (pathBytes) entries.push(cborConcat(cborUint(1), cborBytes(cborBytes(pathBytes))));
  if (networkDiscriminant !== null) entries.push(cborConcat(cborUint(2), cborBytes(cborUint(networkDiscriminant))));
  const attributes = entries.length ? cborConcat(cborHead(5, entries.length), ...entries) : cborHead(5, 0);
  const payload = cborConcat(cborHead(4, 3), cborBytes(rootBytes), attributes, cborUint(type));
  const checksum = crc32(payload);
  const outer = cborConcat(cborHead(4, 2), cborHead(6, 24), cborBytes(payload), cborUint(checksum));
  return {
    address: encodeBase58(outer),
    era: 'Byron',
    root: bytesToHex(rootBytes),
    type,
    typeName: BYRON_ADDRESS_TYPES[type],
    networkDiscriminant,
    networkName: networkDiscriminant === null ? 'Mainnet' : 'Test network',
    hasDerivationPath: pathBytes !== null,
    derivationPathCiphertext: pathBytes ? bytesToHex(pathBytes) : null,
    unknownAttributes: [],
    checksum,
    checksumHex: checksum.toString(16).padStart(8, '0'),
    payloadByteLength: payload.length,
    byteLength: outer.length,
  };
}
export function deriveSmartWallet(ownerAddress, baseScriptHash, network) {
  if(!/^[0-9a-f]{56}$/i.test(baseScriptHash))throw new Error('Base script hash must be exactly 56 hexadecimal characters (28 bytes).');
  if(![0,1].includes(network))throw new Error('Unsupported network.');
  const owner=decodeAddress(ownerAddress);
  if(owner.network!==network)throw new Error('Owner address belongs to a different network. Use a testnet address for Preview or Preprod.');
  // CIP-113 recommends the original PAYMENT credential as the smart-wallet owner.
  const type=owner.paymentIsScript?3:1;
  return encodeAddress(Uint8Array.from([(type<<4)|network,...hexToBytes(baseScriptHash),...owner.payment]));
}
