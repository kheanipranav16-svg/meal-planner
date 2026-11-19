import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seed, getRecipes, getStock } from '../src/db.js';
import { applyPatch, describeState, handleChat, parseMessage, patchFromLlmJson, sanitizeState } from '../src/chat.js';
import { createLlm } from '../src/llm-client.js';
import { ValidationError } from '../src/planner.js';

const TODAY = new Date(2026, 10, 16);
const db = openDb(':memory:');
seed(db, TODAY);
const recipes = getRecipes(db);
const stock = getStock(db);
const quiet = () => {};
const chat = (message, state = {}, extra = {}) =>
  handleChat({ body: { message, state }, recipes, stock, today: TODAY, log: quiet, ...extra });

// --- understanding messages -------------------------------------------------

test('days, diet and a calorie ceiling', () => {
  const p = parseMessage('3 vegetarian dinners under 600 calories');
  assert.equal(p.days, 3);
  assert.equal(p.diet, 'vegetarian');
  assert.equal(p.maxCalories, 600);
  assert.equal(p.minCalories, undefined);
  assert.equal(p.intent, 'plan');
});

test('daily calories become a dinner window, with an explanation', () => {
  const p = parseMessage('5 days non-veg, 1800 calories a day, budget 30');
  assert.equal(p.days, 5);
  assert.equal(p.diet, 'nonveg');
  assert.equal(p.minCalories, 500); // 35% of 1800 = 630, minus 20%
  assert.equal(p.maxCalories, 760);
  assert.equal(p.budgetEuros, 30);
  assert.match(p.notes.join(' '), /1800 kcal a day/);
});

test('"veg and non veg" means both are fine; "around" gives a window', () => {
  const p = parseMessage('veg and non veg, around 500 kcal');
  assert.equal(p.diet, 'omnivore');
  assert.deepEqual([p.minCalories, p.maxCalories], [400, 600]);
});

test('a week, vegan, euro sign', () => {
  const p = parseMessage('vegan for a week, €25');
  assert.equal(p.days, 7);
  assert.equal(p.diet, 'vegan');
  assert.equal(p.budgetEuros, 25);
});

test('budget in euros is not mistaken for calories', () => {
  const p = parseMessage('under 25 euro for 3 days');
  assert.equal(p.budgetEuros, 25);
  assert.equal(p.days, 3);
  assert.equal(p.maxCalories, undefined);
});

test('calorie ranges, minimums and combinations', () => {
  const range = parseMessage('between 400-600 calories');
  assert.deepEqual([range.minCalories, range.maxCalories], [400, 600]);
  const both = parseMessage('at least 400 and under 700 calories');
  assert.deepEqual([both.minCalories, both.maxCalories], [400, 700]);
});

test('low and high calorie keywords', () => {
  assert.equal(parseMessage('low calorie please').maxCalories, 450);
  assert.equal(parseMessage('something hearty').minCalories, 700);
});

test('ingredient exclusions, including lists and allergies', () => {
  assert.deepEqual(parseMessage('no tofu, without mozzarella and eggs').addExclude, ['tofu', 'mozzarella', 'egg']);
  assert.deepEqual(parseMessage("I'm allergic to peanuts and shellfish").addExclude, ['peanut', 'shellfish']);
  assert.deepEqual(parseMessage('vegetarian with no tomatoes under 500 calories').addExclude, ['tomato']);
  assert.deepEqual(parseMessage('no tofu no eggs').addExclude, ['tofu', 'egg']);
});

test('"no meat" means vegetarian, not an excluded ingredient called meat', () => {
  const p = parseMessage('no meat');
  assert.equal(p.diet, 'vegetarian');
  assert.equal(p.addExclude, undefined);
});

test('intents: deals, help, reset, unknown', () => {
  assert.equal(parseMessage("show me today's deals").intent, 'deals');
  assert.equal(parseMessage('hello').intent, 'help');
  assert.equal(parseMessage('start over').intent, 'reset');
  assert.equal(parseMessage('what is the weather').intent, 'other');
  assert.equal(parseMessage('plan meals using the deals').intent, 'plan');
});

