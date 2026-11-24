# Dashboard Language Support

The CareGuard dashboard currently supports **English** and **Spanish**. English is the default. Spanish translations are provided in `dashboard/messages/es.json`, alongside the English source strings in `dashboard/messages/en.json`.

## Switch languages

Language is selected with the `locale` query parameter in the dashboard address. Open the Settings tab in Spanish with:

```text
http://localhost:3000/?tab=settings&locale=es
```

To return to English, remove `locale=es` from the address. You can add `&locale=es` to an address that already has a query string, or start a new query string with `?locale=es`. Bookmark the address you prefer. The choice applies in that browser address and is not saved to the care recipient's profile. An unsupported locale falls back to English.

For the Settings tab walkthrough, see [Settings Tab](settings-tab.md).

## Translation coverage

The English and Spanish message files currently have matching translation-key structures. Many navigation labels, common dashboard labels, and selected status and action messages are translated. Coverage is not complete across every visible string: some detailed finding descriptions, alerts, helper text, and generated content may still appear in English. Personal information and other content entered by a caregiver or returned as data are shown as entered and are not automatically translated. Dates, times, and numbers use locale-aware formatting.

When adding or changing user-facing dashboard text, update both message files and check the relevant screen for text that is still hard-coded in English. Do not assume the presence of a Spanish message file means every screen or generated document is fully translated.