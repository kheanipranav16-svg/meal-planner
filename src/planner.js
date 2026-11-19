// The "smart" part: rank recipes by how well they use discounted, in-stock
// ingredients, then pick one per day without ever planning more than is on the shelf.
// Pure functions only (no database, no HTTP), so it is easy to unit test.

import { applyDiscounts } from './discounts.js';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Diets a customer can ask for:
//   omnivore   = veg and non-veg, anything goes
//   vegetarian = vegetarian and vegan recipes
//   vegan      = vegan recipes only
//   nonveg     = only recipes that contain meat or fish
export const DIETS = ['omnivore', 'vegetarian', 'vegan', 'nonveg'];

// Lower number = stricter recipe. A vegan recipe is also fine for a vegetarian.
export const DIET_RANK = { vegan: 0, vegetarian: 1, omnivore: 2 };

// A recipe's score = money saved + a small bonus for every discounted ingredient
// (using up stock that is about to expire is good for the shop).
export const SCORING = { discountedIngredientBonusCents: 25 };

// Allowed calorie range per serving for a customer's limits.
export const CALORIE_LIMITS = { min: 100, max: 3000 };

// Words a customer may use that do not literally appear in a product name.
export const EXCLUDE_SYNONYMS = {
  fish: ['salmon'],
  seafood: ['salmon'],
  dairy: ['mozzarella', 'cheddar', 'yoghurt'],
  cheese: ['mozzarella', 'cheddar'],
};

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const rankOf = (diet) => (Object.hasOwn(DIET_RANK, diet) ? DIET_RANK[diet] : DIET_RANK.omnivore);

export function fitsDiet(recipeDiet, wantedDiet) {
  if (wantedDiet === 'nonveg') return recipeDiet === 'omnivore';
  return rankOf(recipeDiet) <= rankOf(wantedDiet);
}

export function expandExclusions(words = []) {
  return words.flatMap((word) => [word, ...(Object.hasOwn(EXCLUDE_SYNONYMS, word) ? EXCLUDE_SYNONYMS[word] : [])]);
}

function readCalories(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const kcal = Number(value);
  if (!Number.isFinite(kcal) || kcal < CALORIE_LIMITS.min || kcal > CALORIE_LIMITS.max) {
    throw new ValidationError(`${name} must be a number from ${CALORIE_LIMITS.min} to ${CALORIE_LIMITS.max} (kcal per serving)`);
  }
  return Math.round(kcal);
}

/** Validate and clean customer input. Throws ValidationError with a readable message. */
export function normalizePrefs(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Preferences must be a JSON object');
  }

  const days = raw.days === undefined ? 5 : Number(raw.days);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new ValidationError('days must be a whole number from 1 to 7');
  }

  const diet = raw.diet ?? 'omnivore';
  if (!DIETS.includes(diet)) {
    throw new ValidationError(`diet must be one of: ${DIETS.join(', ')}`);
  }

  let budgetCents = Infinity;
  if (raw.budgetEuros !== undefined && raw.budgetEuros !== null && raw.budgetEuros !== '') {
    const euros = Number(raw.budgetEuros);
    if (!Number.isFinite(euros) || euros <= 0) throw new ValidationError('budgetEuros must be a positive number');
    budgetCents = Math.round(euros * 100);
  }

  const excludeRaw = raw.exclude ?? [];
  if (!Array.isArray(excludeRaw) || excludeRaw.length > 20 || !excludeRaw.every((x) => typeof x === 'string')) {
    throw new ValidationError('exclude must be a list of up to 20 words');
  }
  const exclude = excludeRaw.map((x) => x.trim().toLowerCase()).filter(Boolean);

  const minCalories = readCalories(raw.minCalories, 'minCalories');
  const maxCalories = readCalories(raw.maxCalories, 'maxCalories');
  if (minCalories !== null && maxCalories !== null && minCalories > maxCalories) {
    throw new ValidationError('minCalories cannot be higher than maxCalories');
  }

  return { days, diet, budgetCents, exclude, minCalories, maxCalories };
}

/** Index today's sellable stock by product id, and track what is still unplanned. */
function prepareStock(stock, today) {
  const sellable = applyDiscounts(stock, today);
  return {
    stockById: new Map(sellable.map((item) => [item.productId, item])),
    remaining: new Map(sellable.map((item) => [item.productId, item.quantity])),
  };
}

/**
 * Cost, calories and score of one recipe against the stock that is still unplanned.
 * Returns null when the recipe cannot be made (ingredient missing or too little left).
 */
