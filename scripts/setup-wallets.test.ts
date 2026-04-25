import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks for Stellar SDK and fetch ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  loadAccount: vi.fn(),
  submitTransaction: vi.fn().mockResolvedValue({ successful: true }),
  keypairCounter: { value: 0 },
}));

vi.mock('@stellar/stellar-sdk', () => {
  const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  return {
    Keypair: {
      random: vi.fn().mockImplementation(() => {
        const n = mocks.keypairCounter.value++;
        return {
          publicKey: () => `GPUBLIC${n}TESTKEY1234567890123456789`,
          secret: () => `SSECRET${n}TESTKEY1234567890123456789`,
        };
      }),
      fromSecret: vi.fn().mockImplementation((secret: string) => ({
        publicKey: () => `GPUBLIC_FROM_${secret.slice(7, 8)}TEST123456789012345678901`,
      })),
    },
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ sign: vi.fn() }),
    })),
    Operation: {
      changeTrust: vi.fn().mockReturnValue({ type: 'changeTrust' }),
    },
    Asset: vi.fn().mockImplementation((code: string, issuer: string) => ({ code, issuer })),
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        loadAccount: mocks.loadAccount,
        submitTransaction: mocks.submitTransaction,
      })),
    },
    // Re-export USDC_ISSUER so it's accessible from the mock scope
    _USDC_ISSUER: USDC_ISSUER,
  };
});

import { fundAccount, addUsdcTrustline, main, generateKeypair } from './setup-wallets.ts';
import { Keypair, Operation } from '@stellar/stellar-sdk';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ─── fundAccount ─────────────────────────────────────────────────────────────

describe('fundAccount', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('Friendbot success → resolves without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }));
    await expect(fundAccount('GPUBLIC_TEST_1234567890123456789012')).resolves.toBeUndefined();
  });

  it('account already exists (createAccountAlreadyExist) → resolves (not an error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'op_already_exists createAccountAlreadyExist',
    }));
    await expect(fundAccount('GPUBLIC_TEST_1234567890123456789012')).resolves.toBeUndefined();
  });

  it('unrelated Friendbot error → rejects with clear message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'internal server error',
    }));
    await expect(fundAccount('GPUBLIC_TEST_1234567890123456789012')).rejects.toThrow('Friendbot failed');
  });
});

// ─── addUsdcTrustline ────────────────────────────────────────────────────────

describe('addUsdcTrustline', () => {
  const keypair = { publicKey: () => 'GPUBLIC_TEST_1234567890123456789012' } as any;

  it('trustline already exists → no transaction submitted', async () => {
    mocks.loadAccount.mockResolvedValueOnce({
      balances: [{ asset_code: 'USDC', asset_issuer: USDC_ISSUER }],
    });
    mocks.submitTransaction.mockClear();

    await addUsdcTrustline(keypair);

    expect(mocks.submitTransaction).not.toHaveBeenCalled();
  });

  it('trustline missing → tx built with ChangeTrust operation, signed, submitted', async () => {
    mocks.loadAccount.mockResolvedValueOnce({ balances: [] });
    mocks.submitTransaction.mockClear();
    (Operation.changeTrust as any).mockClear?.();

    await addUsdcTrustline(keypair);

    expect(Operation.changeTrust).toHaveBeenCalledWith(
      expect.objectContaining({ asset: expect.objectContaining({ code: 'USDC', issuer: USDC_ISSUER }) })
    );
    expect(mocks.submitTransaction).toHaveBeenCalledTimes(1);
  });
});

// ─── main ────────────────────────────────────────────────────────────────────

describe('main()', () => {
  beforeEach(() => {
    mocks.keypairCounter.value = 0;
    (Keypair.random as any).mockClear?.();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }));
    mocks.loadAccount.mockResolvedValue({
      balances: [{ asset_code: 'USDC', asset_issuer: USDC_ISSUER }],
    });
  });

  it('creates exactly 6 keypairs', async () => {
    await main();
    expect(Keypair.random).toHaveBeenCalledTimes(6);
  });

  it('does NOT log secret keys at ERROR level', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await main();
    const allErrorOutput = errorSpy.mock.calls.flat().join(' ');
    expect(allErrorOutput).not.toMatch(/SECRET/);
    expect(allErrorOutput).not.toMatch(/SSECRET/);
    errorSpy.mockRestore();
  });

  it('logs secret keys only to console.log (stdout), not console.error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await main();

    const logOutput = logSpy.mock.calls.flat().join(' ');
    const errorOutput = errorSpy.mock.calls.flat().join(' ');

    // Secret keys appear in stdout
    expect(logOutput).toMatch(/SECRET_KEY=/);
    // Secret keys never appear in stderr
    expect(errorOutput).not.toMatch(/SECRET_KEY=/);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('handles fundAccount failure gracefully (logs error, continues)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'network error',
    }));
    mocks.loadAccount.mockResolvedValue({
      balances: [{ asset_code: 'USDC', asset_issuer: USDC_ISSUER }],
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).resolves.toBeUndefined(); // main() doesn't throw
    expect(errorSpy.mock.calls.some(c => c.join('').includes('Failed to fund'))).toBe(true);
    errorSpy.mockRestore();
  });

  it('handles addUsdcTrustline failure gracefully (logs error, continues)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }));
    mocks.loadAccount.mockRejectedValue(new Error('Horizon unreachable'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).resolves.toBeUndefined();
    expect(errorSpy.mock.calls.some(c => c.join('').includes('Failed trustline'))).toBe(true);
    errorSpy.mockRestore();
  });
});

// ─── generateKeypair ─────────────────────────────────────────────────────────

describe('generateKeypair', () => {
  it('returns object with publicKey and secretKey strings', () => {
    const kp = generateKeypair();
    expect(kp).toHaveProperty('publicKey');
    expect(kp).toHaveProperty('secretKey');
    expect(typeof kp.publicKey).toBe('string');
    expect(typeof kp.secretKey).toBe('string');
  });
});
