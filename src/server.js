// HTTP layer: JSON API under /api plus static files from /public.
// Built on Node's own `http` module. The routes table below maps 1:1 onto
// Express routes if your group prefers Express (see README).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { getRecipes, getStock } from './db.js';
import { applyDiscounts } from './discounts.js';
import { ValidationError, buildMealPlan, listRankedRecipes, normalizePrefs } from './planner.js';
import { handleChat } from './chat.js';

const PUBLIC_DIR = resolve(import.meta.dirname, '..', 'public');
const MAX_BODY_BYTES = 100_000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(json);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ValidationError('Request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

async function serveStatic(res, pathname) {
  let relative;
  try {
    relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    return sendJson(res, 400, { error: 'Bad request path' });
  }

  const file = resolve(PUBLIC_DIR, relative);
  // Never serve anything outside /public (blocks ../ path traversal).
  if (!file.startsWith(PUBLIC_DIR + sep)) return sendJson(res, 404, { error: 'Not found' });

  try {
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

/**
 * @param db   an open database from openDb()
 * @param now  function returning "today" (tests pass a fixed date)
 * @param llm  optional AI message parser from createLlm(); without it the chat uses built-in rules
 */
export function createServer(db, { now = () => new Date(), llm = null } = {}) {
  // path -> { METHOD: handler }. A handler returns data that is sent as JSON.
  const routes = {
    '/api/health': {
      GET: () => ({ ok: true }),
    },

    // Sellable products with discounts. ?discounted=true keeps only the deals.
    '/api/products': {
      GET: ({ url }) => {
        const onlyDeals = url.searchParams.get('discounted') === 'true';
        return applyDiscounts(getStock(db), now())
          .filter((item) => !onlyDeals || item.discountRate > 0)
          .sort((a, b) => b.discountRate - a.discountRate || a.name.localeCompare(b.name));
      },
    },

    // Every recipe that can be made right now, best value first. ?diet=vegan|vegetarian|omnivore
    '/api/recipes': {
      GET: ({ url }) => {
        const prefs = normalizePrefs({ diet: url.searchParams.get('diet') ?? undefined });
        return listRankedRecipes({ recipes: getRecipes(db), stock: getStock(db), prefs, today: now() });
      },
    },

    // Body: { message, state } -> { reply, state, plan }. The browser keeps `state` between messages.
    '/api/chat': {
      POST: async ({ req }) =>
        handleChat({ body: await readJsonBody(req), recipes: getRecipes(db), stock: getStock(db), today: now(), llm }),
    },

    // Body: { days, diet, budgetEuros, exclude: [], minCalories, maxCalories } -> { meals, totals, shoppingList }
    '/api/meal-plan': {
      POST: async ({ req }) => {
        const prefs = normalizePrefs(await readJsonBody(req));
        return buildMealPlan({ recipes: getRecipes(db), stock: getStock(db), prefs, today: now() });
      },
    },
  };

  async function handleApi(req, res, url) {
    const handlers = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (!handlers) return sendJson(res, 404, { error: 'Unknown API route' });
    if (!Object.hasOwn(handlers, req.method)) {
      return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: Object.keys(handlers).join(', ') });
    }
    sendJson(res, 200, await handlers[req.method]({ req, url }));
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(res, url.pathname);
    } catch (error) {
      if (error instanceof ValidationError) return sendJson(res, 400, { error: error.message });
      console.error(error);
      return sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}
