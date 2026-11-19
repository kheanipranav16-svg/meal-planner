// Chat layer: turns a sentence like "3 vegetarian dinners under 600 calories, no tofu"
// into preferences, remembers them in `state`, and builds a plan with planner.js.
//
// The server stays stateless: the browser sends `state` back with every message and
// stores the returned one (in localStorage), which is what makes the bot "personal".
//
// Understanding the message can be done by:
//   1. parseMessage()   built-in rules, always available, no API key needed
//   2. llm.extract()    optional AI call (src/llm-client.js) for free-form wording
// Either way the result is a "patch" that is validated before it touches the state,
// so the AI can only ever change preferences, never prices, stock or discounts.

import { applyDiscounts } from './discounts.js';
import { CALORIE_LIMITS, DIETS, ValidationError, buildMealPlan, normalizePrefs } from './planner.js';

export const DINNER_SHARE = 0.35; // a daily calorie target is turned into a dinner target
export const CALORIE_WINDOW = 0.2; // "around 500 kcal" means 400-600
export const MAX_MESSAGE_LENGTH = 500;

const DIET_LABEL = { omnivore: 'veg and non-veg', vegetarian: 'vegetarian', vegan: 'vegan', nonveg: 'non-veg' };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const INTENTS = ['plan', 'deals', 'help', 'reset', 'other'];
const CLEARABLE = { budget: ['budgetEuros'], budgetEuros: ['budgetEuros'], calories: ['minCalories', 'maxCalories'], exclude: ['exclude'] };

const eur = (cents) => `€${(cents / 100).toFixed(2)}`;
const round10 = (n) => Math.round(n / 10) * 10;
const inRange = (kcal) => kcal >= CALORIE_LIMITS.min && kcal <= CALORIE_LIMITS.max;
const formatEuros = (euros) => (Number.isInteger(euros) ? String(euros) : euros.toFixed(2));

export function calorieWindow(target) {
  return {
    minCalories: round10(target * (1 - CALORIE_WINDOW)),
    maxCalories: round10(target * (1 + CALORIE_WINDOW)),
  };
}

function dailyToWindow(daily, notes) {
  const target = Math.round(daily * DINNER_SHARE);
  if (!inRange(target)) {
    notes.push(`I couldn't use ${daily} kcal a day (please give a number between 300 and 8500).`);
    return {};
  }
  const window = calorieWindow(target);
  notes.push(
    `${daily} kcal a day is roughly ${target} kcal for dinner (about ${Math.round(DINNER_SHARE * 100)}% of the day), ` +
      `so I'm aiming for ${window.minCalories}-${window.maxCalories} kcal per serving.`,
  );
  return window;
}

function singular(word) {
  if (/oes$/.test(word)) return word.slice(0, -2); // tomatoes -> tomato
  if (/(?<!s)s$/.test(word) && word.length > 3) return word.slice(0, -1); // onions -> onion
  return word;
}

// ---------------------------------------------------------------------------
// Built-in rule-based parser
// ---------------------------------------------------------------------------

