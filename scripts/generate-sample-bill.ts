import { mkdirSync } from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface LineItem {
  description: string;
  cptCode: string;
  quantity: number;
  amount: number;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    fallback
  );
}

const outputDir = path.resolve(
  argValue("out", "services/bill-audit-api/fixtures/generated"),
);
const patient = argValue("patient", "Rosa Garcia");
const includeDuplicate = hasFlag("duplicate");
const includeUpcoded = hasFlag("upcoded");
const includeOvercharge = hasFlag("overcharge");

const lineItems: LineItem[] = [
  {
    description: "Office visit, established patient",
    cptCode: "99213",
    quantity: 1,
    amount: includeOvercharge ? 325 : 130,
  },
  {
    description: "Comprehensive metabolic panel",
    cptCode: "80053",
    quantity: 1,
    amount: 95,
  },
  {
    description: "Complete blood count",
    cptCode: "85025",
    quantity: 1,
    amount: 45,
  },
];

if (includeDuplicate) {
  lineItems.push({
    description: "Complete blood count",
    cptCode: "85025",
    quantity: 1,
    amount: 45,
  });
}

if (includeUpcoded) {
  lineItems.push({
    description: "Office visit, high complexity",
    cptCode: "99215",
    quantity: 1,
    amount: 1_250,
  });
}

mkdirSync(outputDir, { recursive: true });

const doc = new jsPDF();
doc.setFontSize(18);
doc.text("CareGuard Sample Medical Bill", 14, 20);
doc.setFontSize(11);
doc.text(`Patient: ${patient}`, 14, 32);
doc.text("Facility: General Hospital", 14, 40);
doc.text("Date of service: 2026-03-15", 14, 48);

autoTable(doc, {
  startY: 58,
  head: [["Description", "CPT", "Qty", "Charge"]],
  body: lineItems.map((item) => [
    item.description,
    item.cptCode,
    String(item.quantity),
    `$${item.amount.toFixed(2)}`,
  ]),
});

const total = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
const finalY = (doc as any).lastAutoTable?.finalY ?? 58;
doc.text(`Total charged: $${total.toFixed(2)}`, 14, finalY + 12);

const traits = [
  includeDuplicate ? "duplicate" : null,
  includeUpcoded ? "upcoded" : null,
  includeOvercharge ? "overcharge" : null,
].filter(Boolean);
const fileName = `sample-bill-${traits.join("-") || "clean"}.pdf`;
const outputPath = path.join(outputDir, fileName);
doc.save(outputPath);

console.log(outputPath);
