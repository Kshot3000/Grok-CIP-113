// CIP-113 learning path + status tracker data.
// Every claim below is paraphrased from the official CIP-113 specification
// (cardano-foundation/CIPs, CIP-0113) and the CIP-0001 process document.
// Re-check the upstream spec before changing status or criteria copy:
// the acceptance checklist is reproduced verbatim from the spec's own
// "Path to Active" section, including its unchecked boxes.

export const SPEC_URL = 'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0113';
export const PROCESS_URL = 'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0001';

// Status snapshot. `checked` is the date this snapshot was last verified
// against the upstream spec frontmatter — update it only after re-reading
// the spec, never by assumption.
export const CIP113_STATUS = Object.freeze({
  status: 'Proposed',
  checked: '2026-10-10',
  merged: '2026-09-29',
  specVersion: '3.0',
  category: 'Tokens',
  authors: ['Michele Nuzzi', 'Matteo Coppola', 'Philip DiSarro', 'Giovanni Gargiulo'],
  solves: 'CPS-0003',
});

// The spec's own "Path to Active" acceptance criteria (verbatim labels).
// `specChecked` mirrors the checkbox state in the spec itself; as of the
// last check every box is unchecked, which is exactly what "Proposed"
// means. `note` is PRISM's grounded context — it must never claim a
// criterion is met while the spec leaves it unchecked.
export const ACCEPTANCE_CRITERIA = Object.freeze([
  {
    id: 'issuance-preview',
    label: 'Issuance of at least one programmable token on Preview testnet',
    specChecked: false,
    note: 'Shared infrastructure is bootstrapped on Preview — PRISM’s Network explorer loads the schema-3 reference transaction from the Foundation platform. The Foundation platform targets Preview, but the spec’s own box remains unchecked.',
  },
  {
    id: 'issuance-mainnet',
    label: 'Issuance of at least one programmable token on Mainnet',
    specChecked: false,
    note: 'No mainnet issuance is claimed anywhere upstream. The Foundation reference platform describes itself as R&D, not production-ready, with an independent audit pending. Treat this as not met.',
  },
  {
    id: 'e2e-tests',
    label: 'End-to-end tests of programmable token logic',
    specChecked: false,
    note: 'Reference validators and off-chain code exist upstream and are where this evidence will come from. Only the CIP authors/editors can check this box, via a status-change pull request.',
  },
  {
    id: 'wallet-adoption',
    label: 'A widely adopted wallet that displays programmable-token balances and supports transfers',
    specChecked: false,
    note: 'No widely adopted wallet publicly advertises CIP-113 balance display or transfers yet. PRISM implements only the spec’s address-derivation format, read-only, in the Network explorer.',
  },
]);

// The spec's "Implementation Plan" — workstreams, not acceptance gates.
export const IMPLEMENTATION_PLAN = Object.freeze([
  {
    id: 'contracts',
    label: 'Implement the contracts detailed in the specification',
    state: 'Reference exists upstream',
    note: 'The Cardano Foundation core repository holds the reference Aiken validators for the registry, base script, and delegates. Reference code still requires independent review before production use.',
  },
  {
    id: 'offchain',
    label: 'Implement the off-chain code to query balances and construct transfer transactions',
    state: 'Reference exists upstream',
    note: 'The Foundation platform provides the off-chain code, and its hosted indexers — one per network at programmabletokens.xyz — are publicly reachable: PRISM’s registry browser reads deployments, registered tokens, the full registry walk, protocol parameter versions, and the substandard module catalogue from them live. Building and submitting transactions still runs on a self-hosted backend; PRISM reads only, and constructs, signs, and submits nothing.',
  },
]);