function parseDays(text, notes) {
  // "3 days", "3 vegetarian dinners", "four non-veg meals". Up to two words may sit between the
  // number and "days/dinners/meals", but never a calorie or money unit ("50 calories a day").
  const between = '(?:(?!kcal|cals?\\b|calories?|euros?|eur\\b)[a-z-]+\\s+){0,2}';
  const target = '(?:days?|dinners?|meals?)\\b';
  const wordNumber = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s+${between}${target}`).exec(text);
  const digits = new RegExp(`\\b(\\d{1,2})\\s*-?\\s*${between}${target}`).exec(text);
  let days = null;
  if (digits) days = Number(digits[1]);
  else if (wordNumber) days = NUMBER_WORDS[wordNumber[1]];
  else if (/\b(?:a|one|the|whole|full|next)\s+week\b|\bweekly\b|\bfor the week\b/.test(text)) days = 7;
  else if (/\bweekend\b/.test(text)) days = 2;

  if (days === null || days < 1) return null;
  if (days > 7) {
    notes.push('I can plan up to 7 days at a time, so I used 7.');
    return 7;
  }
  return days;
}

function parseDiet(text) {
  const nonVegWord = /\bnon[\s-]?veg(?:etarian)?\b/;
  const nonVeg = nonVegWord.test(text);
  const veg = /\bveg(?:etarian|gie|gies)?\b/.test(text.replace(new RegExp(nonVegWord, 'g'), ' '));

  if ((nonVeg && veg) || /\b(?:anything|everything|no restrictions?|any diet)\b/.test(text)) return 'omnivore';
  if (/\bvegan\b/.test(text)) return 'vegan';
  if (nonVeg) return 'nonveg';
  if (/\b(?:no|without|avoid|skip|zero)\s+(?:any\s+)?(?:meat|fish)\b/.test(text)) return 'vegetarian';
  if (veg) return 'vegetarian';
  if (/\b(?:meat lover|carnivore|meaty)\b/.test(text)) return 'nonveg';
  return null;
}

const UNIT = '(?:kcal|kcals|cals?|calories?)';
const NOT_MONEY = '(?!\\s*(?:€|eur|euros?|days?|people|persons?))';

export function parseCalories(text, notes) {
  // "1800 calories a day" / "daily calories 2000": convert to a dinner target.
  const perDay =
    new RegExp(`(\\d{3,4})\\s*${UNIT}\\s*(?:(?:a|per|each|every|/)\\s*day|daily)\\b`).exec(text) ??
    new RegExp(`daily\\s*${UNIT}\\s*(?:target|goal|intake|limit)?\\s*(?:of|is|:|=)?\\s*(\\d{3,4})`).exec(text);
  if (perDay) return dailyToWindow(Number(perDay[1]), notes);

  const range = new RegExp(`(\\d{2,4})\\s*(?:-|–|to)\\s*(\\d{2,4})\\s*${UNIT}\\b`).exec(text);
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    if (inRange(low) && inRange(high)) return { minCalories: low, maxCalories: high };
    notes.push(`Please use calorie numbers between ${CALORIE_LIMITS.min} and ${CALORIE_LIMITS.max} per serving.`);
    return {};
  }

  const result = {};
  const hasCalorieWord = new RegExp(`\\b${UNIT}\\b`).test(text);

  if (hasCalorieWord) {
    const number = `(\\d{2,4})(\\s*${UNIT}\\b)?${NOT_MONEY}`;
    const take = (regex, key) => {
      const match = regex.exec(text);
      if (!match) return;
      const kcal = Number(match[1]);
      if (inRange(kcal)) result[key] = kcal;
      else if (match[2]) notes.push(`I ignored ${kcal} kcal: please use a number from ${CALORIE_LIMITS.min} to ${CALORIE_LIMITS.max} per serving.`);
    };
    const upper = '(?:under|below|less than|fewer than|max(?:imum)?(?: of)?|at most|up to|no more than|not more than|within|<=?)';
    const lower = '(?:over|above|more than|at least|min(?:imum)?(?: of)?|>=?)';
    take(new RegExp(`${upper}\\s*${number}`), 'maxCalories');
    take(new RegExp(`${UNIT}\\s*(?:per (?:meal|serving|portion)\\s*)?${upper}\\s*${number}`), 'maxCalories');
    take(new RegExp(`${lower}\\s*${number}`), 'minCalories');
    take(new RegExp(`${UNIT}\\s*(?:per (?:meal|serving|portion)\\s*)?${lower}\\s*${number}`), 'minCalories');

    if (result.minCalories === undefined && result.maxCalories === undefined) {
      const target =
        new RegExp(`(?:around|about|roughly|approximately|approx\\.?|circa|~)\\s*(\\d{2,4})`).exec(text) ??
        new RegExp(`(\\d{2,4})\\s*${UNIT}\\b`).exec(text) ??
        new RegExp(`${UNIT}\\s*(?:target|goal)?\\s*(?:of|:|=)\\s*(\\d{2,4})`).exec(text);
      if (target) {
        const kcal = Number(target[1]);
        if (inRange(kcal)) {
          Object.assign(result, calorieWindow(kcal));
        } else {
          notes.push(`I ignored ${kcal} kcal: please use a number from ${CALORIE_LIMITS.min} to ${CALORIE_LIMITS.max} per serving.`);
        }
      }
    }
  }

  if (result.minCalories === undefined && result.maxCalories === undefined) {
    if (/\b(?:low[- ]?cal(?:orie)?s?|light meals?)\b/.test(text)) {
      result.maxCalories = 450;
      notes.push("Low calorie: I'll keep it to 450 kcal per serving or less.");
    } else if (/\b(?:high[- ]?cal(?:orie)?s?|hearty|filling|bulking)\b/.test(text)) {
      result.minCalories = 700;
      notes.push("High calorie: I'll look for 700 kcal per serving or more.");
    }
  }
  return result;
}

function parseBudget(text) {
  const patterns = [
    /(?:€|\beur\b)\s*(\d+(?:[.,]\d+)?)/,
    /(\d+(?:[.,]\d+)?)\s*(?:€|euros?|\beur\b)/,
    /budget\s*(?:of|is|:|=)?\s*(?:about|around|max|maximum)?\s*(\d+(?:[.,]\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const euros = Number(match[1].replace(',', '.'));
      if (euros > 0) return euros;
    }
  }
  return null;
}

const CUT_WORDS =
  'for|with|under|over|below|above|around|about|budget|please|but|i|in|per|at|so|that|then|using|use|make|plan|give|show|calories?|kcal|days?|weeks?|meals?|dinners?|vegan|vegetarian|veg|non|no|without|avoid|avoiding|skip|exclude|excluding|allergic|allergy|hate';
const EXCLUDE_RE = new RegExp(
  `\\b(?:no|without|avoid(?:ing)?|skip|exclude|excluding|allergic to|allergy to|can'?t eat|cannot eat|don'?t like|do not like|hate|not a fan of)\\s+(?:any\\s+|the\\s+|all\\s+)?([a-z][a-z ,&'-]*?)(?=\\s+(?:${CUT_WORDS})\\b|[^a-z ,&'-]|$)`,
  'g',
);
const SKIP_TOKENS = new Set([
  'budget', 'calorie', 'calories', 'kcal', 'limit', 'limits', 'meat', 'restriction', 'restrictions',
  'preference', 'preferences', 'problem', 'worries', 'worry', 'more', 'less', 'thanks', 'thank', 'you',
  'it', 'that', 'this', 'one', 'other', 'any',
]);

function parseExclusions(text) {
  const found = [];
  for (const match of text.matchAll(EXCLUDE_RE)) {
    for (const rawItem of match[1].split(/\s*(?:,|&|\band\b|\bor\b)\s*/)) {
      const item = rawItem.replace(/^(?:any|some)\s+/, '').trim();
      const tokens = item.split(/\s+/);
      if (!item || tokens.length > 3 || tokens.some((t) => SKIP_TOKENS.has(t))) continue;
      found.push(item.replace(/\w+$/, singular));
    }
  }
  return [...new Set(found)];
}

function parseClear(text) {
  const verb = '(?:no|remove|drop|forget|without|ignore|skip)';
  const clear = [];
  if (new RegExp(`\\b${verb}\\s+(?:the\\s+|my\\s+|any\\s+)?budget\\b`).test(text) || /\bunlimited budget\b/.test(text)) {
    clear.push('budgetEuros');
  }
  if (new RegExp(`\\b${verb}\\s+(?:the\\s+|my\\s+|any\\s+)?calories?(?:\\s*(?:limit|target|goal|count|restriction)s?)?\\b`).test(text)) {
    clear.push('minCalories', 'maxCalories');
  }
  if (/\b(?:clear|remove|forget|reset)\s+(?:my\s+|the\s+|all\s+)?(?:exclusions?|allergies|dislikes)\b/.test(text)) {
    clear.push('exclude');
  }
  return clear;
}

export function hasChanges(patch) {
  return (
    ['days', 'diet', 'minCalories', 'maxCalories', 'budgetEuros'].some((key) => patch[key] !== undefined) ||
    (patch.addExclude?.length ?? 0) > 0 ||
    (patch.clear?.length ?? 0) > 0
  );
}

/**
 * Rule-based understanding of one message.
 * Returns a patch: { intent, reset, days?, diet?, minCalories?, maxCalories?, budgetEuros?, addExclude?, clear?, notes }
 */
export function parseMessage(message) {
  const text = message.toLowerCase().replace(/[’‘]/g, "'");
  const notes = [];
  const patch = { notes };

  const days = parseDays(text, notes);
  if (days) patch.days = days;
  const diet = parseDiet(text);
  if (diet) patch.diet = diet;
  Object.assign(patch, parseCalories(text, notes));
  const budget = parseBudget(text);
  if (budget) patch.budgetEuros = budget;
  const addExclude = parseExclusions(text);
  if (addExclude.length > 0) patch.addExclude = addExclude;
  const clear = parseClear(text);
  if (clear.length > 0) patch.clear = clear;

  const changed = hasChanges(patch);
  const reset = /\b(?:start over|start again|reset|clear (?:everything|all|my (?:preferences|profile|settings))|forget (?:everything|my preferences))\b/.test(text);
  const planWords = /\b(?:plan|plans|meals?|dinners?|lunch(?:es)?|recipes?|menu|eat|cook|cooking|suggest|recommend)\b/.test(text);
  const dealWords = /\b(?:deals?|discounts?|discounted|offers?|on sale|cheapest)\b/.test(text);
  const helpWords = /\b(?:help|what can you do|how (?:does|do) (?:this|you) work|options)\b|^\s*(?:hi|hello|hey|hoi|hallo|good (?:morning|afternoon|evening))\b/.test(text);
  const affirmative = /^\s*(?:yes|yeah|yep|ok(?:ay)?|sure|go|go ahead|do it|please|again|redo|another|try again|surprise me)\b/.test(text);

  patch.reset = reset;
  if (reset && !changed && !planWords) patch.intent = 'reset';
  else if (changed || planWords || affirmative) patch.intent = dealWords && !planWords && !changed ? 'deals' : 'plan';
  else if (dealWords) patch.intent = 'deals';
  else if (helpWords) patch.intent = 'help';
  else patch.intent = 'other';
  return patch;
}

// ---------------------------------------------------------------------------
// Checking what comes from outside (browser state, LLM output)
// ---------------------------------------------------------------------------

/** Keep only valid fields of the state the browser sent back. Never throws. */
export function sanitizeState(raw) {
  const state = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return state;

  if (Number.isInteger(raw.days) && raw.days >= 1 && raw.days <= 7) state.days = raw.days;
  if (DIETS.includes(raw.diet)) state.diet = raw.diet;
  if (typeof raw.budgetEuros === 'number' && Number.isFinite(raw.budgetEuros) && raw.budgetEuros > 0 && raw.budgetEuros <= 10000) {
    state.budgetEuros = raw.budgetEuros;
  }
  for (const key of ['minCalories', 'maxCalories']) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && inRange(raw[key])) state[key] = Math.round(raw[key]);
  }
  if (state.minCalories !== undefined && state.maxCalories !== undefined && state.minCalories > state.maxCalories) {
    delete state.minCalories;
  }
  if (Array.isArray(raw.exclude)) {
    const words = raw.exclude
      .filter((w) => typeof w === 'string')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0 && w.length <= 40);
    if (words.length > 0) state.exclude = [...new Set(words)].slice(0, 20);
  }
  return state;
}

/** Merge a patch into the state. Newer calorie limits win over older ones that contradict them. */
export function applyPatch(state, patch) {
  const next = patch.reset ? {} : { ...state };
  if (!patch.reset && state.exclude) next.exclude = [...state.exclude];

  for (const key of patch.clear ?? []) delete next[key];
  for (const key of ['days', 'diet', 'budgetEuros', 'minCalories', 'maxCalories']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.minCalories !== undefined && patch.maxCalories === undefined && next.maxCalories < next.minCalories) delete next.maxCalories;
  if (patch.maxCalories !== undefined && patch.minCalories === undefined && next.minCalories > next.maxCalories) delete next.minCalories;

  if (patch.addExclude?.length) next.exclude = [...new Set([...(next.exclude ?? []), ...patch.addExclude])].slice(0, 20);
  if (next.exclude?.length === 0) delete next.exclude;
  return next;
}

/**
 * Turn the JSON an LLM returned into a patch, accepting only values we can verify.
 * Anything unexpected is dropped, so a confused (or manipulated) model cannot do harm.
 */
export function patchFromLlmJson(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('LLM reply was not a JSON object');
  const notes = [];
  const patch = { notes };

  const days = Number(json.days);
  if (json.days != null && Number.isInteger(days) && days >= 1) {
    patch.days = Math.min(days, 7);
    if (days > 7) notes.push('I can plan up to 7 days at a time, so I used 7.');
  }
  if (typeof json.diet === 'string' && DIETS.includes(json.diet)) patch.diet = json.diet;

  const daily = Number(json.dailyCalories);
  if (json.dailyCalories != null && Number.isFinite(daily) && daily > 0) {
    Object.assign(patch, dailyToWindow(Math.round(daily), notes));
  } else {
    for (const [field, key] of [['minCaloriesPerServing', 'minCalories'], ['maxCaloriesPerServing', 'maxCalories']]) {
      const kcal = Number(json[field]);
      if (json[field] != null && Number.isFinite(kcal) && inRange(kcal)) patch[key] = Math.round(kcal);
    }
  }

  const euros = Number(json.budgetEuros);
  if (json.budgetEuros != null && Number.isFinite(euros) && euros > 0 && euros <= 10000) patch.budgetEuros = Math.round(euros * 100) / 100;

  if (Array.isArray(json.exclude)) {
    const words = json.exclude
      .filter((w) => typeof w === 'string')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-z][a-z' -]{0,38}$/.test(w) && w.split(/\s+/).length <= 3)
      .map((w) => w.replace(/\w+$/, singular));
    if (words.length > 0) patch.addExclude = [...new Set(words)].slice(0, 10);
  }
  if (Array.isArray(json.clear)) {
    const keys = json.clear.filter((k) => typeof k === 'string' && Object.hasOwn(CLEARABLE, k)).flatMap((k) => CLEARABLE[k]);
    if (keys.length > 0) patch.clear = [...new Set(keys)];
  }

  const changed = hasChanges(patch);
  let intent = INTENTS.includes(json.intent) ? json.intent : changed ? 'plan' : 'other';
  if (intent === 'other' && changed) intent = 'plan';
  patch.reset = intent === 'reset';
  if (patch.reset && changed) intent = 'plan';
  patch.intent = intent;
  return patch;
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export function describeState(state) {
  const parts = [DIET_LABEL[state.diet ?? 'omnivore']];
  if (state.minCalories && state.maxCalories) parts.push(`${state.minCalories}-${state.maxCalories} kcal per serving`);
  else if (state.maxCalories) parts.push(`up to ${state.maxCalories} kcal per serving`);
  else if (state.minCalories) parts.push(`at least ${state.minCalories} kcal per serving`);
  if (state.budgetEuros) parts.push(`budget €${formatEuros(state.budgetEuros)}`);
  if (state.exclude?.length) parts.push(`no ${state.exclude.join(', ')}`);
  return parts.join(' · ');
}

const HELP_REPLY = [
  "I plan dinners from what's in stock and on offer today. Tell me things like:",
  '• “3 vegetarian dinners under 600 calories”',
  '• “5 days non-veg, 1800 calories a day, budget €30”',
  '• “no tofu”, “remove the budget” or “show today’s deals”',
  'I remember your choices until you say “start over”.',
].join('\n');

function dealsReply(stock, today) {
  const deals = applyDiscounts(stock, today)
    .filter((item) => item.discountRate > 0)
    .sort((a, b) => b.discountRate - a.discountRate || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (deals.length === 0) return 'There are no discounts today.';
  const lines = deals.map(
    (d) => `• ${d.name}: ${Math.round(d.discountRate * 100)}% off, now ${eur(d.salePriceCents)} (${d.discountReason})`,
  );
  return `Today's best deals:\n${lines.join('\n')}\nSay “plan 3 dinners” and I'll build meals around them.`;
}

function planReply(plan, prefs, state, notes) {
  const lines = [`Here's your ${prefs.days}-day plan (${describeState(state)}).`, ...notes];
  for (const meal of plan.meals) {
    if (!meal.recipe) lines.push(`${meal.day}: ${meal.note}`);
    else {
      lines.push(
        `${meal.day}: ${meal.recipe.name}, serves ${meal.servings} · ${meal.caloriesPerServing} kcal each · ${eur(meal.costCents)}`,
      );
    }
  }
  const { totals } = plan;
  lines.push(
    `Total ${eur(totals.costCents)}${totals.savingsCents > 0 ? `, you save ${eur(totals.savingsCents)} on discounts` : ''}. ` +
      `Average ${totals.avgCaloriesPerServing} kcal per serving.`,
  );
  lines.push('Change anything by telling me, for example “no tofu”, “under 500 calories” or “start over”.');
  return lines.join('\n');
}

