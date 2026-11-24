import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { CareRecipientsStore } from "../db.ts";
import { createCareRecipientsRouter } from "../routes.ts";

/** Shared caregiver task checklist (Issue #1200), against a real in-memory store. */

const TOKEN = "test-caregiver-token";
const auth = { Authorization: `Bearer ${TOKEN}` };

describe("/recipients/:id/tasks (Issue #1200)", () => {
  let app: express.Express;

  beforeEach(() => {
    const store = new CareRecipientsStore(":memory:"); // seeds rosa_garcia
    app = express();
    app.use(express.json());
    app.use(createCareRecipientsRouter(store, TOKEN));
  });

  it("requires the caregiver token", async () => {
    expect((await request(app).get("/recipients/rosa_garcia/tasks")).status).toBe(401);
  });

  it("creates a task assigned to a linked caregiver and lists it", async () => {
    const created = await request(app)
      .post("/recipients/rosa_garcia/tasks")
      .set(auth)
      .send({ title: "  Call insurance  ", assignee: "David Garcia", due_date: "2026-11-01" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      recipient_id: "rosa_garcia",
      title: "Call insurance",
      assignee: "David Garcia",
      due_date: "2026-11-01",
      done: false,
      completed_at: null,
    });

    const list = await request(app).get("/recipients/rosa_garcia/tasks").set(auth);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it("completing a task keeps it (history) and it can be reopened", async () => {
    const { body: task } = await request(app)
      .post("/recipients/rosa_garcia/tasks")
      .set(auth)
      .send({ title: "Arrange transport" });

    const done = await request(app)
      .patch(`/recipients/rosa_garcia/tasks/${task.id}`)
      .set(auth)
      .send({ done: true });
    expect(done.status).toBe(200);
    expect(done.body.done).toBe(true);
    expect(done.body.completed_at).toEqual(expect.any(String));

    const list = await request(app).get("/recipients/rosa_garcia/tasks").set(auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].done).toBe(true);

    const reopened = await request(app)
      .patch(`/recipients/rosa_garcia/tasks/${task.id}`)
      .set(auth)
      .send({ done: false });
    expect(reopened.body).toMatchObject({ done: false, completed_at: null });
  });

  it("lists open tasks by due date before completed ones", async () => {
    const add = (title: string, due_date?: string) =>
      request(app).post("/recipients/rosa_garcia/tasks").set(auth).send({ title, due_date });
    const { body: finished } = await add("Finished", "2026-01-01");
    await add("No date");
    await add("Later", "2026-12-01");
    await add("Sooner", "2026-10-01");
    await request(app).patch(`/recipients/rosa_garcia/tasks/${finished.id}`).set(auth).send({ done: true });

    const { body } = await request(app).get("/recipients/rosa_garcia/tasks").set(auth);
    expect(body.map((t: { title: string }) => t.title)).toEqual(["Sooner", "Later", "No date", "Finished"]);
  });

  it("validates input and unknown ids", async () => {
    expect((await request(app).post("/recipients/rosa_garcia/tasks").set(auth).send({ title: " " })).status).toBe(400);
    expect(
      (await request(app).post("/recipients/rosa_garcia/tasks").set(auth).send({ title: "x", due_date: "tomorrow" })).status,
    ).toBe(400);
    expect((await request(app).get("/recipients/nobody/tasks").set(auth)).status).toBe(404);
    expect((await request(app).patch("/recipients/rosa_garcia/tasks/nope").set(auth).send({ done: true })).status).toBe(404);
    expect((await request(app).patch("/recipients/rosa_garcia/tasks/nope").set(auth).send({ done: "yes" })).status).toBe(400);
  });
});
