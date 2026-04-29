# Dashboard theming

## PDF export theme

PDF exports accept a `theme` override so white-label deployments can customize brand colors without forking `dashboard/src/app/pdf.ts`.

The theme shape is:

- `headerColor`: RGB tuple used for table headers
- `accentColor`: RGB tuple used for highlights (e.g., savings)
- `mutedColor`: RGB tuple used for secondary text

Defaults live in `dashboard/src/lib/pdf-theme.ts` as `DEFAULT_PDF_THEME`.

