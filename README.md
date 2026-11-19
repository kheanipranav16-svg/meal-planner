# Fresh Planner

Meal planner for grocery shop customers. It reads the shop's current stock, gives
discounts on ingredients that need to be sold (about to expire, or overstocked), and
builds a meal plan that uses those ingredients first.

Written in JavaScript with **zero dependencies**: Node's built-in `http` server and
`node:sqlite` database. Needs **Node 22.13 or newer**.

## Run it

```bash
npm run seed    # create/reset the database with demo data (expiry dates counted from today)
npm start       # http://localhost:3000
npm test        # unit tests + end-to-end API test
```

`npm run dev` restarts the server when you edit a file. Run `npm run seed` again before
a demo so the "expires tomorrow" items are fresh.

## How a request flows

```
Browser form --POST /api/meal-plan--> server.js
                                        |  getStock() / getRecipes()     (db.js, SQL)
                                        |  applyDiscounts()              (discounts.js, rules)
                                        |  buildMealPlan()               (planner.js, ranking)
Browser renders the JSON <------------- |
```

## Files

| File | Responsibility | Good for a teammate to own |
|---|---|---|
| `src/db.js`, `src/seed-data.js` | Tables, SQL queries, demo products/stock/recipes | Database + data |
| `src/server.js` | API routes, input errors, static files | Backend |
| `src/discounts.js`, `src/dates.js` | Discount rules | Backend |
| `src/planner.js` | Recipe scoring and the day-by-day planner | AI / planning logic |
| `src/chat.js` | The chatbot: understands a message, remembers preferences, writes the reply | AI / planning logic |
| `src/llm-client.js` | Optional AI call that reads free-form messages (needs an API key) | AI / planning logic |
| `src/llm.js` | Prompt builder + validator for an LLM that writes whole plans (alternative idea) | AI / planning logic |
| `public/` | HTML, CSS, JS frontend | Frontend |
| `test/` | Tests (`node --test`) | Everyone |

## API (agree on this with your group first)

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /api/health` | | `{ ok: true }` |
| `GET /api/products` | `?discounted=true` (optional) | Sellable stock with `discountRate`, `discountReason`, `salePriceCents` |
| `GET /api/recipes` | `?diet=vegan\|vegetarian\|omnivore` | Makeable recipes, best value first |
| `POST /api/meal-plan` | `{ days: 1-7, diet, budgetEuros, exclude: [], minCalories, maxCalories }` (calories are per serving) | `{ meals, totals, shoppingList }` |
| `POST /api/chat` | `{ message, state }` (send back the `state` you received last time) | `{ reply, state, plan }` (`plan` is `null` unless one was built) |

`diet` is one of `omnivore` (veg and non-veg), `vegetarian`, `vegan` or `nonveg` (only meat/fish dishes).

All money is in **cents** (integers) to avoid floating-point rounding errors; the
frontend formats it as euros.

## Discount rules (`src/discounts.js`)

| Situation | Discount |
|---|---|
| Expires today or tomorrow | 50% |
| Expires in 2-3 days | 30% |
| More than 100 units in stock | 15% |
| Expired or sold out | not sold at all |

Discounts do not stack: the biggest one wins. Change the numbers in `RULES`.

## How the planner decides (`src/planner.js`)

1. Drop recipes that break the diet, contain an excluded word, or lack an ingredient.
2. Score each recipe: `euros saved by discounts + 25 cents per discounted ingredient`.
3. For each day, take the best-scoring recipe not used yet that still fits the budget.
4. Subtract the ingredients from the remaining stock, so nothing is planned twice over.

This is a greedy algorithm: simple and fast, but not guaranteed to find the cheapest
possible plan. That is a nice limitation to discuss in your report.

## Adding the LLM (optional extension)

`src/llm.js` already contains the two parts that matter:

- `buildPrompt()`: lists only sellable ingredients plus the customer's wishes.
- `validateLlmPlan()`: checks that every ingredient the LLM names is really in stock.

You still need to send the prompt to the API your course allows, `JSON.parse` the reply
inside a `try/catch`, and run `validateLlmPlan()` on it. If validation fails, fall back to
`buildMealPlan()`. Keep the API key in an environment variable (`.env` is git-ignored),
never in the code. The rule: **the LLM suggests, your code verifies.**

## Running it in Visual Studio Code

1. Install Node.js 22.13 or newer from nodejs.org (check with `node -v` in a terminal).
2. In VS Code choose **File > Open Folder** and pick this `meal-planner` folder.
3. Open the built-in terminal (**Terminal > New Terminal**) and run:
   ```bash
   npm run seed
   npm start
   ```
4. Open http://localhost:3000 in your browser. Run `npm test` to check everything works.

## The chatbot (`src/chat.js`)

The customer types normal sentences; the bot keeps their preferences and builds a plan.

| They say | The bot understands |
|---|---|
| "3 vegetarian dinners under 600 calories" | 3 days, vegetarian, max 600 kcal per serving |
| "5 days non-veg, 1800 calories a day, budget 30" | non-veg only, dinner target 35% of 1800 = 630 kcal (shown as 500-760), budget €30 |
| "veg and non veg, around 500 kcal" | anything goes, 400-600 kcal |
| "no tofu", "allergic to peanuts", "no fish" | leaves those ingredients out (`fish` also removes salmon) |
| "no meat" | vegetarian |
| "remove the budget", "no calorie limit", "start over" | drops that preference / everything |
| "show today's deals" | lists the biggest discounts |

How it stays "personal": the server keeps no sessions. Every reply contains a small `state`
object (diet, calories, budget, exclusions); the browser stores it in `localStorage` and
sends it back with the next message, so the bot remembers the customer even after a reload.

**Calories.** Each product has `kcal` per unit as sold; a recipe's calories per serving is the
sum over its ingredients divided by `servings`. A daily target is converted to dinner using
`DINNER_SHARE` (35%) in `chat.js`. These numbers are rough demo values, not nutrition advice.

**Two ways to understand a message**, both producing the same validated "patch":

1. Built-in rules (`parseMessage`): always on, free, predictable, easy to test.
2. AI (`src/llm-client.js`): handles free-form wording ("hold the tofu, my sister is vegan").
   Turn it on by copying `.env.example` to `.env` and filling in `LLM_API_KEY`, then restart.
   If the API call fails, the bot falls back to the rules automatically.

The AI only extracts preferences. Everything it returns goes through `patchFromLlmJson()`,
which drops invalid values, and prices, stock, discounts and recipes always come from your
database and code. Say this in your report: *the AI understands, the code decides.*

## Ideas to extend

- `POST /api/admin/stock` so the shop can update quantities and expiry dates (use `UPDATE`).
- Several batches per product with different expiry dates (needs an `inventory` table keyed by batch).
- User accounts and saved plans.
- Allergies, per-serving amounts and household size.
- Using Express instead of `node:http`: each entry in the `routes` table in `server.js`
  becomes `app.get(path, ...)` / `app.post(path, ...)`.

## Notes on the code

- SQL uses prepared statements (`?` placeholders), never string concatenation, which prevents SQL injection.
- The frontend builds the page with `textContent`/`append`, never `innerHTML`, which prevents XSS.
- Dates are whole calendar days (`YYYY-MM-DD`), so time zones cannot shift a discount by a day.
