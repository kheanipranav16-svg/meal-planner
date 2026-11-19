import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/dates.js';
import { ValidationError, buildMealPlan, fitsDiet, listRankedRecipes, normalizePrefs } from '../src/planner.js';
import { buildPrompt, validateLlmPlan } from '../src/llm.js';

const TODAY = new Date(2026, 10, 16);
const stockRow = (productId, name, priceCents, quantity, daysLeft) => ({
  productId,
  name,
  category: 'test',
  unit: 'each',
  priceCents,
  quantity,
  expiryDate: addDays(TODAY, daysLeft),
});

// Three products; "Soup" uses the discounted one, "Salad" does not.
const STOCK = [
  stockRow(1, 'Carrot', 100, 10, 1), // 50% off
  stockRow(2, 'Lentils', 200, 10, 90),
  stockRow(3, 'Lettuce', 150, 10, 90),
  stockRow(4, 'Ham', 500, 1, 90),
];
const RECIPES = [
  {
    id: 1,
    name: 'Soup',
    diet: 'vegan',
    instructions: 'Simmer.',
    ingredients: [
      { productId: 1, name: 'Carrot', amount: 2 },
      { productId: 2, name: 'Lentils', amount: 1 },
    ],
  },
  {
    id: 2,
    name: 'Salad',
    diet: 'vegan',
    instructions: 'Toss.',
    ingredients: [
      { productId: 3, name: 'Lettuce', amount: 1 },
      { productId: 2, name: 'Lentils', amount: 1 },
    ],
  },
  {
    id: 3,
    name: 'Ham sandwich',
    diet: 'omnivore',
    instructions: 'Stack.',
    ingredients: [{ productId: 4, name: 'Ham', amount: 1 }],
  },
];
const plan = (prefs) => buildMealPlan({ recipes: RECIPES, stock: STOCK, prefs: normalizePrefs(prefs), today: TODAY });

test('normalizePrefs applies defaults', () => {
  const prefs = normalizePrefs({});
  assert.equal(prefs.days, 5);
  assert.equal(prefs.diet, 'omnivore');
  assert.equal(prefs.budgetCents, Infinity);
});

test('normalizePrefs rejects bad input with a ValidationError', () => {
  assert.throws(() => normalizePrefs({ days: 0 }), ValidationError);
  assert.throws(() => normalizePrefs({ days: 8 }), ValidationError);
  assert.throws(() => normalizePrefs({ diet: 'carnivore' }), ValidationError);
  assert.throws(() => normalizePrefs({ budgetEuros: -5 }), ValidationError);
  assert.throws(() => normalizePrefs({ exclude: 'tofu' }), ValidationError);
  assert.throws(() => normalizePrefs([]), ValidationError);
});

test('a vegan recipe fits a vegetarian, but not the other way round', () => {
  assert.equal(fitsDiet('vegan', 'vegetarian'), true);
  assert.equal(fitsDiet('omnivore', 'vegetarian'), false);
});

test('recipes that use discounted stock rank first', () => {
  const ranked = listRankedRecipes({ recipes: RECIPES, stock: STOCK, prefs: normalizePrefs({}), today: TODAY });
  assert.equal(ranked[0].name, 'Soup');
  assert.equal(ranked[0].savingsCents, 100); // 2 carrots, 50 cents saved each
});

test('the plan picks a different recipe each day and respects the diet', () => {
  const result = plan({ days: 3, diet: 'vegan' });
  const names = result.meals.map((m) => m.recipe?.name);
  assert.deepEqual(names, ['Soup', 'Salad', undefined]); // only two vegan recipes exist
  assert.match(result.meals[2].note, /No more matching recipes/);
});

test('the plan never uses more of an ingredient than is in stock', () => {
  const lowStock = STOCK.map((row) => (row.productId === 2 ? { ...row, quantity: 1 } : row));
  const result = buildMealPlan({ recipes: RECIPES, stock: lowStock, prefs: normalizePrefs({ days: 2, diet: 'vegan' }), today: TODAY });
  assert.equal(result.meals.filter((m) => m.recipe).length, 1); // only one lentil left
});

test('the plan stays within budget', () => {
  // Soup costs 2 x 50 + 200 = 300 cents; Salad costs 350. Budget 3.00 allows only the soup.
  const result = plan({ days: 2, diet: 'vegan', budgetEuros: 3 });
  assert.equal(result.meals[0].recipe.name, 'Soup');
  assert.equal(result.meals[1].recipe, null);
  assert.equal(result.totals.costCents, 300);
});

test('excluded words remove recipes', () => {
  const result = plan({ days: 1, diet: 'vegan', exclude: ['carrot'] });
  assert.equal(result.meals[0].recipe.name, 'Salad');
});

test('totals and shopping list add up', () => {
  const result = plan({ days: 2, diet: 'vegan' });
  assert.equal(result.totals.fullCostCents, 400 + 350);
  assert.equal(result.totals.costCents, 300 + 350);
  assert.equal(result.totals.savingsCents, 100);
  const lentils = result.shoppingList.find((i) => i.name === 'Lentils');
  assert.equal(lentils.quantity, 2);
  const listTotal = result.shoppingList.reduce((sum, i) => sum + i.totalCents, 0);
  assert.equal(listTotal, result.totals.costCents);
});

test('LLM plans are rejected when they invent or use unavailable ingredients', () => {
  const good = { days: [{ day: 'Mon', meal: 'Soup', ingredients: ['carrot', 'Lentils'] }] };
  assert.equal(validateLlmPlan(good, STOCK, TODAY).valid, true);

  const bad = { days: [{ day: 'Mon', meal: 'Dragon stew', ingredients: ['Dragon meat'] }] };
  const verdict = validateLlmPlan(bad, STOCK, TODAY);
  assert.equal(verdict.valid, false);
  assert.match(verdict.problems[0], /Dragon meat/);

  assert.equal(validateLlmPlan({}, STOCK, TODAY).valid, false);
});

test('the LLM prompt lists in-stock items and the customer wishes', () => {
  const prompt = buildPrompt({ stock: STOCK, prefs: normalizePrefs({ diet: 'vegan', exclude: ['ham'] }), today: TODAY });
  assert.match(prompt, /Carrot .*50% off/);
  assert.match(prompt, /Diet: vegan/);
  assert.match(prompt, /Never use: ham/);
});
