// The chat endpoint over real HTTP, with an in-memory database and a fixed "today".

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seed } from '../src/db.js';
import { createServer } from '../src/server.js';

const TODAY = new Date(2026, 10, 16);
let server;
let base;

before(async () => {
  const db = openDb(':memory:');
  seed(db, TODAY);
  server = createServer(db, { now: () => TODAY });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (body) =>
  fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('POST /api/chat builds a plan and returns state to send back next time', async () => {
  const response = await post({ message: '3 vegetarian dinners under 650 calories, no tofu' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.state, { days: 3, diet: 'vegetarian', maxCalories: 650, exclude: ['tofu'] });
  assert.ok(data.plan.meals.some((m) => m.recipe));
  assert.match(data.reply, /vegetarian/);

  const followUp = await (await post({ message: 'make it vegan', state: data.state })).json();
  assert.equal(followUp.state.diet, 'vegan');
  assert.equal(followUp.state.maxCalories, 650);
});

test('the GET /api/recipes calorie fields are present', async () => {
  const recipes = await (await fetch(`${base}/api/recipes?diet=vegan`)).json();
  assert.ok(recipes.length > 0);
  assert.ok(recipes.every((r) => Number.isInteger(r.caloriesPerServing) && r.caloriesPerServing > 0));
});

test('POST /api/meal-plan accepts a calorie range', async () => {
  const response = await fetch(`${base}/api/meal-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 3, maxCalories: 600 }),
  });
  const plan = await response.json();
  assert.ok(plan.meals.filter((m) => m.recipe).every((m) => m.caloriesPerServing <= 600));
});

test('bad chat requests get a 400, wrong method a 405', async () => {
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ message: 42 })).status, 400);
  assert.equal((await fetch(`${base}/api/chat`, { method: 'POST', body: 'not json' })).status, 400);
  assert.equal((await fetch(`${base}/api/chat`)).status, 405);
});

test('hostile state from the browser cannot break the plan', async () => {
  const state = { days: 1e9, diet: { $ne: 1 }, exclude: [1, null, 'x'.repeat(100)], maxCalories: 'NaN', __proto__: { admin: true } };
  const response = await post({ message: 'plan dinners', state });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.plan.meals.length > 0);
});
