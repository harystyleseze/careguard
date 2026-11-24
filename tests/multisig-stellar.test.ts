import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

vi.mock("mppx/client", () => ({
  Mppx: class {
    payment = () => ({});
  },
}));

vi.mock("@stellar/mpp/charge/client", () => ({
  stellar: () => ({}),
}));

vi.mock("../agent/mpp-client.ts", () => ({
  createMppClient: () => ({
    fetch: vi.fn(),
    lastTxHash: "mock-tx-hash",
  }),
}));

import {
  loadMultisigConfig,
  saveMultisigConfig,
  loadMultisigRequests,
  createMultisigRequest,
  signAndSubmitMultisigRequest,
  rejectMultisigRequest,
  isMultisigRequired,
  buildMultisigAccountOptionsOperation,
} from "../shared/multisig.ts";
import { readAuditLog } from "../shared/audit-log.ts";
import { payForMedication, payBill } from "../agent/tools.ts";

const RECIPIENT_ID = "test-multisig-recipient";

describe("Issue #1226: Multi-Signature Stellar Wallets for Shared Financial Control", () => {
  const coSignerKeypair = Keypair.random();
  const coSignerPublicKey = coSignerKeypair.publicKey();
  const coSignerSecret = coSignerKeypair.secret();

  beforeEach(() => {
    // Save fresh multi-sig config
    saveMultisigConfig(
      {
        recipientId: RECIPIENT_ID,
        enabled: true,
        thresholdAmount: 100, // payments > $100 require co-signer
        coSigners: [coSignerPublicKey],
        timeWindowHours: 48,
      },
      RECIPIENT_ID,
    );
  });

  it("loads and persists multi-sig configuration", () => {
    const config = loadMultisigConfig(RECIPIENT_ID);
    expect(config.enabled).toBe(true);
    expect(config.thresholdAmount).toBe(100);
    expect(config.coSigners).toContain(coSignerPublicKey);
    expect(config.timeWindowHours).toBe(48);
  });

  it("accurately detects when multi-sig is required vs single-signer", () => {
    // Below threshold -> no multi-sig required
    expect(isMultisigRequired(50, RECIPIENT_ID)).toBe(false);
    expect(isMultisigRequired(100, RECIPIENT_ID)).toBe(false);

    // Above threshold -> multi-sig required
    expect(isMultisigRequired(100.01, RECIPIENT_ID)).toBe(true);
    expect(isMultisigRequired(250, RECIPIENT_ID)).toBe(true);

    // Disabled multi-sig -> gracefully falls back to single-signer behavior
    saveMultisigConfig(
      {
        recipientId: RECIPIENT_ID,
        enabled: false,
        thresholdAmount: 100,
        coSigners: [coSignerPublicKey],
        timeWindowHours: 48,
      },
      RECIPIENT_ID,
    );
    expect(isMultisigRequired(500, RECIPIENT_ID)).toBe(false);
  });

  it("creates a pending multi-sig request with a partially-signed transaction envelope XDR", async () => {
    const request = await createMultisigRequest({
      recipientId: RECIPIENT_ID,
      type: "medication",
      amount: 150,
      description: "Atorvastatin 90-day supply",
      destinationWallet: Keypair.random().publicKey(),
      asset: "USDC",
    });

    expect(request.id).toMatch(/^msig-/);
    expect(request.status).toBe("pending");
    expect(request.requiredSignatures).toBe(2);
    expect(request.collectedSignatures.length).toBe(1); // Agent keypair signed
    expect(request.envelopeXdr).toBeDefined();
    expect(request.envelopeXdr.length).toBeGreaterThan(10);
    expect(new Date(request.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Verify stored
    const pending = loadMultisigRequests(RECIPIENT_ID);
    expect(pending.some((r) => r.id === request.id)).toBe(true);
  });

  it("allows co-caregiver to authorize and sign with secondary Stellar secret key", async () => {
    const request = await createMultisigRequest({
      recipientId: RECIPIENT_ID,
      type: "bill",
      amount: 220,
      description: "Emergency room facility copay",
      destinationWallet: Keypair.random().publicKey(),
      asset: "USDC",
    });

    const result = await signAndSubmitMultisigRequest(request.id, coSignerSecret, RECIPIENT_ID);

    expect(result.success).toBe(true);
    expect(result.request.status).toBe("completed");
    expect(result.request.collectedSignatures.length).toBe(2);
    expect(result.request.collectedSignatures).toContain(coSignerPublicKey);
    expect(result.txHash).toBeDefined();

    // Verify audit log
    const logs = readAuditLog();
    const signLog = logs.find(
      (l) => l.event === "multisig.payment_completed" && l.details?.requestId === request.id,
    );
    expect(signLog).toBeDefined();
  });

  it("allows co-caregiver to reject pending multi-sig transaction", async () => {
    const request = await createMultisigRequest({
      recipientId: RECIPIENT_ID,
      type: "medication",
      amount: 175,
      description: "Brand name medication inquiry",
      destinationWallet: Keypair.random().publicKey(),
    });

    const result = rejectMultisigRequest(request.id, "Incorrect dosage requested", RECIPIENT_ID);

    expect(result.success).toBe(true);
    expect(result.request.status).toBe("rejected");
    expect(result.request.rejectionReason).toBe("Incorrect dosage requested");

    const logs = readAuditLog();
    const rejectLog = logs.find(
      (l) => l.event === "multisig.payment_rejected" && l.details?.requestId === request.id,
    );
    expect(rejectLog).toBeDefined();
  });

  it("integrates into agent payForMedication tool when exceeding threshold", async () => {
    // Calling payForMedication with amount $180 (above $100 threshold)
    const res = await payForMedication("Atorvastatin", 180, "ExpressScripts", RECIPIENT_ID);

    expect(res.multisigPending).toBe(true);
    expect(res.requestId).toBeDefined();
    expect(res.requiredSignatures).toBe(2);
    expect(res.status).toBe("pending_cosignature");
    expect(res.message).toMatch(/exceeds threshold/i);
  });

  it("integrates into agent payBill tool when exceeding threshold", async () => {
    // Calling payBill with amount $250 (above $100 threshold)
    const res = await payBill(
      Keypair.random().publicKey(),
      250,
      "Memorial Hospital Lab Panel",
      RECIPIENT_ID,
    );

    expect(res.multisigPending).toBe(true);
    expect(res.requestId).toBeDefined();
    expect(res.status).toBe("pending_cosignature");
  });

  it("constructs native Stellar SetOptions operation for account multisig thresholds and signers", () => {
    const newSigner = Keypair.random().publicKey();
    const op = buildMultisigAccountOptionsOperation({
      coSignerPublicKey: newSigner,
      weight: 1,
      threshold: 2,
      masterWeight: 1,
    });

    expect(op).toBeDefined();
    // Verify it is an Operation that can be included in a TransactionBuilder
    const sourceKp = Keypair.random();
    const { Account, TransactionBuilder, Networks } = require("@stellar/stellar-sdk");
    const account = new Account(sourceKp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    expect(tx.operations.length).toBe(1);
    expect(tx.toXDR().length).toBeGreaterThan(100);
  });

  it("deserializes partially-signed envelope XDR, appends second signature, and produces 64-char hex Stellar tx hash", async () => {
    const request = await createMultisigRequest({
      recipientId: RECIPIENT_ID,
      type: "bill",
      amount: 300,
      description: "Specialist consultation fee",
      destinationWallet: Keypair.random().publicKey(),
      asset: "USDC",
    });

    expect(request.envelopeXdr).toBeDefined();

    const result = await signAndSubmitMultisigRequest(request.id, coSignerSecret, RECIPIENT_ID);
    expect(result.success).toBe(true);
    expect(result.request?.status).toBe("completed");
    expect(result.request?.envelopeXdr).toBeDefined();
    // Verify 64-char hex hash from stellarTx.hash()
    expect(result.stellarTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.txHash).toBe(result.stellarTxHash);
  });
});

