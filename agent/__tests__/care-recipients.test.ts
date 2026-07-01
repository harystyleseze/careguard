import { describe, it, expect, beforeEach } from "vitest";
import { CareRecipientsStore } from "../../services/care-recipients/db.ts";

function makeStore() {
  return new CareRecipientsStore(":memory:");
}

describe("CareRecipientsStore", () => {
  let store: CareRecipientsStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("seeds Rosa Garcia as the default recipient", () => {
    const list = store.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("rosa_garcia");
    expect(list[0].name).toBe("Rosa Garcia");
    expect(list[0].age).toBe(78);
    expect(list[0].medications).toContain("Lisinopril");
  });

  it("getById returns the seeded recipient", () => {
    const r = store.getById("rosa_garcia");
    expect(r).toBeDefined();
    expect(r!.name).toBe("Rosa Garcia");
  });

  it("getById returns undefined for unknown id", () => {
    expect(store.getById("nonexistent")).toBeUndefined();
  });

  it("creates a new recipient and retrieves it", () => {
    const created = store.create({
      name: "John Doe",
      age: 65,
      medications: ["Aspirin"],
      primary_doctor: "Dr. Smith",
      insurance: "Medicare",
      caregiver_user_id: null,
    });
    expect(created.id).toMatch(/^john_doe_\d+$/);
    expect(created.name).toBe("John Doe");
    expect(created.medications).toEqual(["Aspirin"]);

    const fetched = store.getById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("John Doe");
  });

  it("list returns all recipients sorted by name", () => {
    store.create({ name: "Zara Young", age: 72, medications: [], primary_doctor: null, insurance: null, caregiver_user_id: null });
    store.create({ name: "Adam Brown", age: 80, medications: [], primary_doctor: null, insurance: null, caregiver_user_id: null });
    const list = store.list();
    // Should include Rosa Garcia + 2 new ones, sorted A→Z
    expect(list.map((r) => r.name)).toEqual(
      [...list.map((r) => r.name)].sort(),
    );
  });

  it("handles null medications gracefully", () => {
    const created = store.create({
      name: "No Meds",
      age: null,
      medications: [],
      primary_doctor: null,
      insurance: null,
      caregiver_user_id: null,
    });
    expect(created.medications).toEqual([]);
  });
});
