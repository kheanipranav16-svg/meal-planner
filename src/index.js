import { ensureSeeded, openDb } from './db.js';
import { createLlm } from './llm-client.js';
import { createServer } from './server.js';

const db = openDb(process.env.DB_FILE);
if (ensureSeeded(db)) console.log('Database was empty, loaded demo data.');

// Optional AI understanding of chat messages (see README). Without a key the chat
// uses its built-in rules and works exactly the same for the demo.
const llm = process.env.LLM_API_KEY
  ? createLlm({ apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL || undefined })
  : null;
console.log(llm ? 'Chat: AI reads messages (falls back to rules on errors).' : 'Chat: built-in rules (set LLM_API_KEY to enable the AI parser).');

const port = Number(process.env.PORT) || 3000;
createServer(db, { llm }).listen(port, () => {
  console.log(`Fresh Planner running at http://localhost:${port}`);
});
