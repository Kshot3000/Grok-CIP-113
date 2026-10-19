import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelVaultShareDeposit } from '../src/domain.js';

// Vault share deposit model (v1.274): a deposit into a share-based
// vault mints shares floored on the pre-deposit price; the minted
// shares can be worth less than the deposit at that price, and the
// difference stays in the vault for the existing holders.
const DEFAULT = { totalAssets: '1000000', decimals: 6, totalShares: '800000', deposit: '250000' };

test('the preloaded deposit: 250000 into a vault holding 1000000 with 800000 shares mints 200000 shares at the pre-deposit price', () => {
  const r = modelVaultShareDeposit(DEFAULT);
  assert.equal(r.sharesMinted, 200000000000n);
  assert.equal(r.mintedValue, 250000000000n);
  assert.equal(r.mintingDust, 0n);
  assert.equal(r.noDust, true);
  assert.equal(r.totalAssetsAfter, 1250000000000n);
  assert.equal(r.totalSharesAfter, 1000000000000n);
  assert.equal(r.depositorShareBpsText, '2000.00');
  assert.equal(r.existingShareBpsText, '8000.00');
  assert.equal(r.depositShareBpsText, '2500.00');
});

test('identities hold across vault states, deposits, and decimals', () => {
  const cases = [
    { totalAssets: '5000', decimals: 6, totalShares: '4000', deposit: '1000' },
    { totalAssets: '250', decimals: 2, totalShares: '250', deposit: '250' },
    { totalAssets: '777', decimals: 0, totalShares: '333', deposit: '123' },
    { totalAssets: '0', decimals: 6, totalShares: '0', deposit: '0' },
    { totalAssets: '42', decimals: 6, totalShares: '100000', deposit: '99999' },
  ];
  for (const c of cases) {
    const r = modelVaultShareDeposit(c);
    assert.equal(r.totalAssetsAfter, r.totalAssets + r.deposit);
    assert.equal(r.totalSharesAfter, r.totalShares + r.sharesMinted);
    assert.equal(r.mintedValue + r.mintingDust, r.deposit);
    assert.ok(r.mintedValue <= r.deposit);
  }
});

test('the first deposit into an empty vault mints one share per base unit and sets the starting price', () => {
  const r = modelVaultShareDeposit({ totalAssets: '0', decimals: 6, totalShares: '0', deposit: '500' });
  assert.equal(r.firstDeposit, true);
  assert.equal(r.sharesMinted, 500000000n);
  assert.equal(r.mintedValue, 500000000n);
  assert.equal(r.mintingDust, 0n);
  assert.equal(r.depositorShareBpsText, '10000.00');
  assert.equal(r.existingShareBpsText, '0.00');
});

test('shares are minted floored on the pre-deposit price, never rounded up', () => {
  const r = modelVaultShareDeposit({ totalAssets: '11', decimals: 6, totalShares: '7', deposit: '3' });
  assert.equal(r.sharesMinted, 1909090n);
  assert.equal(r.mintedValue, 2999998n);
  assert.equal(r.mintingDust, 2n);
  assert.equal(r.mintFloors, true);
});

test('the minting dust stays in the vault: the minted shares are worth less than the deposit at the old price', () => {
  const r = modelVaultShareDeposit({ totalAssets: '11', decimals: 6, totalShares: '7', deposit: '3' });
  assert.equal(r.mintedValue + r.mintingDust, r.deposit);
  assert.equal(r.totalAssetsAfter, 14000000n);
  assert.equal(r.totalSharesAfter, 8909090n);
});

test('shares are derived from the amounts, not from any holder count', () => {
  const r = modelVaultShareDeposit({ totalAssets: '11', decimals: 6, totalShares: '7', deposit: '3' });
  assert.equal(r.depositorShareBpsText, '2142.85');
  assert.equal(r.existingShareBpsText, '7857.14');
  assert.equal(r.depositShareBpsText, '2727.27');
});

test('a deposit that divides exactly at the pre-deposit price loses no dust', () => {
  const r = modelVaultShareDeposit({ totalAssets: '1000', decimals: 0, totalShares: '500', deposit: '250' });
  assert.equal(r.sharesMinted, 125n);
  assert.equal(r.mintedValue, 250n);
  assert.equal(r.mintingDust, 0n);
  assert.equal(r.noDust, true);
  assert.equal(r.depositorShareBpsText, '2000.00');
});

