import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../server.ts';

const auth = (req: any) => req.set('Authorization', 'Bearer test-caregiver-token');

describe('Transaction Pagination', () => {
  beforeEach(async () => {
    // Reset the agent to ensure clean state
    await auth(request(app).post('/agent/reset'));
  });

  it('should return paginated transactions with default limit', async () => {
    const response = await auth(request(app).get('/agent/transactions'))
      .expect(200);

    expect(response.body).toHaveProperty('transactions');
    expect(response.body).toHaveProperty('pagination');
    expect(response.body.pagination).toEqual({
      total: expect.any(Number),
      limit: 25,
      offset: 0,
      hasMore: expect.any(Boolean),
      hasPrevious: false
    });
  });

  it('should respect custom limit parameter', async () => {
    const response = await auth(request(app).get('/agent/transactions?limit=10'))
      .expect(200);

    expect(response.body.pagination.limit).toBe(10);
    expect(response.body.transactions).toHaveLength.lessThanOrEqual(10);
  });

  it('should respect offset parameter', async () => {
    const response = await auth(request(app).get('/agent/transactions?limit=5&offset=10'))
      .expect(200);

    expect(response.body.pagination.offset).toBe(10);
    expect(response.body.pagination.hasPrevious).toBe(true);
  });

  it('should return correct pagination metadata', async () => {
    // First page
    const firstPage = await auth(request(app).get('/agent/transactions?limit=3'))
      .expect(200);

    expect(firstPage.body.pagination.hasPrevious).toBe(false);
    
    if (firstPage.body.pagination.total > 3) {
      expect(firstPage.body.pagination.hasMore).toBe(true);
      
      // Second page
      const secondPage = await auth(request(app).get('/agent/transactions?limit=3&offset=3'))
        .expect(200);

      expect(secondPage.body.pagination.hasPrevious).toBe(true);
      expect(secondPage.body.pagination.offset).toBe(3);
    }
  });

  it('should handle empty transaction list', async () => {
    const response = await auth(request(app).get('/agent/transactions'))
      .expect(200);

    expect(response.body.transactions).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
    expect(response.body.pagination.hasMore).toBe(false);
    expect(response.body.pagination.hasPrevious).toBe(false);
  });

  it('should return transactions in reverse chronological order', async () => {
    const response = await auth(request(app).get('/agent/transactions?limit=5'))
      .expect(200);

    if (response.body.transactions.length > 1) {
      const transactions = response.body.transactions;
      for (let i = 1; i < transactions.length; i++) {
        const prevTimestamp = new Date(transactions[i-1].timestamp);
        const currTimestamp = new Date(transactions[i].timestamp);
        expect(prevTimestamp.getTime()).toBeGreaterThanOrEqual(currTimestamp.getTime());
      }
    }
  });
});
