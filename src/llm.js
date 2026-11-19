// Optional LLM layer. The rule-based planner in planner.js works without it.
//
// Pattern to follow: the LLM only SUGGESTS, your code VERIFIES.
//   1. buildPrompt()       -> text to send to whichever LLM API your group picks
//   2. JSON.parse(reply)   -> wrap in try/catch, models sometimes return broken JSON
//   3. validateLlmPlan()   -> reject plans that use ingredients the shop does not have

import { applyDiscounts } from './discounts.js';

export function buildPrompt({ stock, prefs, today = new Date() }) {
  const available = applyDiscounts(stock, today)
    .map((item) => {
      const price = (item.salePriceCents / 100).toFixed(2);
      const deal = item.discountRate > 0 ? `, ${Math.round(item.discountRate * 100)}% off` : '';
      return `- ${item.name} (EUR ${price}${deal})`;
    })
    .join('\n');

  return [
    'You are a meal planner for a grocery shop.',
    'Use ONLY ingredients from this list, and prefer the ones that are discounted:',
    available,
    '',
    `Customer wants ${prefs.days} dinners. Diet: ${prefs.diet}.`,
    prefs.exclude.length > 0 ? `Never use: ${prefs.exclude.join(', ')}.` : '',
    '',
    'Reply with JSON only, in exactly this shape:',
    '{"days":[{"day":"Mon","meal":"name of the meal","ingredients":["ingredient from the list"]}]}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Check a parsed LLM reply against the real stock. Returns { valid, problems }. */
export function validateLlmPlan(plan, stock, today = new Date()) {
  if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) {
    return { valid: false, problems: ['Plan must contain a non-empty "days" array'] };
  }

  const problems = [];
  const available = new Set(applyDiscounts(stock, today).map((item) => item.name.toLowerCase()));

  plan.days.forEach((entry, index) => {
    const label = entry?.day ?? `entry ${index + 1}`;
    if (typeof entry?.meal !== 'string' || entry.meal.trim() === '') problems.push(`${label}: missing meal name`);
    if (!Array.isArray(entry?.ingredients) || entry.ingredients.length === 0) {
      problems.push(`${label}: missing ingredients`);
      return;
    }
    for (const name of entry.ingredients) {
      if (typeof name !== 'string' || !available.has(name.trim().toLowerCase())) {
        problems.push(`${label}: "${name}" is not in stock`);
      }
    }
  });

  return { valid: problems.length === 0, problems };
}
