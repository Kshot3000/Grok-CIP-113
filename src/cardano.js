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
export function encodeAddress(bytes) {
  const hrp=(bytes[0]&15)===1?'addr':'addr_test';
  const data=convert(bytes,8,5,true),p=polymod([...expand(hrp),...data,0,0,0,0,0,0])^1;
  const sum=Array.from({length:6},(_,i)=>(p>>>(5*(5-i)))&31);
  return `${hrp}1${[...data,...sum].map(v=>CHARSET[v]).join('')}`;
}
export function hexToBytes(hex) {
  if(typeof hex!=='string'||!/^([a-f0-9]{2})+$/i.test(hex))throw new Error('Invalid hexadecimal data.');
  return Uint8Array.from(hex.match(/../g),b=>parseInt(b,16));
}
export function decodeAddress(address) {
  if(typeof address!=='string'||address.length>200)throw new Error('Enter a Shelley payment address.');
  if(address!==address.toLowerCase()&&address!==address.toUpperCase())throw new Error('Mixed-case Bech32 address.');
  const s=address.toLowerCase(),split=s.lastIndexOf('1'),hrp=s.slice(0,split);
  if(!['addr','addr_test'].includes(hrp)||s.length-split<7)throw new Error('Enter a Cardano addr or addr_test payment address.');
  const data=[...s.slice(split+1)].map(c=>CHARSET.indexOf(c));
  if(data.some(v=>v<0)||polymod([...expand(hrp),...data])!==1)throw new Error('Address checksum is invalid.');
  const bytes=Uint8Array.from(convert(data.slice(0,-6),5,8,false)),type=bytes[0]>>>4,network=bytes[0]&15;
  if(![0,1].includes(network)||(network===1)!==(hrp==='addr'))throw new Error('Address network prefix does not match its header.');
  if(![0,1,2,3,6,7].includes(type)||bytes.length!==(type<4?57:29))throw new Error('Use a Shelley base or enterprise address; Byron, pointer, and reward addresses are not supported.');
  return {bytes,type,network,payment:bytes.slice(1,29),paymentIsScript:[1,3,7].includes(type)};
}
export function normalizeWalletAddress(raw) {
  const address=raw?.startsWith('addr')?raw:encodeAddress(hexToBytes(raw));
  decodeAddress(address); return address;
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
