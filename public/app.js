// Frontend: sends the form to the API and renders the JSON that comes back.
// Elements are built with textContent / append(), never innerHTML, so data from
// the server can never inject HTML or scripts into the page.

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const money = (cents) => euro.format(cents / 100);
const percent = (rate) => `-${Math.round(rate * 100)}%`;

const form = document.querySelector('#plan-form');
const submitButton = document.querySelector('#submit');
const errorBox = document.querySelector('#error');
const results = document.querySelector('#results');
const dealsList = document.querySelector('#deals');

/** Tiny helper: el('p', { class: 'x' }, 'text', otherElement) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

export async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

function priceTag(unitCents, saleCents, rate) {
  if (rate === 0) return el('span', { class: 'price' }, money(unitCents));
  return el(
    'span',
    { class: 'price' },
    el('s', {}, money(unitCents)),
    ' ',
    money(saleCents),
    ' ',
    el('span', { class: 'badge deal' }, percent(rate)),
  );
}

function renderMeal(meal) {
  if (!meal.recipe) {
    return el('article', { class: 'card empty' }, el('span', { class: 'day' }, meal.day), el('p', {}, meal.note));
  }
  return el(
    'article',
    { class: 'card' },
    el(
      'header',
      {},
      el('span', { class: 'day' }, meal.day),
      el('h3', {}, meal.recipe.name),
      el('span', { class: 'badge' }, meal.recipe.diet === 'omnivore' ? 'non-veg' : meal.recipe.diet),
      el('span', { class: 'badge kcal' }, `${meal.caloriesPerServing} kcal each · serves ${meal.servings}`),
    ),
    el(
      'ul',
      { class: 'ingredients' },
      meal.ingredients.map((item) =>
        el(
          'li',
          {},
          el('span', {}, `${item.amount} × ${item.name} `, el('small', {}, `(${item.unit})`)),
          priceTag(item.unitPriceCents, item.salePriceCents, item.discountRate),
        ),
      ),
    ),
    el(
      'p',
      { class: 'cost' },
      `Cost ${money(meal.costCents)}`,
      meal.savingsCents > 0 ? el('span', { class: 'save' }, ` · saves ${money(meal.savingsCents)}`) : null,
    ),
    el('details', {}, el('summary', {}, 'How to cook'), el('p', {}, meal.recipe.instructions)),
  );
}

export function renderPlan(plan) {
  const { totals } = plan;
  const savedPercent = totals.fullCostCents > 0 ? Math.round((totals.savingsCents / totals.fullCostCents) * 100) : 0;

  results.replaceChildren(
    el('h2', {}, 'Your plan'),
    el(
      'p',
      { class: 'summary' },
      `Total ${money(totals.costCents)} · you save ${money(totals.savingsCents)} (${savedPercent}%) · avg ${totals.avgCaloriesPerServing} kcal per serving`,
    ),
    el('div', { class: 'meal-grid' }, plan.meals.map(renderMeal)),
    el('h3', {}, 'Shopping list'),
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Item'), el('th', {}, 'Qty'), el('th', {}, 'Price'), el('th', {}, 'Total'))),
      el(
        'tbody',
        {},
        plan.shoppingList.map((item) =>
          el(
            'tr',
            {},
            el('td', {}, item.name),
            el('td', {}, String(item.quantity)),
            el('td', {}, priceTag(item.unitPriceCents, item.salePriceCents, item.discountRate)),
            el('td', {}, money(item.totalCents)),
          ),
        ),
      ),
    ),
  );
  results.hidden = false;
}

async function loadDeals() {
  try {
    const deals = await api('/api/products?discounted=true');
    if (deals.length === 0) {
      dealsList.replaceChildren(el('li', {}, 'No deals today.'));
      return;
    }
    dealsList.replaceChildren(
      ...deals.map((deal) =>
        el(
          'li',
          {},
          el('span', {}, deal.name, ' ', el('small', {}, deal.discountReason)),
          priceTag(deal.priceCents, deal.salePriceCents, deal.discountRate),
        ),
      ),
    );
  } catch (error) {
    dealsList.replaceChildren(el('li', { class: 'error' }, `Could not load deals: ${error.message}`));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const body = {
    days: Number(data.get('days')),
    diet: data.get('diet'),
    exclude: String(data.get('exclude'))
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean),
  };
  if (data.get('budget')) body.budgetEuros = Number(data.get('budget'));
  if (data.get('maxCalories')) body.maxCalories = Number(data.get('maxCalories'));

  errorBox.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Planning…';
  try {
    renderPlan(
      await api('/api/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Create plan';
  }
});

loadDeals();
