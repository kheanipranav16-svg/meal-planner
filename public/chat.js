// Chat panel. Sends the message plus the remembered preferences ("state") to
// /api/chat and shows the reply. If a plan comes back it is drawn by app.js.
// The state lives in localStorage so the assistant remembers the customer on the next visit.

import { api, el, renderPlan } from './app.js';

const STORE_KEY = 'fresh-planner-chat-v1';
const SUGGESTIONS = [
  '3 vegetarian dinners under 600 calories',
  '5 days non-veg, 1800 calories a day',
  'Vegan for a week, budget €30',
  "Show today's deals",
  'Start over',
];

const log = document.querySelector('#chat-log');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#chat-input');
const sendButton = document.querySelector('#chat-send');
const chips = document.querySelector('#chat-chips');

let state = loadState();
let busy = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return saved !== null && typeof saved === 'object' ? saved : {};
  } catch {
    return {}; // storage blocked or corrupted: start fresh
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: the assistant still works, it just forgets on reload
  }
}

function addMessage(kind, text) {
  const node = el('div', { class: `msg ${kind}` }, text);
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

async function send(text) {
  const message = text.trim();
  if (!message || busy) return;

  busy = true;
  sendButton.disabled = true;
  input.value = '';
  addMessage('user', message);
  const pending = addMessage('bot pending', 'Thinking…');

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, state }),
    });
    state = data.state ?? {};
    saveState();
    pending.className = 'msg bot';
    pending.textContent = data.reply;
    if (data.plan) renderPlan(data.plan);
  } catch (error) {
    pending.className = 'msg bot error';
    pending.textContent = `Sorry, that did not work: ${error.message}`;
  } finally {
    busy = false;
    sendButton.disabled = false;
    log.scrollTop = log.scrollHeight;
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  send(input.value);
});

for (const suggestion of SUGGESTIONS) {
  const chip = el('button', { type: 'button', class: 'chip' }, suggestion);
  chip.addEventListener('click', () => send(suggestion));
  chips.append(chip);
}

addMessage(
  'bot',
  Object.keys(state).length > 0
    ? 'Welcome back! I still remember your preferences. Say “plan” for a new plan, tell me what to change, or say “start over”.'
    : 'Hi! I plan dinners from what is in stock and on offer today. Tell me your diet (veg, non-veg or vegan), how many days, a calorie target and a budget, for example: “3 vegetarian dinners under 600 calories”.',
);
