# PDF Snapshots Regeneration Runbook

This runbook documents how to regenerate or update the PDF report formatting snapshots when formatting regressions or intentional design updates occur.

## When to Regenerate
Snapshots should only be updated if:
1. You have modified the layout, fonts, header/footer structure, or styling in `dashboard/src/app/pdf.ts`.
2. You have added or updated data columns, summary boxes, or table metrics in the PDF generation routines.

---

## Instructions

To update the snapshots, run the following command from the repository root:

```bash
npx vitest run pdf -u
```

This updates the snapshot file located at `dashboard/src/app/__snapshots__/pdf.test.ts.snap` with the newly generated text contents.

---

## Verification
Review the git diff of `dashboard/src/app/__snapshots__/pdf.test.ts.snap` to verify that the updated layout text matches the intended formatting changes before committing.
