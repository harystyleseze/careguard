import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { VitalsStore } from "../db.ts";
import { createVitalsRouter } from "../routes.ts";

function makeApp(store: VitalsStore) {
  const app = express();
  app.use(express.json());
  app.use("/agent", createVitalsRouter(store));
  return app;
}

describe("VitalsStore (#1237)", () => {
  let store: VitalsStore;
  beforeEach(() => {
    store = new VitalsStore(":memory:");
  });

  it("creates and lists vitals per recipient in time order", () => {
    store.create({ recipient_id: "rosa", type: "weight", value: 160, secondary_value: null, unit: "lb", timestamp: "2026-03-02T00:00:00.000Z" });
    store.create({ recipient_id: "rosa", type: "weight", value: 161, secondary_value: null, unit: "lb", timestamp: "2026-03-01T00:00:00.000Z" });
    store.create({ recipient_id: "other", type: "weight", value: 200, secondary_value: null, unit: "lb", timestamp: "2026-03-01T00:00:00.000Z" });
    const list = store.list("rosa");
    expect(list.map((v) => v.value)).toEqual([161, 160]);
  });

  it("filters by type and deletes only within the recipient", () => {
    const bp = store.create({ recipient_id: "rosa", type: "blood_pressure", value: 128, secondary_value: 82, unit: "mmHg", timestamp: "2026-03-01T00:00:00.000Z" });
    store.create({ recipient_id: "rosa", type: "glucose", value: 110, secondary_value: null, unit: "mg/dL", timestamp: "2026-03-01T00:00:00.000Z" });
    expect(store.list("rosa", "blood_pressure")).toEqual([bp]);
    expect(store.delete("other", bp.id)).toBe(false);
    expect(store.delete("rosa", bp.id)).toBe(true);
    expect(store.list("rosa", "blood_pressure")).toEqual([]);
  });
});

describe("vitals routes (#1237)", () => {
  let app: express.Express;
  beforeEach(() => {
    app = makeApp(new VitalsStore(":memory:"));
  });

  it("logs a reading with the type's default unit and returns it from GET", async () => {
    const created = await request(app)
      .post("/agent/vitals?recipient_id=rosa")
      .send({ type: "glucose", value: 105, timestamp: "2026-03-01T08:00:00.000Z" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: "glucose", value: 105, unit: "mg/dL", secondary_value: null, recipient_id: "rosa" });

    const list = await request(app).get("/agent/vitals?recipient_id=rosa");
    expect(list.status).toBe(200);
    expect(list.body.vitals).toHaveLength(1);
  });

  it("requires a diastolic reading for blood pressure", async () => {
    const res = await request(app).post("/agent/vitals").send({ type: "blood_pressure", value: 130 });
    expect(res.status).toBe(400);
    const ok = await request(app).post("/agent/vitals").send({ type: "blood_pressure", value: 130, secondary_value: 85 });
    expect(ok.status).toBe(201);
    expect(ok.body.unit).toBe("mmHg");
  });

  it("rejects unsupported types, units and non-positive values", async () => {
    expect((await request(app).post("/agent/vitals").send({ type: "temperature", value: 98 })).status).toBe(400);
    expect((await request(app).post("/agent/vitals").send({ type: "weight", value: 150, unit: "stone" })).status).toBe(400);
    expect((await request(app).post("/agent/vitals").send({ type: "weight", value: -1 })).status).toBe(400);
    expect((await request(app).get("/agent/vitals?type=temperature")).status).toBe(400);
  });

  it("deletes a reading and 404s on unknown ids", async () => {
    const created = await request(app).post("/agent/vitals").send({ type: "weight", value: 150 });
    expect((await request(app).delete(`/agent/vitals/${created.body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/agent/vitals/${created.body.id}`)).status).toBe(404);
  });
});
