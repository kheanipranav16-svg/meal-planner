// Calories and the veg / non-veg filter in the planner, with a tiny hand-made shop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/dates.js';
import { ValidationError, buildMealPlan, listRankedRecipes, normalizePrefs } from '../src/planner.js';

const TODAY = new Date(2026, 10, 16);
const row = (productId, name, kcal, priceCents = 100) => ({
  productId, name, category: 'test', unit: 'each', priceCents, kcal, quantity: 10, expiryDate: addDays(TODAY, 90),
});
const STOCK = [row(1, 'Lentils', 600), row(2, 'Lettuce', 50), row(3, 'Carrot', 100), row(4, 'Ham', 700)];
const need = (productId, name, amount = 1) => ({ productId, name, amount });
const RECIPES = [
  { id: 1, name: 'Soup', diet: 'vegan', servings: 2, instructions: '-', ingredients: [need(3, 'Carrot', 2), need(1, 'Lentils')] }, // 800 kcal / 2 = 400
  { id: 2, name: 'Salad', diet: 'vegan', servings: 2, instructions: '-', ingredients: [need(2, 'Lettuce'), need(1, 'Lentils')] }, // 650 / 2 = 325
  { id: 3, name: 'Ham sandwich', diet: 'omnivore', servings: 1, instructions: '-', ingredients: [need(4, 'Ham')] }, // 700
  { id: 4, name: 'Egg bowl', diet: 'vegetarian', servings: 1, instructions: '-', ingredients: [need(2, 'Lettuce', 2)] }, // 100
];
const ranked = (prefs) => listRankedRecipes({ recipes: RECIPES, stock: STOCK, prefs: normalizePrefs(prefs), today: TODAY });
const names = (list) => list.map((r) => r.name).sort();

test('calories per serving = total kcal of the ingredients / servings', () => {
  const all = Object.fromEntries(ranked({}).map((r) => [r.name, r.caloriesPerServing]));
  assert.deepEqual(all, { Soup: 400, Salad: 325, 'Ham sandwich': 700, 'Egg bowl': 100 });
});

test('maxCalories and minCalories filter recipes', () => {
  assert.deepEqual(names(ranked({ maxCalories: 400 })), ['Egg bowl', 'Salad', 'Soup']);
  assert.deepEqual(names(ranked({ minCalories: 500 })), ['Ham sandwich']);
  assert.deepEqual(names(ranked({ minCalories: 300, maxCalories: 410 })), ['Salad', 'Soup']);
});

test('diets: vegan, vegetarian, non-veg and anything', () => {
  assert.deepEqual(names(ranked({ diet: 'vegan' })), ['Salad', 'Soup']);
  assert.deepEqual(names(ranked({ diet: 'vegetarian' })), ['Egg bowl', 'Salad', 'Soup']);
  assert.deepEqual(names(ranked({ diet: 'nonveg' })), ['Ham sandwich']);
  assert.equal(ranked({ diet: 'omnivore' }).length, 4);
});

test('a plan only contains meals inside the calorie range and reports the average', () => {
  const plan = buildMealPlan({ recipes: RECIPES, stock: STOCK, prefs: normalizePrefs({ days: 3, diet: 'vegan', maxCalories: 400 }), today: TODAY });
  const planned = plan.meals.filter((m) => m.recipe);
  assert.equal(planned.length, 2);
  assert.ok(planned.every((m) => m.caloriesPerServing <= 400 && m.servings === 2));
  assert.equal(plan.totals.avgCaloriesPerServing, Math.round((400 + 325) / 2));
});

test('invalid calorie input is rejected', () => {
  assert.throws(() => normalizePrefs({ maxCalories: 50 }), ValidationError);
  assert.throws(() => normalizePrefs({ minCalories: 'lots' }), ValidationError);
  assert.throws(() => normalizePrefs({ minCalories: 800, maxCalories: 400 }), ValidationError);
  assert.equal(normalizePrefs({}).minCalories, null);
});
