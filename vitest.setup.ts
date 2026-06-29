// Extends vitest's expect with @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// This runs for all test environments; DOM matchers are only useful in jsdom tests.
import "@testing-library/jest-dom/vitest";

const workerId = process.env.VITEST_WORKER_ID || "1";
const port = String(3000 + parseInt(workerId));
process.env.PORT = port;
process.env.PHARMACY_API_URL = `http://127.0.0.1:${port}`;
process.env.BILL_AUDIT_API_URL = `http://127.0.0.1:${port}`;
process.env.DRUG_INTERACTION_API_URL = `http://127.0.0.1:${port}`;
process.env.PHARMACY_PAYMENT_API_URL = `http://127.0.0.1:${port}`;

// Silence pino output in tests
process.env.LOG_LEVEL = "silent";
process.env.CAREGIVER_TOKEN = "test-caregiver-token";
process.env.AGENT_API_KEY = "test-agent-api-key";
process.env.AGENT_SECRET_KEY = "SC4NVF7S4WC4V5UTZ2A4AQZSKL6KJHEPQIYXBQU44OA35BWX264CL5NQ";
process.env.MOCK_NETWORK = "1";
process.env.STELLAR_NETWORK = "testnet";
process.env.PHARMACY_1_PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
process.env.MPP_SECRET_KEY = "mock-secret";
process.env.LLM_API_KEY = "mock-api-key";

import path from 'path';
import fs from 'fs';

// Run before each test file
const envWorkerId = process.env.VITEST_WORKER_ID || Math.random().toString(36).slice(2);
process.env.DATA_DIR = path.join(__dirname, `data-test-env-${envWorkerId}`);

