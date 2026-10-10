export const CONFIG = Object.freeze({
  name: 'PRISM',
  creator: 'KShot',
  x: 'kshot9000',
  github: 'https://github.com/Kshot3000/Grok-CIP-113',
  site: 'https://kshot3000.github.io/Grok-CIP-113/',
  donation: 'addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v',
  verified: '2026-10-04',
  cip: 'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0113',
  core: 'https://github.com/cardano-foundation/cip113-programmable-tokens',
  platform: 'https://github.com/cardano-foundation/cip113-programmable-tokens-platform',
  midnight: 'https://docs.midnight.network/',
  realfi: 'https://realfi.co/',
  realfiApp: 'https://app.realfi.co/',
  // Registry browsing uses the per-network Foundation indexers in NETWORKS
  // below (read-only, no credentials — this file never carries any).
});

export const NETWORKS = Object.freeze({
  preview: { name: 'Preview', id: 0, koios: 'https://preview.koios.rest/api/v1', explorer: 'https://preview.cardanoscan.io', midnight: 'preview', registryApi: 'https://preview-indexer.programmabletokens.xyz' },
  preprod: { name: 'Preprod', id: 0, koios: 'https://preprod.koios.rest/api/v1', explorer: 'https://preprod.cardanoscan.io', midnight: 'preprod', registryApi: 'https://preprod-indexer.programmabletokens.xyz' },
  mainnet: { name: 'Mainnet', id: 1, koios: 'https://api.koios.rest/api/v1', explorer: 'https://cardanoscan.io', midnight: 'mainnet', registryApi: 'https://mainnet-indexer.programmabletokens.xyz' },
});

export const PREVIEW_REFERENCE = Object.freeze({
  observed: '2026-10-03', network: 'preview', schemaVersion: 3,
  source: `${CONFIG.platform}/blob/main/src/programmable-tokens-offchain-java/src/main/resources/protocol-bootstraps-preview.json`,
  raw: 'https://raw.githubusercontent.com/cardano-foundation/cip113-programmable-tokens-platform/main/src/programmable-tokens-offchain-java/src/main/resources/protocol-bootstraps-preview.json',
  txHash: '8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9',
  scriptHash: '35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16',
  protocolPolicy: '1d2026310c70f07ac25e39d591055723f5f8a84ac0de229eb0525720',
});

export const CIP113_SPEC_VERSION = Object.freeze({
  observed: '2026-10-10', network: 'preview', section: 'CIP-113 Version',
  source: `${CONFIG.cip}`,
  txHash: '61fae36e28a62a65496907c9660da9cf5d27fa0e9054a04581e1d8a087fbd93e',
});

export const TEMPLATES = [
  { id:'rwa', name:'Real-world asset', short:'RWA', icon:'building', description:'Ownership with clear boundaries', tokenName:'Prism Real Asset', ticker:'PRA', decimals:6, supply:'1000000', limit:'10000', allowlist:true, limitEnabled:true, pausable:true, identity:true, substandard:'kyc-extended', accent:'mint' },
  { id:'credit', name:'Private credit', short:'CREDIT', icon:'chart', description:'Rules for a lending lifecycle', tokenName:'Prism Credit', ticker:'PCR', decimals:6, supply:'500000', limit:'25000', allowlist:true, limitEnabled:true, pausable:true, identity:true, substandard:'kyc', accent:'blue' },
  { id:'stable', name:'Stablecoin concept', short:'STABLE', icon:'coins', description:'Model issuer-managed transfers', tokenName:'Prism Dollar Concept', ticker:'PDC', decimals:6, supply:'1000000', limit:'50000', allowlist:true, limitEnabled:true, pausable:true, identity:false, substandard:'freeze-seize', accent:'amber' },
  { id:'community', name:'Community access', short:'ACCESS', icon:'users', description:'Membership, made programmable', tokenName:'Prism Community', ticker:'PASS', decimals:0, supply:'10000', limit:'1', allowlist:false, limitEnabled:true, pausable:false, identity:false, substandard:'generic', accent:'purple' },
  { id:'carbon', name:'Carbon credit', short:'CARBON', icon:'leaf', description:'One credit, one verified tonne', tokenName:'Prism Carbon Credit', ticker:'PCC', decimals:0, supply:'250000', limit:'10000', allowlist:true, limitEnabled:true, pausable:true, identity:true, substandard:'kyc', accent:'teal' },
  { id:'ticket', name:'Event ticket', short:'TICKET', icon:'ticket', description:'Resale caps that fight scalping', tokenName:'Prism Event Ticket', ticker:'PTIX', decimals:0, supply:'5000', limit:'4', allowlist:false, limitEnabled:true, pausable:true, identity:false, substandard:'generic', accent:'rose' },
];

export const SOURCES = [
  { name:'CIP-113 specification', label:'CARDANO FOUNDATION', description:'Registry, smart wallets, transfer hooks, and the withdraw-zero pattern. Current frontmatter: Proposed.', href:CONFIG.cip, icon:'layers' },
  { name:'Core Aiken validators', label:'REFERENCE IMPLEMENTATION', description:'The on-chain framework and architecture documentation. Reference code requires independent review.', href:CONFIG.core, icon:'code' },
  { name:'Programmable Tokens Platform', label:'CARDANO FOUNDATION', description:'Off-chain services, testnet frontend, and KYC, freeze-and-seize, and RWA modules.', href:CONFIG.platform, icon:'box' },
  { name:'Midnight DApp Connector', label:'MIDNIGHT', description:'The wallet API used here for network-aware, read-only connections. PRISM supports API major version 4.', href:'https://github.com/midnightntwrk/midnight-dapp-connector-api', icon:'moon' },
  { name:'RealFi', label:'REAL-WORLD FINANCE', description:'Official USDrf and sUSDrf product information and app. Independent from PRISM.', href:CONFIG.realfi, icon:'chart' },
  { name:'CIP-30 wallet bridge', label:'CARDANO STANDARD', description:'Browser wallet permissions, addresses, network IDs, and account-change handling.', href:'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0030', icon:'wallet' },
  { name:'CIP-19 address format', label:'CARDANO STANDARD', description:'Binary headers, credentials, and Bech32 encoding behind the smart-wallet derivation utility.', href:'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0019', icon:'fingerprint' },
  { name:'CIP-14 asset fingerprint', label:'CARDANO STANDARD', description:'The user-facing asset identifier: a Blake2b-160 digest of policy ID and asset name, Bech32-encoded. PRISM computes it locally in the Network explorer and cross-checks the live Koios response against it.', href:'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0014', icon:'fingerprint' },
  { name:'Koios public API', label:'NETWORK DATA', description:'Read-only chain tip and asset information, with explicit failure and freshness states.', href:'https://api.koios.rest/', icon:'globe' },
  { name:'CIP-113 registry indexers', label:'CARDANO FOUNDATION', description:'The Foundation’s hosted programmable-tokens indexers (programmabletokens.xyz — one per network) behind the registry browser: read-only deployment records, cross-checked on Preview against the pinned reference deployment. An indexer’s view of its own deployment, not a universal token census. Reference implementation is R&D, not production-ready, audit pending.', href:CONFIG.platform, icon:'layers' },
];
