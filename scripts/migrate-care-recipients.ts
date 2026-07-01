import { createCareRecipientsStore } from '../services/care-recipients/db.ts';

// Instantiating CareRecipientsStore runs migrate() + seedIfEmpty() automatically.
const store = createCareRecipientsStore();
const recipients = store.list();
console.log(`care_recipients migration complete. ${recipients.length} recipient(s):`);
for (const r of recipients) {
  console.log(`  [${r.id}] ${r.name} (age ${r.age ?? '?'})`);
}
