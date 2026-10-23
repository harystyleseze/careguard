/**
 * Caregiver-maintained insurance network lists (#1234).
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { CareRecipientsStore, DEFAULT_RECIPIENT_ID } from "../db.ts";
import { createInsuranceNetworkRouter } from "../insurance-network.ts";

let store: CareRecipientsStore;
let app: express.Express;

beforeEach(() => {
  store = new CareRecipientsStore(":memory:");
  app = express();
  app.use(express.json());
  app.use("/agent", createInsuranceNetworkRouter(store));
});

describe("insurance network store", () => {
  it("defaults to empty lists with the recipient's insurance as the plan", () => {
    expect(store.getInsuranceNetwork(DEFAULT_RECIPIENT_ID)).toMatchObject({
      plan: "Medicare Part D",
      pharmacies: [],
      providers: [],
      updatedAt: null,
    });
  });

  it("works for agent recipient ids that have no care_recipients row", () => {
    store.setInsuranceNetwork("rosa", { plan: "Plan A", pharmacies: [{ name: "CVS" }], providers: [] }, "maria");
    expect(store.getInsuranceNetwork("rosa")).toMatchObject({ plan: "Plan A", pharmacies: [{ name: "CVS" }], updatedBy: "maria" });
  });
});

describe("/agent/insurance-network", () => {
  it("lets the caregiver replace and read back the lists", async () => {
    const put = await request(app)
      .put("/agent/insurance-network?recipient_id=rosa")
      .send({
        plan: " Medicare Part D ",
        pharmacies: [{ id: "pharm-2", name: "Walgreens" }, { name: "CVS Pharmacy" }],
        providers: [{ name: "General Hospital" }],
        updated_by: "Maria Garcia",
      });
    expect(put.status).toBe(200);
    expect(put.body.network).toMatchObject({ plan: "Medicare Part D", updatedBy: "Maria Garcia" });

    const get = await request(app).get("/agent/insurance-network?recipient_id=rosa");
    expect(get.body.network.pharmacies).toEqual([{ id: "pharm-2", name: "Walgreens" }, { name: "CVS Pharmacy" }]);
    expect(get.body.network.providers).toEqual([{ name: "General Hospital" }]);
  });

  it("rejects entries without a name", async () => {
    const res = await request(app).put("/agent/insurance-network").send({ pharmacies: [{ id: "x", name: "" }] });
    expect(res.status).toBe(400);
  });
});
