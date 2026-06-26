# Wallet Setup Recovery

`npm run setup` now derives wallet keypairs from a deterministic seed.

## Recommended flow

1. Run `npm run setup`.
2. Approve writing `.dev-seed` on the first run.
3. Store the `.dev-seed` mnemonic somewhere safe.
4. Re-run `npm run setup` whenever you need the same test wallets again.

## Using your own seed

Pass a BIP-39 mnemonic directly:

```bash
npm run setup -- --seed="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
```

The script derives Stellar keys with SLIP-0010 on the path `m/44'/148'/index'`, where `index` maps to the wallet role order in `scripts/setup-wallets.ts`.

## Recovery

If you lose the generated `.env` output but still have `.dev-seed`, run:

```bash
npm run setup
```

If you backed up the mnemonic elsewhere, you can also recover with:

```bash
npm run setup -- --seed="your mnemonic here"
```

## Legacy seeds

Older `.dev-seed` files may contain non-mnemonic raw strings. Those are still supported so existing dev wallets remain reproducible, but they do not provide BIP-39 recovery semantics. Replace them with a mnemonic when practical.
