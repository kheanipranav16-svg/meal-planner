// Database layer. Uses SQLite through Node's built-in `node:sqlite` module,
// so there is nothing to install. All SQL in the project lives in this file.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays } from './dates.js';
import { INVENTORY, PRODUCTS, RECIPES } from './seed-data.js';

export const DEFAULT_DB_FILE = join(import.meta.dirname, '..', 'data', 'shop.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL,
  unit        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  kcal        INTEGER NOT NULL DEFAULT 0 CHECK (kcal >= 0)   -- energy in one unit as sold
);
CREATE TABLE IF NOT EXISTS inventory (
  product_id  INTEGER PRIMARY KEY REFERENCES products(id),
  quantity    INTEGER NOT NULL CHECK (quantity >= 0),
  expiry_date TEXT NOT NULL            -- 'YYYY-MM-DD'
);
CREATE TABLE IF NOT EXISTS recipes (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  diet         TEXT NOT NULL CHECK (diet IN ('vegan', 'vegetarian', 'omnivore')),
  servings     INTEGER NOT NULL DEFAULT 1 CHECK (servings > 0),
  instructions TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (recipe_id, product_id)
);
`;

/**
 * Early versions of this project had no `kcal` column. The data is demo data that
 * `npm run seed` recreates, so an outdated database is simply dropped and rebuilt.
 */
function dropOutdatedTables(db) {
  const columns = db.prepare('PRAGMA table_info(products)').all();
  if (columns.length > 0 && !columns.some((c) => c.name === 'kcal')) {
    db.exec(
      'DROP TABLE IF EXISTS recipe_ingredients; DROP TABLE IF EXISTS recipes; DROP TABLE IF EXISTS inventory; DROP TABLE IF EXISTS products;',
    );
  }
}

/** Open (and create if needed) the database. Pass ':memory:' for tests. */
export function openDb(file = DEFAULT_DB_FILE) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  dropOutdatedTables(db);
  db.exec(SCHEMA);
  return db;
}

/** Replace everything with the demo data. Expiry dates are relative to `today`. */
export function seed(db, today = new Date()) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM recipe_ingredients; DELETE FROM recipes; DELETE FROM inventory; DELETE FROM products;');

    const addProduct = db.prepare(
      'INSERT INTO products (id, name, category, unit, price_cents, kcal) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const p of PRODUCTS) addProduct.run(p.id, p.name, p.category, p.unit, p.priceCents, p.kcal);

    const addStock = db.prepare('INSERT INTO inventory (product_id, quantity, expiry_date) VALUES (?, ?, ?)');
    for (const s of INVENTORY) addStock.run(s.productId, s.quantity, addDays(today, s.daysLeft));

    const addRecipe = db.prepare('INSERT INTO recipes (id, name, diet, servings, instructions) VALUES (?, ?, ?, ?, ?)');
    const addIngredient = db.prepare('INSERT INTO recipe_ingredients (recipe_id, product_id, amount) VALUES (?, ?, ?)');
    for (const r of RECIPES) {
      addRecipe.run(r.id, r.name, r.diet, r.servings, r.instructions);
      for (const [productId, amount] of r.ingredients) addIngredient.run(r.id, productId, amount);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Seed only when the database is empty. Returns true if it seeded. */
export function ensureSeeded(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n > 0) return false;
  seed(db);
  return true;
}

/** Every product that has a stock row (the discount logic filters out expired and sold-out). */
export function getStock(db) {
  return db
    .prepare(
      `SELECT p.id AS productId, p.name, p.category, p.unit, p.price_cents AS priceCents, p.kcal,
              i.quantity, i.expiry_date AS expiryDate
         FROM products p
         JOIN inventory i ON i.product_id = p.id
        ORDER BY p.name`,
    )
    .all();
}

/** Recipes with their ingredient lists: [{ id, name, diet, servings, instructions, ingredients: [{ productId, name, amount }] }] */
export function getRecipes(db) {
  const recipes = db.prepare('SELECT id, name, diet, servings, instructions FROM recipes ORDER BY id').all();
  const rows = db
    .prepare(
      `SELECT ri.recipe_id AS recipeId, ri.product_id AS productId, p.name, ri.amount
         FROM recipe_ingredients ri
         JOIN products p ON p.id = ri.product_id
        ORDER BY ri.recipe_id, p.name`,
    )
    .all();

  const byId = new Map(recipes.map((r) => [r.id, { ...r, ingredients: [] }]));
  for (const row of rows) {
    byId.get(row.recipeId).ingredients.push({ productId: row.productId, name: row.name, amount: row.amount });
  }
  return [...byId.values()];
}
