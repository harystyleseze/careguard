import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  getLocalDateStr,
  getLocalDayBounds,
} from "../agent/tz.ts";

interface Transaction {
  amount?: number;
  category?: string;
  timestamp?: string;
}

interface SpendingState {
  transactions?: Transaction[];
}

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    fallback
  );
}

function loadSpendingState(recipientId: string, dataDir: string): SpendingState {
  const recipientPath = path.join(
    dataDir,
    "recipients",
    recipientId,
    "spending.json",
  );
  const legacyPath = path.join(dataDir, "spending.json");
  const filePath = existsSync(recipientPath) ? recipientPath : legacyPath;

  if (!existsSync(filePath)) {
    return { transactions: [] };
  }

  return JSON.parse(readFileSync(filePath, "utf-8")) as SpendingState;
}

function totalForLocalDay(
  transactions: Transaction[],
  timezone: string,
  date: Date,
) {
  const localDate = getLocalDateStr(timezone, date);
  return transactions
    .filter((tx) => {
      if (!tx.timestamp) return false;
      return getLocalDateStr(timezone, new Date(tx.timestamp)) === localDate;
    })
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

const timezone = argValue("timezone", process.env.SPENDING_TIMEZONE ?? "America/Phoenix");
const recipientId = argValue("recipient", "rosa");
const dataDir = path.resolve(argValue("data-dir", "data"));
const now = new Date(argValue("now", new Date().toISOString()));

const { dayEnd } = getLocalDayBounds(timezone, now);
const beforeBoundary = new Date(dayEnd.getTime() - 60_000);
const afterBoundary = new Date(dayEnd.getTime() + 60_000);
const state = loadSpendingState(recipientId, dataDir);
const transactions = state.transactions ?? [];

const beforeTotal = totalForLocalDay(transactions, timezone, beforeBoundary);
const afterTotal = totalForLocalDay(transactions, timezone, afterBoundary);

console.log(`Recipient: ${recipientId}`);
console.log(`Timezone: ${timezone}`);
console.log(`Local day before boundary: ${getLocalDateStr(timezone, beforeBoundary)}`);
console.log(`Local day after boundary:  ${getLocalDateStr(timezone, afterBoundary)}`);
console.log("");
console.table([
  {
    point: "before local midnight",
    instant: beforeBoundary.toISOString(),
    spendingTotal: beforeTotal.toFixed(2),
  },
  {
    point: "after local midnight",
    instant: afterBoundary.toISOString(),
    spendingTotal: afterTotal.toFixed(2),
  },
]);
