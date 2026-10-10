# Integration handoff

PRISM is a static application. Its practical integration surfaces are the read-only wallet adapters, live data adapter, smart-wallet address tool, and portable design manifest. This document describes the remaining engineering work for actual asset issuance and private eligibility.

## CIP-113

The checked standard uses a registry, shared custody/dispatch infrastructure, and token-specific validation hooks. It describes a protocol-parameters UTxO so the shared base script can read the live dispatch credential. Action delegates perform validation; do not mistake the global dispatcher for the full transfer validator.

The smart-wallet utility creates `(programmableLogicBase script credential, original payment credential)` and uses the correct CIP-19 header for either key or script ownership. It supports Shelley base and enterprise addresses and rejects unsupported or mismatched network types. It does not determine whether a script exists, can be spent, or belongs to the selected protocol.

Before any mint or transfer implementation:

1. Pin the core validators, SDK, blueprint, and platform to compatible reviewed commits.
2. Resolve a deployed protocol on the selected test network and verify its protocol parameters, registry, and script identities against chain data.
3. Implement and test the chosen token-specific issuance / transfer / third-party / unfracking logic. A checkbox is not a validator.
4. Validate registry membership, input/output containment, owner authorization, exact supply, state references, and amount precision.
5. Build unsigned transactions and present an independently decoded review before an explicit wallet signing request. Recheck account and network immediately before signing and submission.
6. Add chain confirmation tracking, retries, indexer lag handling, error recovery, and relevant denial tests.

Use the Foundation’s [on-chain framework](https://github.com/cardano-foundation/cip113-programmable-tokens) and [platform](https://github.com/cardano-foundation/cip113-programmable-tokens-platform), including their contract provenance documentation. PRISM does not claim SDK compatibility for its design-file schema.

## RealFi

The official site checked on 2026-10-03 describes USDrf and sUSDrf as live on Cardano. PRISM links directly to the official app and provides an independent, hypothetical private-credit model.

The calculator uses `interest = principal × APR / 100 × months / 12` and `collateral ceiling = collateral × advance rate / 100`. It excludes compounding, fees, losses, valuation changes, defaults, and liquidation mechanics. The template button chooses a private-credit design without treating USD principal as a token-denominated balance or making an investment offer.

Any future product-specific integration needs published asset identifiers, documented contracts/APIs, network verification, current product terms, and explicit transactions. Do not infer that USDrf or sUSDrf uses this PRISM configuration or any particular CIP-113 substandard.

## Midnight

The implemented connector uses `window.midnight`, supports connector major version 4, invokes `connect(networkId)`, checks `getConnectionStatus()`, and reads `getUnshieldedAddress()`. PRISM does not request balances, private wallet data, signatures, proofs, or transaction submission.

The sandbox evaluates fictional numeric and Boolean inputs locally. It creates no cryptographic artifacts. A complete privacy integration would require:

- A compiled and deployed Compact circuit, key material, and reviewed witnesses.
- A credential/issuer model with holder and policy binding, expiry, revocation, and replay resistance.
- A real proving flow and a verifier for the exact intended statement.
- An explicit attestation or bridge boundary to Cardano. Cardano does not automatically verify Midnight results.
- A CIP-113 transfer hook that validates that boundary and rejects missing, expired, or untrusted evidence.

As of 2026-10-03, the official Midnight network documentation says mainnet node/indexer access moved to Blockfrost and needs a project token; Preview and Preprod remain separate networks. This frontend avoids embedding such credentials and relies on the wallet for its own connection. Consult the current docs before adding a backend.

## Registry indexers

The registry browser reads the Cardano Foundation’s hosted programmable-tokens indexers — one HTTPS origin per network in `NETWORKS` (`preview-`, `preprod-`, and `mainnet-indexer.programmabletokens.xyz`, the indexer family the platform’s own frontend uses; verified publicly reachable, with CORS open to the deployed frontend, on 2026-10-10). Each implements the platform’s `GET /api/v1/registry/protocols` and `GET /api/v1/registry/tokens` endpoints. Responses are parsed strictly in `parseRegistryProtocols` / `parseRegistryTokens` — every field validated, hex canonicalised, a malformed record refusing the whole response — and on Preview the listed deployment is cross-checked against the pinned reference (`registryReferenceCheck`): the pinned bootstrap transaction must be present with a programmable-logic hash equal to the pinned script hash. The tokens response carries each deployment’s registered token nodes (the origin node is not included); `registryChainCheck` verifies each group as a linked chain — keys strictly ascending, every `next` naming the following key, the last node terminating at the 30-byte 0xff sentinel — and cross-checks it against the protocols list (same registry node policy, same programmable-logic hash, indexed token count equal to the nodes listed), so the two endpoints must agree before a list is presented as verified. The indexers return indexed records for their own deployments, not a universal token census, and errors render as an explicit unavailable state, never as zero tokens. On-chain registry verification (reading the registry UTxOs themselves) requires additional work before transaction use.

## Launch limits

The shipped application never signs or submits a blockchain transaction. The correct release description is “CIP-113 design and research studio with real read-only wallet and data integrations.” Do not describe it as a mainnet minting platform, RealFi partner, compliance-certified asset, or deployed private credential bridge.