// Plain-language lessons, in reading order. Each lesson names the spec
// section it paraphrases so a reader can verify it in minutes.
export const LEARNING_PATH = Object.freeze([
  {
    id: 'why',
    title: 'Why programmable tokens exist',
    plain: 'A normal Cardano token, once minted, can move between any addresses with no rules attached. That is a problem if the law — or the product — says otherwise: a regulated stablecoin issuer must be able to freeze accounts, a security must only reach eligible holders, and a membership pass should not be freely resalable. CIP-113 defines tokens that only change owner when a script says yes.',
    detail: 'The standard needs no hard fork. It is built from primitives Cardano already has: native tokens, stake credentials, and the withdraw-zero pattern.',
    specSection: 'Motivation',
  },
  {
    id: 'smart-wallet',
    title: 'One shared vault address, many owners',
    plain: 'Every programmable token lives at the same payment address — the hash of one shared “base” script, identical for everyone. What makes a balance yours is the stake credential attached to it: your smart-wallet address is that fixed payment credential plus your own stake credential. Ownership is proven by the credential, not by holding a special account.',
    detail: 'Because the address is derived deterministically from your own payment or stake credential, any wallet can compute your smart-wallet address independently — no registration step, which earlier drafts required and the community rejected.',
    specSection: 'User’s smart wallet address derivation',
  },
  {
    id: 'withdraw-zero',
    title: 'The withdraw-zero trick',
    plain: 'To move a programmable token, the transaction must invoke the protocol’s global stake validator with a withdrawal of exactly zero lovelace. That sounds like a no-op, but invoking it is what forces the real checks to run. The base script itself does almost nothing else — it runs once per programmable-token input, so keeping it minimal keeps transfers cheap.',
    detail: 'The actual validation lives in separate “action delegate” withdraw-zero scripts — one each for transfers, third-party actions, and unfracking — which read the live protocol parameters, so the framework can be upgraded without moving anyone’s tokens.',
    specSection: 'Layer 2: Standard Components',
  },
  {
    id: 'registry',
    title: 'The registry: a phone book for token rules',
    plain: 'Before a wallet can enforce a token’s rules, it has to find them. The registry is an on-chain sorted linked list with one entry per programmable token, ordered by policy ID. Each entry is a UTxO holding the hashes of that token’s logic scripts. A transfer carries a proof that the policy is in the registry (so its rules must run) — or that it is not, in which case the asset is treated as an ordinary native token and can always leave.',
    detail: 'Entries are marked by a unique NFT minted under the registry policy, and the registry validator cryptographically binds each entry’s minting-logic field to the registering transaction, so an entry cannot lie about which logic governs its token.',
    specSection: 'Layer 1: Registry Components',
  },
  {
    id: 'substandards',
    title: 'Substandards: the rule books',
    plain: 'The shared framework only routes a transfer — the rules themselves live in a “substandard”: the token-specific set of withdraw-zero scripts for transfers, third-party actions, and issuance. Every programmable token must belong to a substandard, because that is how wallets and apps know how to interact with it. Freeze-and-seize, KYC, and KYC-extended are substandards published with the Foundation’s reference platform.',
    detail: 'PRISM’s Token studio models those three substandards locally, check by check — a design exercise only. Nothing is deployed, and no on-chain list, certificate, or allowlist is read.',
    specSection: 'Layer 3: Substandard Components',
  },
  {
    id: 'actions',
    title: 'More than transfers: third-party actions and unfracking',
    plain: 'Two other actions complete the model. Third-party actions let someone other than the holder act on a token — seizure by an authorised issuer, forced transfers, or auto-compounding — but only as the token’s substandard allows. “Unfracking” is the holder reorganising their own UTxOs without changing ownership, for example separating programmable tokens from ordinary ones; the default is least-permission — an empty credential in the registry entry forbids it.',
    detail: 'Each action has its own delegate and its own redeemer carrying the indices and registry proofs that action needs, validated by the delegate itself.',
    specSection: 'Transfer',
  },
  {
    id: 'upgradability',
    title: 'Upgrading the rules without moving anyone’s tokens',
    plain: 'A deployment is not frozen at launch. The credentials that wire it together — the global logic, the protocol-level issuance logic, and the three action delegates — are held as data in a protocol parameters record and read live every time a transaction is validated, so the upgrade authority can re-point any of them and the new wiring applies to every programmable token at once, from the very next transaction.',
    detail: 'Two things can never move. The base credential is the payment credential of every smart-wallet address, so changing it would relocate every holder’s funds — a different base is a different deployment, identified by its own bootstrap transaction. And each token’s own minting policy is permanent, which is what lets a token’s identity survive an upgrade of the logic governing it. Changing the upgrade authority itself is deliberately two-phase: first a nomination, then a separate promotion that the nominee must authorise — the evidence the incoming authority exists, can act, and consents. A wiring change may not smuggle in an authority change, and every upgrade must declare which kind it is. The standard does not say what the authority is — a single key, a multisig, or a governance script all satisfy it — so judging a deployment means reading who its authority is in the protocol parameters, not assuming. PRISM’s Network explorer reads a deployment’s protocol parameter version history live from the Foundation indexer — which version stands, and the transaction and slot that deployed it — while its upgrade planner, checker, and comparison model a parameters record locally: no record’s wiring credentials are read, and no upgrade is constructed or applied.',
    specSection: 'Protocol upgradability',
  },
  {
    id: 'defi',
    title: 'Programmable tokens in DeFi and wallets',
    plain: 'Programmable tokens are ordinary native tokens that happen to live at the shared base address, so existing DeFi can use them — with extra steps. A DEX swap must run the token’s transfer logic through the withdraw-zero pattern and carry its registry entry as a reference input, and liquidity tokens must be paid to the user’s smart-wallet address. A lending protocol holds collateral at a smart wallet it controls, and its liquidations need registry proofs like any other transfer.',
    detail: 'The step protocols most easily miss is checking the substandard before accepting a token: a freeze-and-seize token lets an authorised third party move it without the holder’s consent, which changes what it is worth as collateral. Wallets face the mirror-image task — deriving each user’s smart-wallet address and reading balances there, because that is where the tokens live. PRISM’s RealFi lab models the lending maths locally; it is not connected to any DEX, lending protocol, or wallet, and no integration is deployed.',
    specSection: 'Implementing programmable tokens in DeFi protocols',
  },
  {
    id: 'wallets',
    title: 'What a wallet must do differently',
    plain: 'A wallet that supports programmable tokens has three duties in the spec. It must display the holder’s programmable-token balances — which means querying the UTxOs at the user’s smart-wallet address, not their ordinary address — and it must track the transfers in and out of that address as the transaction history. Building native TransferAct transfers is the third item, and the spec marks it optional: nice-to-have, not a requirement. Issuance and third-party operations such as minting, burning, freezing, and seizing are not the wallet’s job at all — token-specific dApps handle them. And before treating any token as programmable, the wallet checks whether its policy ID appears as a key in the registry, decoding the registry entries’ datums to see which policies are registered; a policy with no registry entry is an ordinary native token.',
    detail: 'Each substandard may manage user state differently — no state at all, one state per user involved in the spending (queried by an NFT, as when a sender must provide a reference input carrying their allowlist NFT), or one state per user involved in the transfer itself (sender and receiver both providing reference inputs proving KYC status). Where a substandard’s third-party logic requires signatures from a designated key set, that key set is the substandard’s admin — a property of that substandard, not of CIP-113: third-party logic may instead be permissionless, or restricted to actions that cannot reduce a holder’s balance. So an integrator must determine a token’s third-party capabilities, and who can trigger them, from its substandard — never from CIP-113 conformance alone. PRISM’s own wallet tools stay read-only within this picture: they derive the smart-wallet address and summarise a connected wallet’s addresses, and they build, sign, and submit nothing.',
    specSection: 'Implementing programmable tokens in wallets and dApps',
  },
]);

export function criteriaProgress(criteria = ACCEPTANCE_CRITERIA) {
  const met = criteria.filter(c => c.specChecked).length;
  return { met, total: criteria.length };
}
