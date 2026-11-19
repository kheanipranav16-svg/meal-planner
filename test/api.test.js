// End-to-end test: real HTTP server, in-memory database, demo data, fixed "today".

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

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/health', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('GET /api/products hides expired and sold-out items', async () => {
  const products = await (await fetch(`${base}/api/products`)).json();
  const names = products.map((p) => p.name);
  assert.ok(!names.includes('Yoghurt'), 'expired item must not be sold');
  assert.ok(!names.includes('Salmon fillet'), 'sold-out item must not be sold');
  assert.equal(products.find((p) => p.name === 'Basil').discountRate, 0.5);
  assert.equal(products.find((p) => p.name === 'Mozzarella').discountRate, 0.3);
  assert.equal(products.find((p) => p.name === 'Pasta').discountRate, 0.15);
});

test('GET /api/products?discounted=true returns only deals', async () => {
  const deals = await (await fetch(`${base}/api/products?discounted=true`)).json();
  assert.ok(deals.length > 0);
  assert.ok(deals.every((d) => d.discountRate > 0));
});

test('GET /api/recipes only lists recipes that can be made', async () => {
  const recipes = await (await fetch(`${base}/api/recipes`)).json();
  assert.ok(!recipes.some((r) => r.name === 'Baked Salmon with Potatoes'), 'salmon is sold out');
  assert.ok(recipes.length > 0);
});

test('POST /api/meal-plan returns a vegan plan with consistent totals', async () => {
  const response = await post('/api/meal-plan', { days: 4, diet: 'vegan', budgetEuros: 40 });
  assert.equal(response.status, 200);
  const result = await response.json();

  const planned = result.meals.filter((m) => m.recipe);
  assert.ok(planned.length > 0);
  assert.ok(planned.every((m) => m.recipe.diet === 'vegan'));
  assert.equal(new Set(planned.map((m) => m.recipe.id)).size, planned.length, 'no repeated recipes');
  assert.ok(result.totals.costCents <= 4000, 'within budget');
  assert.equal(
    result.shoppingList.reduce((sum, i) => sum + i.totalCents, 0),
    result.totals.costCents,
  );
});

test('POST /api/meal-plan never plans more of an item than is in stock', async () => {
  const result = await (await post('/api/meal-plan', { days: 7 })).json();
  const products = await (await fetch(`${base}/api/products`)).json();
  const stock = new Map(products.map((p) => [p.productId, p.quantity]));
  for (const line of result.shoppingList) {
    assert.ok(line.quantity <= stock.get(line.productId), `${line.name} over-sold`);
  }
});

test('invalid input gets a 400 with a message', async () => {
  const response = await post('/api/meal-plan', { days: 99 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /days/);

  const broken = await fetch(`${base}/api/meal-plan`, { method: 'POST', body: '{not json' });
  assert.equal(broken.status, 400);
});

test('wrong method and unknown route', async () => {
  const wrongMethod = await fetch(`${base}/api/meal-plan`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/constructor`)).status, 404);
});

test('static files are served and path traversal is blocked', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Fresh Planner/);

  const escape = await fetch(`${base}/..%2Fpackage.json`);
  assert.equal(escape.status, 404);
});
