export type ClaimStatus = "submitted" | "under_review" | "approved" | "denied" | "paid";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled";

export interface MedicationSchedule { id: string; recipientId: string; medication: string; dosage: string; frequency: string; startDate: string; endDate?: string; refillLeadDays: number; nextRefillAt?: string; }
export interface Appointment { id: string; recipientId: string; doctor: string; startsAt: string; reminderMinutes: number; status: AppointmentStatus; notes?: string; }
export interface InsuranceClaim { id: string; recipientId: string; billId: string; insurer: string; status: ClaimStatus; submittedAt: string; updatedAt: string; notes?: string; }

export class CarePlanStore {
  private schedules: MedicationSchedule[] = [];
  private appointments: Appointment[] = [];
  private claims: InsuranceClaim[] = [];
  listSchedules(recipientId: string) { return this.schedules.filter((item) => item.recipientId === recipientId); }
  addSchedule(input: Omit<MedicationSchedule, "id">) { const item = { id: this.id("med"), ...input }; this.schedules.push(item); return item; }
  listAppointments(recipientId: string) { return this.appointments.filter((item) => item.recipientId === recipientId).sort((a, b) => a.startsAt.localeCompare(b.startsAt)); }
  addAppointment(input: Omit<Appointment, "id" | "status">) { const item: Appointment = { id: this.id("appt"), status: "scheduled", ...input }; this.appointments.push(item); return item; }
  updateAppointment(id: string, status: AppointmentStatus) { const item = this.appointments.find((entry) => entry.id === id); if (!item) return undefined; item.status = status; return item; }
  listClaims(recipientId: string) { return this.claims.filter((item) => item.recipientId === recipientId); }
  addClaim(input: Omit<InsuranceClaim, "id" | "status" | "submittedAt" | "updatedAt">) { const now = new Date().toISOString(); const item: InsuranceClaim = { id: this.id("claim"), status: "submitted", submittedAt: now, updatedAt: now, ...input }; this.claims.push(item); return item; }
  updateClaim(id: string, status: ClaimStatus, notes?: string) { const item = this.claims.find((entry) => entry.id === id); if (!item) return undefined; item.status = status; item.updatedAt = new Date().toISOString(); if (notes !== undefined) item.notes = notes; return item; }
  calendar(recipientId: string, from: string, to: string) { const start = Date.parse(from); const end = Date.parse(to); return { medications: this.listSchedules(recipientId).filter((item) => { const next = item.nextRefillAt ? Date.parse(item.nextRefillAt) : NaN; return Number.isFinite(next) && next >= start && next <= end; }), appointments: this.listAppointments(recipientId).filter((item) => { const at = Date.parse(item.startsAt); return at >= start && at <= end; }) }; }
  private id(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
}
