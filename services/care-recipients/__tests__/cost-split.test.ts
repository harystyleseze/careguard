import { describe, it, expect, beforeEach } from "vitest";
import { CareRecipientsStore, createCareRecipientsStore } from "../db.ts";
import { computeContributorBalances, validateCostSplitShares } from "../../../shared/cost-split.ts";
import express from "express";
import request from "supertest";
import { createCareRecipientsRouter } from "../routes.ts";

describe("Issue #1220: Caregiver Cost Splitting Ledger & Running Balances", () => {
  let store: CareRecipientsStore;
  let app: express.Express;
  const adminToken = "admin-secret-token";

  beforeEach(() => {
    store = new CareRecipientsStore(":memory:");
    app = express();
    app.use(express.json());
    app.use(createCareRecipientsRouter(store, adminToken));
  });

  describe("Pure Balance Netting Algorithm (shared/cost-split.ts)", () => {
    it("validates split shares sum matches total", () => {
      const valid = validateCostSplitShares(100, [
        { caregiverId: "c1", caregiverName: "Caregiver 1", amount: 60, status: "settled" },
        { caregiverId: "c2", caregiverName: "Caregiver 2", amount: 40, status: "owed" },
      ]);
      expect(valid.valid).toBe(true);

      const invalid = validateCostSplitShares(100, [
        { caregiverId: "c1", caregiverName: "Caregiver 1", amount: 50, status: "settled" },
        { caregiverId: "c2", caregiverName: "Caregiver 2", amount: 30, status: "owed" },
      ]);
      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
      expect(invalid.difference).toBe(20);
    });

    it("correctly computes pairwise net running balances between contributors", () => {
      // Split 1: Alice paid $100 total. Bob owes $40, Charlie owes $20.
      // Split 2: Bob paid $50 total. Alice owes $25.
      const splits = [
        {
          id: "s1",
          transactionId: "tx-1",
          recipientId: "rosa",
          totalAmount: 100,
          payerId: "alice",
          payerName: "Alice",
          shares: [
            { caregiverId: "alice", caregiverName: "Alice", amount: 40, status: "settled" as const },
            { caregiverId: "bob", caregiverName: "Bob", amount: 40, status: "owed" as const },
            { caregiverId: "charlie", caregiverName: "Charlie", amount: 20, status: "owed" as const },
          ],
          createdAt: new Date().toISOString(),
        },
        {
          id: "s2",
          transactionId: "tx-2",
          recipientId: "rosa",
          totalAmount: 50,
          payerId: "bob",
          payerName: "Bob",
          shares: [
            { caregiverId: "bob", caregiverName: "Bob", amount: 25, status: "settled" as const },
            { caregiverId: "alice", caregiverName: "Alice", amount: 25, status: "owed" as const },
          ],
          createdAt: new Date().toISOString(),
        },
      ];

      const summary = computeContributorBalances(splits);
      // Net between Alice & Bob: Bob owed Alice 40, Alice owed Bob 25 -> Net: Bob owes Alice 15.
      // Charlie owes Alice 20.
      expect(summary.totalOwed).toBe(85); // 40 + 20 + 25
      expect(summary.totalSettled).toBe(65); // 40 + 25

      const bobOwesAlice = summary.balances.find(
        (b) => b.fromCaregiverId === "bob" && b.toCaregiverId === "alice"
      );
      expect(bobOwesAlice).toBeDefined();
      expect(bobOwesAlice?.amount).toBe(15);

      const charlieOwesAlice = summary.balances.find(
        (b) => b.fromCaregiverId === "charlie" && b.toCaregiverId === "alice"
      );
      expect(charlieOwesAlice).toBeDefined();
      expect(charlieOwesAlice?.amount).toBe(20);
    });
  });

  describe("Store Persistence & Settlement (services/care-recipients/db.ts)", () => {
    it("creates, retrieves, and lists cost splits", () => {
      const split = store.createCostSplit({
        recipientId: "rosa",
        transactionId: "tx-med-123",
        totalAmount: 45.5,
        payerId: "cg-1",
        payerName: "Caregiver One",
        description: "Metformin 500mg - Walgreens",
        shares: [
          { caregiverId: "cg-1", caregiverName: "Caregiver One", amount: 25.5, status: "settled" },
          { caregiverId: "cg-2", caregiverName: "Caregiver Two", amount: 20.0, status: "owed" },
        ],
      });

      expect(split.id).toBeDefined();
      expect(split.totalAmount).toBe(45.5);
      expect(split.shares).toHaveLength(2);

      const list = store.listCostSplits("rosa");
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(split.id);

      const byTx = store.getCostSplitByTx("tx-med-123");
      expect(byTx?.id).toBe(split.id);
    });

    it("settles a contributor share and marks paid back", () => {
      const split = store.createCostSplit({
        recipientId: "rosa",
        transactionId: "tx-bill-999",
        totalAmount: 80.0,
        payerId: "cg-1",
        payerName: "Caregiver One",
        shares: [
          { caregiverId: "cg-1", caregiverName: "Caregiver One", amount: 40.0, status: "settled" },
          { caregiverId: "cg-2", caregiverName: "Caregiver Two", amount: 40.0, status: "owed" },
        ],
      });

      // Before settlement: cg-2 owes cg-1 $40
      let balances = store.getContributorBalances("rosa");
      expect(balances.totalOwed).toBe(40.0);
      expect(balances.balances[0].amount).toBe(40.0);

      // Settle cg-2
      const updated = store.settleCostSplitShare(split.id, "cg-2", "Caregiver One");
      const cg2Share = updated.shares.find((s) => s.caregiverId === "cg-2");
      expect(cg2Share?.status).toBe("settled");
      expect(cg2Share?.settledAt).toBeDefined();
      expect(cg2Share?.settledBy).toBe("Caregiver One");

      // After settlement: 0 owed
      balances = store.getContributorBalances("rosa");
      expect(balances.totalOwed).toBe(0);
      expect(balances.totalSettled).toBe(80.0);
      expect(balances.balances).toHaveLength(0);
    });
  });

  describe("HTTP Routes (services/care-recipients/routes.ts)", () => {
    it("supports GET /recipients/:id/cost-splits, POST /recipients/:id/cost-splits, and settle", async () => {
      // 1. Create a split via POST
      const postRes = await request(app)
        .post("/recipients/rosa_garcia/cost-splits")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          transactionId: "http-tx-100",
          totalAmount: 60.0,
          payerId: "p1",
          payerName: "Primary Payer",
          description: "Lab Work Co-pay",
          shares: [
            { caregiverId: "p1", caregiverName: "Primary Payer", amount: 30.0, status: "settled" },
            { caregiverId: "p2", caregiverName: "Secondary Contributor", amount: 30.0, status: "owed" },
          ],
        });

      expect(postRes.status).toBe(201);
      const createdSplit = postRes.body;
      expect(createdSplit.id).toBeDefined();

      // 2. Fetch splits
      const getRes = await request(app)
        .get("/recipients/rosa_garcia/cost-splits")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.splits).toHaveLength(1);

      // 3. Fetch balances
      const balRes = await request(app)
        .get("/recipients/rosa_garcia/cost-splits/balances")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(balRes.status).toBe(200);
      expect(balRes.body.summary.totalOwed).toBe(30.0);
      expect(balRes.body.summary.balances[0].fromCaregiverId).toBe("p2");

      // 4. Settle share
      const settleRes = await request(app)
        .post(`/recipients/rosa_garcia/cost-splits/${createdSplit.id}/settle`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contributorId: "p2" });
      expect(settleRes.status).toBe(200);
      expect(settleRes.body.shares.find((s: any) => s.caregiverId === "p2").status).toBe("settled");
    });
  });
});
