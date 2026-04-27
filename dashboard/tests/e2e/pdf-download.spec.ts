import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import pdfParse from "pdf-parse";
import { mockDashboardApis } from "./helpers";

test("pdf download buttons trigger browser downloads", async ({ page }) => {
  await mockDashboardApis(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Compare Medication Prices" }).click();
  await page.getByRole("tab", { name: "Medications" }).click();

  const medDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const medPdf = await medDownload;
  const medPath = await medPdf.path();
  expect(medPath).toBeTruthy();
  if (medPath) {
    const buffer = await fs.readFile(medPath);
    const parsed = await pdfParse(buffer);
    expect(parsed.text).toContain("Ada Lovelace");
  }

  await page.getByRole("tab", { name: "Activity" }).click();
  const txDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Report" }).click();
  await expect(await txDownload).toBeTruthy();
});
