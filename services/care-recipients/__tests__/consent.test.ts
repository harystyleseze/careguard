import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createCareRecipientsStore, DEFAULT_CONSENT_SETTINGS, CareRecipientsStore } from '../db.ts';
import { createCareRecipientsRouter } from '../routes.ts';

const CAREGIVER_TOKEN = 'test-operator-token';

describe('Granular Data-Sharing Consent Settings (#1218)', () => {
  let store: CareRecipientsStore;
  let app: express.Application;

  beforeEach(() => {
    store = createCareRecipientsStore(':memory:');
    app = express();
    app.use(express.json());
    app.use(createCareRecipientsRouter(store, CAREGIVER_TOKEN));
  });

  it('returns default open consent settings for existing recipient', async () => {
    const res = await request(app)
      .get('/recipients/rosa_garcia/consent')
      .set('Authorization', `Bearer ${CAREGIVER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.recipient_id).toBe('rosa_garcia');
    expect(res.body.consent).toEqual(DEFAULT_CONSENT_SETTINGS);
  });

  it('allows owner to update consent settings and persists changes', async () => {
    const updatedPayload = {
      'co-caregiver': {
        medications: true,
        bills: false,
        wallet: false,
      },
      viewer: {
        medications: false,
        bills: false,
        wallet: false,
      },
    };

    const putRes = await request(app)
      .put('/recipients/rosa_garcia/consent')
      .set('Authorization', `Bearer ${CAREGIVER_TOKEN}`)
      .send(updatedPayload);

    expect(putRes.status).toBe(200);
    expect(putRes.body.consent.owner).toEqual({ medications: true, bills: true, wallet: true });
    expect(putRes.body.consent['co-caregiver']).toEqual({
      medications: true,
      bills: false,
      wallet: false,
    });
    expect(putRes.body.consent.viewer).toEqual({
      medications: false,
      bills: false,
      wallet: false,
    });

    // Verify subsequent GET returns the persisted settings
    const getRes = await request(app)
      .get('/recipients/rosa_garcia/consent')
      .set('Authorization', `Bearer ${CAREGIVER_TOKEN}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.consent).toEqual(putRes.body.consent);
  });

  it('rejects consent update from viewer or co-caregiver role with 403', async () => {
    // Invite a viewer
    const { inviteToken } = store.inviteCaregiver({
      recipientId: 'rosa_garcia',
      email: 'viewer@example.com',
      role: 'viewer',
      invitedBy: 'admin',
    });
    const { accessToken } = store.acceptInvite(inviteToken, 'Viewer User');

    const res = await request(app)
      .put('/recipients/rosa_garcia/consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        viewer: { medications: false, bills: false, wallet: false },
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/does not have manage permission/);
  });

  it('allows linked viewer to view consent settings', async () => {
    const { inviteToken } = store.inviteCaregiver({
      recipientId: 'rosa_garcia',
      email: 'viewer@example.com',
      role: 'viewer',
      invitedBy: 'admin',
    });
    const { accessToken } = store.acceptInvite(inviteToken, 'Viewer User');

    const res = await request(app)
      .get('/recipients/rosa_garcia/consent')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.consent).toBeDefined();
  });

  it('returns 404 for consent check on non-existent recipient', async () => {
    const res = await request(app)
      .get('/recipients/non_existent_recipient/consent')
      .set('Authorization', `Bearer ${CAREGIVER_TOKEN}`);

    expect(res.status).toBe(404);
  });
});