test('clearing preferences', () => {
  assert.deepEqual(parseMessage('remove the budget').clear, ['budgetEuros']);
  assert.deepEqual(parseMessage('no calorie limit').clear, ['minCalories', 'maxCalories']);
  assert.equal(parseMessage('no calorie limit').addExclude, undefined);
});

test('too many days and absurd calories are handled with a note', () => {
  const days = parseMessage('10 days');
  assert.equal(days.days, 7);
  assert.match(days.notes[0], /up to 7 days/);
  const kcal = parseMessage('under 50 calories');
  assert.equal(kcal.maxCalories, undefined);
  assert.match(kcal.notes[0], /ignored 50 kcal/);
});

// --- state ------------------------------------------------------------------

test('applyPatch merges, adds exclusions and drops contradicting calorie limits', () => {
  let state = applyPatch({}, parseMessage('vegan, around 700 calories'));
  assert.deepEqual([state.minCalories, state.maxCalories], [560, 840]);
  state = applyPatch(state, parseMessage('under 500 calories'));
  assert.equal(state.maxCalories, 500);
  assert.equal(state.minCalories, undefined);
  state = applyPatch(state, parseMessage('no tofu'));
  state = applyPatch(state, parseMessage('no eggs'));
  assert.deepEqual(state.exclude, ['tofu', 'egg']);
  assert.equal(state.diet, 'vegan');
  state = applyPatch(state, parseMessage('start over, vegetarian'));
  assert.deepEqual(state, { diet: 'vegetarian' });
});

test('sanitizeState drops anything invalid from the browser', () => {
  const dirty = { days: 99, diet: 'carnivore', exclude: 'tofu', budgetEuros: -1, maxCalories: 600, minCalories: 900, extra: 1 };
  assert.deepEqual(sanitizeState(dirty), { maxCalories: 600 });
  assert.deepEqual(sanitizeState(null), {});
  assert.deepEqual(sanitizeState([]), {});
});

test('describeState reads naturally', () => {
  const text = describeState({ diet: 'vegan', minCalories: 400, maxCalories: 600, budgetEuros: 25, exclude: ['tofu'] });
  assert.equal(text, 'vegan · 400-600 kcal per serving · budget €25 · no tofu');
});

// --- whole conversations against the demo shop --------------------------------

test('a calorie-limited vegan plan respects diet, calories and stock', async () => {
  const { reply, state, plan } = await chat('3 vegan dinners under 600 calories');
  assert.deepEqual(state, { days: 3, diet: 'vegan', maxCalories: 600 });
  const planned = plan.meals.filter((m) => m.recipe);
  assert.ok(planned.length > 0);
  for (const meal of planned) {
    assert.equal(meal.recipe.diet, 'vegan');
    assert.ok(meal.caloriesPerServing <= 600, `${meal.recipe.name} has ${meal.caloriesPerServing} kcal`);
  }
  assert.match(reply, /3-day plan/);
  assert.match(reply, /kcal each/);
});

test('the bot remembers earlier preferences and refines them', async () => {
  const first = await chat('4 vegan dinners under 650 calories');
  const second = await chat('no tofu', first.state);
  assert.equal(second.state.diet, 'vegan');
  assert.equal(second.state.maxCalories, 650);
  assert.deepEqual(second.state.exclude, ['tofu']);
  const ingredients = second.plan.meals.filter((m) => m.recipe).flatMap((m) => m.ingredients.map((i) => i.name));
  assert.ok(!ingredients.includes('Tofu'));
});

test('non-veg returns only meat or fish dishes', async () => {
  const { plan } = await chat('3 non-veg dinners');
  const planned = plan.meals.filter((m) => m.recipe);
  assert.ok(planned.length > 0);
  assert.ok(planned.every((m) => m.recipe.diet === 'omnivore'));
});