/**
 * Handle one chat message.
 * @param body  { message: string, state?: object } from the browser
 * @param llm   optional object with extract(message, state) -> patch (see llm-client.js)
 * @returns     { reply, state, plan } where plan is null unless a plan was built
 */
export async function handleChat({ body, recipes, stock, today = new Date(), llm = null, log = console.warn }) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) throw new ValidationError('message must be a non-empty string');
  if (message.length > MAX_MESSAGE_LENGTH) throw new ValidationError(`message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);

  const previous = sanitizeState(body.state);
  let patch = null;
  if (llm) {
    try {
      patch = await llm.extract(message, previous);
    } catch (error) {
      log(`AI parser unavailable, using built-in rules: ${error.message}`);
    }
  }
  patch ??= parseMessage(message);

  const state = applyPatch(previous, patch);
  const notes = patch.notes ?? [];

  if (patch.intent === 'help') return { reply: HELP_REPLY, state, plan: null };
  if (patch.intent === 'deals') return { reply: dealsReply(stock, today), state, plan: null };
  if (patch.intent === 'reset') return { reply: 'Done, I cleared your preferences. What would you like to eat?', state, plan: null };
  if (patch.intent === 'other') {
    return {
      reply: "I didn't catch a preference there. Try “3 vegetarian dinners under 600 calories”, or say “help”.",
      state,
      plan: null,
    };
  }

  const prefs = normalizePrefs(state);
  const plan = buildMealPlan({ recipes, stock, prefs, today });
  if (!plan.meals.some((m) => m.recipe)) {
    return {
      reply: [
        `I couldn't find any recipe for (${describeState(state)}) with today's stock.`,
        ...notes,
        'Try a wider calorie range, a bigger budget, or a different diet.',
      ].join('\n'),
      state,
      plan: null,
    };
  }
  return { reply: planReply(plan, prefs, state, notes), state, plan };
}