export function evaluateRecipe(recipe, stockById, remaining) {
  const lines = [];
  let fullCostCents = 0;
  let costCents = 0;
  let totalKcal = 0;
  let discountedCount = 0;

  for (const need of recipe.ingredients) {
    const item = stockById.get(need.productId);
    if (!item || (remaining.get(need.productId) ?? 0) < need.amount) return null;

    fullCostCents += item.priceCents * need.amount;
    costCents += item.salePriceCents * need.amount;
    totalKcal += (item.kcal ?? 0) * need.amount;
    if (item.discountRate > 0) discountedCount += 1;

    lines.push({
      productId: need.productId,
      name: item.name,
      unit: item.unit,
      amount: need.amount,
      unitPriceCents: item.priceCents,
      salePriceCents: item.salePriceCents,
      discountRate: item.discountRate,
      discountReason: item.discountReason,
      kcal: item.kcal ?? 0,
    });
  }

  const servings = recipe.servings ?? 1;
  const savingsCents = fullCostCents - costCents;
  return {
    recipe,
    ingredients: lines,
    servings,
    caloriesPerServing: Math.round(totalKcal / servings),
    fullCostCents,
    costCents,
    savingsCents,
    discountedCount,
    score: savingsCents + discountedCount * SCORING.discountedIngredientBonusCents,
  };
}

/** Filter by diet, excluded words and calorie range, evaluate, and sort best-first. */
export function rankRecipes(recipes, stockById, remaining, prefs = {}) {
  const exclude = expandExclusions(prefs.exclude ?? []);
  const { minCalories, maxCalories } = prefs;
  return recipes
    .filter((recipe) => fitsDiet(recipe.diet, prefs.diet))
    .filter((recipe) => !recipe.ingredients.some((i) => exclude.some((word) => i.name.toLowerCase().includes(word))))
    .map((recipe) => evaluateRecipe(recipe, stockById, remaining))
    .filter(Boolean)
    .filter((c) => (minCalories == null || c.caloriesPerServing >= minCalories) && (maxCalories == null || c.caloriesPerServing <= maxCalories))
    .sort((a, b) => b.score - a.score || a.costCents - b.costCents || a.recipe.name.localeCompare(b.recipe.name));
}

/** All makeable recipes, best first (used by GET /api/recipes). */
export function listRankedRecipes({ recipes, stock, prefs = normalizePrefs(), today = new Date() }) {
  const { stockById, remaining } = prepareStock(stock, today);
  return rankRecipes(recipes, stockById, remaining, prefs).map(({ recipe, ...rest }) => ({
    id: recipe.id,
    name: recipe.name,
    diet: recipe.diet,
    ...rest,
  }));
}

/**
 * Greedy planner: for each day take the best-scoring recipe that is not used yet,
 * fits the remaining budget and can still be made from what is left on the shelf.
 * Stock is reduced after every pick, so the plan never over-sells an ingredient.
 */
export function buildMealPlan({ recipes, stock, prefs = normalizePrefs(), today = new Date() }) {
  const { stockById, remaining } = prepareStock(stock, today);
  const used = new Set();
  const shopping = new Map();
  const meals = [];
  let costCents = 0;
  let fullCostCents = 0;

  for (let i = 0; i < prefs.days; i += 1) {
    const day = DAY_NAMES[i];
    const candidates = rankRecipes(recipes, stockById, remaining, prefs).filter((c) => !used.has(c.recipe.id));
    const pick = candidates.find((c) => costCents + c.costCents <= prefs.budgetCents);

    if (!pick) {
      meals.push({
        day,
        recipe: null,
        note:
          candidates.length > 0
            ? 'Nothing left that fits the budget.'
            : 'No more matching recipes can be made from current stock.',
      });
      continue;
    }

    used.add(pick.recipe.id);
    costCents += pick.costCents;
    fullCostCents += pick.fullCostCents;

    for (const line of pick.ingredients) {
      remaining.set(line.productId, remaining.get(line.productId) - line.amount);
      const entry = shopping.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        unit: line.unit,
        quantity: 0,
        unitPriceCents: line.unitPriceCents,
        salePriceCents: line.salePriceCents,
        discountRate: line.discountRate,
        totalCents: 0,
      };
      entry.quantity += line.amount;
      entry.totalCents += line.salePriceCents * line.amount;
      shopping.set(line.productId, entry);
    }

    meals.push({
      day,
      recipe: {
        id: pick.recipe.id,
        name: pick.recipe.name,
        diet: pick.recipe.diet,
        instructions: pick.recipe.instructions,
      },
      ingredients: pick.ingredients,
      servings: pick.servings,
      caloriesPerServing: pick.caloriesPerServing,
      costCents: pick.costCents,
      fullCostCents: pick.fullCostCents,
      savingsCents: pick.savingsCents,
    });
  }

  const planned = meals.filter((m) => m.recipe);
  const avgCaloriesPerServing = planned.length
    ? Math.round(planned.reduce((sum, m) => sum + m.caloriesPerServing, 0) / planned.length)
    : 0;

  return {
    meals,
    totals: { costCents, fullCostCents, savingsCents: fullCostCents - costCents, avgCaloriesPerServing },
    shoppingList: [...shopping.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