test('a deposit too small for one share mints nothing and would be a gift to the existing holders', () => {
  const r = modelVaultShareDeposit({ totalAssets: '1000000', decimals: 0, totalShares: '800000', deposit: '1' });
  assert.equal(r.sharesMinted, 0n);
  assert.equal(r.mintsNothing, true);
  assert.equal(r.mintedValue, 0n);
  assert.equal(r.mintingDust, 1n);
  assert.equal(r.depositorShareBpsText, '0.00');
  assert.equal(r.existingShareBpsText, '10000.00');
});

test('a zero deposit mints nothing and changes nothing, and is not a mints-nothing deposit', () => {
  const r = modelVaultShareDeposit({ ...DEFAULT, deposit: '0' });
  assert.equal(r.noDeposit, true);
  assert.equal(r.mintsNothing, false);
  assert.equal(r.sharesMinted, 0n);
  assert.equal(r.totalAssetsAfter, r.totalAssets);
  assert.equal(r.totalSharesAfter, r.totalShares);
  assert.equal(r.depositorShareBpsText, '0.00');
  assert.equal(r.existingShareBpsText, '10000.00');
});

test('a vault holding assets but no shares is refused: there is no price to mint against', () => {
  assert.throws(() => modelVaultShareDeposit({ totalAssets: '100', decimals: 6, totalShares: '0', deposit: '10' }), /holding assets but no shares/);
});

test('a vault with shares outstanding but no assets is refused: its shares claim nothing', () => {
  assert.throws(() => modelVaultShareDeposit({ totalAssets: '0', decimals: 6, totalShares: '100', deposit: '10' }), /shares outstanding but no assets/);
});

test('an appreciated vault mints fewer shares per unit than a vault at par', () => {
  const par = modelVaultShareDeposit({ totalAssets: '1000', decimals: 0, totalShares: '1000', deposit: '100' });
  const appreciated = modelVaultShareDeposit({ totalAssets: '2000', decimals: 0, totalShares: '1000', deposit: '100' });
  assert.equal(par.sharesMinted, 100n);
  assert.equal(appreciated.sharesMinted, 50n);
  assert.equal(appreciated.mintedValue, 100n);
  assert.equal(appreciated.depositorShareBpsText, '476.19');
});

test('a depreciated vault mints more shares per unit, and the depositor buys the existing loss, not a gain', () => {
  const r = modelVaultShareDeposit({ totalAssets: '500', decimals: 0, totalShares: '1000', deposit: '100' });
  assert.equal(r.sharesMinted, 200n);
  assert.equal(r.mintedValue, 100n);
  assert.equal(r.totalAssetsAfter, 600n);
  assert.equal(r.totalSharesAfter, 1200n);
  assert.equal(r.depositorShareBpsText, '1666.66');
});

test('the existing holders are diluted by exactly the shares minted, no more', () => {
  const r = modelVaultShareDeposit(DEFAULT);
  assert.equal(r.totalSharesAfter - r.totalShares, r.sharesMinted);
  assert.equal(r.existingShareBpsText, '8000.00');
});

test('the deposit never mints a claim worth more than the deposit at the pre-deposit price', () => {
  const cases = [
    { totalAssets: '999', decimals: 0, totalShares: '1', deposit: '999' },
    { totalAssets: '3', decimals: 6, totalShares: '11', deposit: '7' },
    { totalAssets: '123456', decimals: 2, totalShares: '654321', deposit: '11111' },
  ];
  for (const c of cases) {
    const r = modelVaultShareDeposit(c);
    assert.ok(r.mintedValue <= r.deposit);
    assert.ok(r.sharesMinted * r.totalAssets <= r.deposit * r.totalShares);
  }
});

test('bad amounts are refused by the amount parser', () => {
  assert.throws(() => modelVaultShareDeposit({ ...DEFAULT, deposit: '-1' }), /positive decimal amount/);
  assert.throws(() => modelVaultShareDeposit({ ...DEFAULT, totalAssets: '1,000' }), /positive decimal amount/);
});

test('wiring: app.js imports the model, renders a vault share deposit panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelVaultShareDeposit/);
  assert.match(app, /data-vaultd/);
  assert.match(app, /vaultd-output/);
  assert.match(app, /v1\.274/);
  assert.match(readme, /Vault share deposit model/);
});