test('"no fish" removes recipes with salmon even though the word is not in the product name', async () => {
  const { plan } = await chat('7 days no fish');
  const names = plan.meals.filter((m) => m.recipe).flatMap((m) => m.ingredients.map((i) => i.name));
  assert.ok(!names.includes('Salmon fillet'));
});

test('an impossible request gets a helpful answer and no plan', async () => {
  const { reply, plan, state } = await chat('vegan under 150 calories');
  assert.equal(plan, null);
  assert.match(reply, /couldn't find any recipe/);
  assert.equal(state.maxCalories, 150); // kept, so the customer can relax it
});

test('deals, help, unknown and empty messages', async () => {
  const deals = await chat("what's on offer today?");
  assert.match(deals.reply, /Basil: 50% off/);
  assert.match((await chat('hi')).reply, /I plan dinners/);
  assert.match((await chat('asdf qwer')).reply, /didn't catch/);
  await assert.rejects(() => chat('   '), ValidationError);
  await assert.rejects(() => chat('x'.repeat(501)), ValidationError);
  await assert.rejects(() => handleChat({ body: {}, recipes, stock }), ValidationError);
});

// --- optional AI parser (tested with a fake fetch, no network) ----------------

const fakeFetch = (text, { ok = true, status = 200 } = {}) => {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => ({ choices: [{ message: { content: text } }] }) };
  };
  return { impl, calls };
};

test('the AI parser sends the right request and its answer is used', async () => {
  const fake = fakeFetch('Sure! {"intent":"plan","diet":"vegan","dailyCalories":2000,"exclude":["Tofu"],"days":3}');
  const llm = createLlm({ apiKey: 'test-key', fetchImpl: fake.impl });
  const { state, plan } = await chat('my sister is vegan, feed us on a 2000 kcal day, hold the tofu', {}, { llm });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(fake.calls[0].options.headers.authorization, 'Bearer test-key');
  const sent = JSON.parse(fake.calls[0].options.body);
  assert.equal(sent.model, 'gpt-4o-mini');
  assert.match(sent.messages[1].content, /hold the tofu/);

  assert.deepEqual(state, { days: 3, diet: 'vegan', minCalories: 560, maxCalories: 840, exclude: ['tofu'] });
  assert.ok(plan.meals.filter((m) => m.recipe).every((m) => m.recipe.diet === 'vegan'));
});

test('invalid values from the AI are ignored, not trusted', () => {
  const patch = patchFromLlmJson({
    intent: 'plan',
    diet: 'rm -rf /',
    days: 400,
    maxCaloriesPerServing: 99999,
    budgetEuros: -5,
    exclude: ['<script>alert(1)</script>', 'peanuts', 42],
    clear: ['budget', 'everything'],
  });
  assert.equal(patch.diet, undefined);
  assert.equal(patch.days, 7);
  assert.equal(patch.maxCalories, undefined);
  assert.equal(patch.budgetEuros, undefined);
  assert.deepEqual(patch.addExclude, ['peanut']);
  assert.deepEqual(patch.clear, ['budgetEuros']);
  assert.throws(() => patchFromLlmJson('nope'));
});

test('if the AI call fails or returns junk, the built-in rules take over', async () => {
  const warnings = [];
  const log = (m) => warnings.push(m);
  const down = createLlm({ apiKey: 'k', fetchImpl: fakeFetch('', { ok: false, status: 529 }).impl });
  const junk = createLlm({ apiKey: 'k', fetchImpl: fakeFetch('I cannot do that').impl });
  const broken = createLlm({ apiKey: 'k', fetchImpl: async () => { throw new Error('network down'); } });

  for (const llm of [down, junk, broken]) {
    const { state } = await chat('3 vegetarian dinners', {}, { llm, log });
    assert.deepEqual(state, { days: 3, diet: 'vegetarian' });
  }
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /HTTP 529/);
});

test('createLlm requires a key', () => {
  assert.throws(() => createLlm({}));
});
