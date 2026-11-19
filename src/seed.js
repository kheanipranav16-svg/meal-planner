// `npm run seed` resets the database to the demo data, with expiry dates
// counted from today. Run it again before a demo so discounts are fresh.

import { DEFAULT_DB_FILE, openDb, seed } from './db.js';

const file = process.env.DB_FILE ?? DEFAULT_DB_FILE;
const db = openDb(file);
seed(db);
db.close();
console.log(`Database reset with demo data: ${file}`);
