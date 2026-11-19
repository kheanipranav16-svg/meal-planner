// Demo data for the shop. Prices are in cents (avoids floating-point rounding bugs).
// `kcal` is the energy in ONE unit of the product as sold (one jar, one 500 g pack...).
// `daysLeft` is how many days from "today" a product expires; seed() turns it into a
// real date, so the demo always contains items that are about to expire.

export const PRODUCTS = [
  { id: 1, name: 'Pasta', category: 'pantry', unit: '500 g', priceCents: 189, kcal: 1750 },
  { id: 2, name: 'Tomato sauce', category: 'pantry', unit: 'jar', priceCents: 229, kcal: 180 },
  { id: 3, name: 'Mozzarella', category: 'dairy', unit: '125 g', priceCents: 149, kcal: 300 },
  { id: 4, name: 'Basil', category: 'produce', unit: 'bunch', priceCents: 129, kcal: 10 },
  { id: 5, name: 'Chicken breast', category: 'meat', unit: '500 g', priceCents: 599, kcal: 550 },
  { id: 6, name: 'Rice', category: 'pantry', unit: '500 g', priceCents: 149, kcal: 1800 },
  { id: 7, name: 'Broccoli', category: 'produce', unit: 'head', priceCents: 179, kcal: 120 },
  { id: 8, name: 'Bell pepper', category: 'produce', unit: 'each', priceCents: 99, kcal: 35 },
  { id: 9, name: 'Eggs', category: 'dairy', unit: '10 pack', priceCents: 349, kcal: 750 },
  { id: 10, name: 'Spinach', category: 'produce', unit: '250 g', priceCents: 159, kcal: 60 },
  { id: 11, name: 'Chickpeas', category: 'pantry', unit: 'can', priceCents: 99, kcal: 400 },
  { id: 12, name: 'Coconut milk', category: 'pantry', unit: 'can', priceCents: 139, kcal: 600 },
  { id: 13, name: 'Curry paste', category: 'pantry', unit: 'jar', priceCents: 249, kcal: 150 },
  { id: 14, name: 'Tofu', category: 'chilled', unit: '200 g', priceCents: 199, kcal: 290 },
  { id: 15, name: 'Soy sauce', category: 'pantry', unit: 'bottle', priceCents: 179, kcal: 100 },
  { id: 16, name: 'Minced beef', category: 'meat', unit: '400 g', priceCents: 449, kcal: 1000 },
  { id: 17, name: 'Tortillas', category: 'pantry', unit: '8 pack', priceCents: 229, kcal: 1000 },
  { id: 18, name: 'Kidney beans', category: 'pantry', unit: 'can', priceCents: 99, kcal: 300 },
  { id: 19, name: 'Cheddar', category: 'dairy', unit: '200 g', priceCents: 299, kcal: 800 },
  { id: 20, name: 'Onions', category: 'produce', unit: '500 g', priceCents: 89, kcal: 200 },
  { id: 21, name: 'Potatoes', category: 'produce', unit: '1 kg', priceCents: 199, kcal: 770 },
  { id: 22, name: 'Salmon fillet', category: 'fish', unit: '2 pieces', priceCents: 799, kcal: 620 },
  { id: 23, name: 'Yoghurt', category: 'dairy', unit: '500 g', priceCents: 169, kcal: 300 },
];

// One stock batch per product. Some rows are on purpose special cases:
//   Basil, Spinach      -> expire tomorrow (50% off)
//   Mozzarella, Beef    -> expire in 2 days (30% off)
//   Pasta, Chickpeas    -> overstock (15% off)
//   Salmon fillet       -> sold out (never planned)
//   Yoghurt             -> expired yesterday (never sold)
export const INVENTORY = [
  { productId: 1, quantity: 120, daysLeft: 300 },
  { productId: 2, quantity: 40, daysLeft: 200 },
  { productId: 3, quantity: 15, daysLeft: 2 },
  { productId: 4, quantity: 10, daysLeft: 1 },
  { productId: 5, quantity: 12, daysLeft: 3 },
  { productId: 6, quantity: 60, daysLeft: 400 },
  { productId: 7, quantity: 20, daysLeft: 5 },
  { productId: 8, quantity: 25, daysLeft: 4 },
  { productId: 9, quantity: 30, daysLeft: 12 },
  { productId: 10, quantity: 8, daysLeft: 1 },
  { productId: 11, quantity: 150, daysLeft: 500 },
  { productId: 12, quantity: 30, daysLeft: 300 },
  { productId: 13, quantity: 10, daysLeft: 250 },
  { productId: 14, quantity: 14, daysLeft: 6 },
  { productId: 15, quantity: 25, daysLeft: 400 },
  { productId: 16, quantity: 6, daysLeft: 2 },
  { productId: 17, quantity: 20, daysLeft: 20 },
  { productId: 18, quantity: 40, daysLeft: 400 },
  { productId: 19, quantity: 18, daysLeft: 45 },
  { productId: 20, quantity: 50, daysLeft: 20 },
  { productId: 21, quantity: 45, daysLeft: 30 },
  { productId: 22, quantity: 0, daysLeft: 1 },
  { productId: 23, quantity: 5, daysLeft: -1 },
];

// diet: 'vegan' | 'vegetarian' | 'omnivore' (omnivore = contains meat or fish = "non-veg").
// servings: how many people the recipe feeds. Cost is for the whole recipe;
// calories are shown per serving.
// ingredients are [productId, amount in units of that product].
export const RECIPES = [
  {
    id: 1,
    name: 'Pasta Pomodoro',
    diet: 'vegetarian',
    servings: 4,
    instructions: 'Boil the pasta. Warm the tomato sauce, stir in torn basil, toss with the pasta and top with sliced mozzarella.',
    ingredients: [[1, 1], [2, 1], [3, 1], [4, 1]], // pasta, tomato sauce, mozzarella, basil
  },
  {
    id: 2,
    name: 'Chicken Stir-fry',
    diet: 'omnivore',
    servings: 4,
    instructions: 'Cook the rice. Stir-fry sliced chicken, add broccoli and pepper, finish with soy sauce and serve over the rice.',
    ingredients: [[5, 1], [6, 1], [7, 1], [8, 1], [15, 1]], // chicken, rice, broccoli, pepper, soy sauce
  },
  {
    id: 3,
    name: 'Spinach Omelette',
    diet: 'vegetarian',
    servings: 2,
    instructions: 'Soften chopped onion, wilt the spinach, pour in beaten eggs and cook until just set.',
    ingredients: [[9, 1], [10, 1], [20, 1]], // eggs, spinach, onions
  },
  {
    id: 4,
    name: 'Chickpea Coconut Curry',
    diet: 'vegan',
    servings: 4,
    instructions: 'Fry the curry paste, add coconut milk, chickpeas and spinach, simmer 10 minutes and serve with rice.',
    ingredients: [[11, 2], [12, 1], [13, 1], [10, 1], [6, 1]], // chickpeas x2, coconut milk, curry paste, spinach, rice
  },
  {
    id: 5,
    name: 'Tofu Veggie Stir-fry',
    diet: 'vegan',
    servings: 4,
    instructions: 'Crisp the cubed tofu, add broccoli and pepper, season with soy sauce and serve over rice.',
    ingredients: [[14, 1], [6, 1], [7, 1], [8, 1], [15, 1]], // tofu, rice, broccoli, pepper, soy sauce
  },
  {
    id: 6,
    name: 'Beef Tacos',
    diet: 'omnivore',
    servings: 4,
    instructions: 'Brown the beef with the beans and diced pepper, spoon into warm tortillas and top with grated cheddar.',
    ingredients: [[16, 1], [17, 1], [18, 1], [8, 1], [19, 1]], // beef, tortillas, kidney beans, pepper, cheddar
  },
  {
    id: 7,
    name: 'Baked Salmon with Potatoes',
    diet: 'omnivore',
    servings: 2,
    instructions: 'Roast potato wedges for 25 minutes, add the salmon and broccoli for the last 12 minutes.',
    ingredients: [[22, 1], [21, 1], [7, 1]], // salmon, potatoes, broccoli
  },
  {
    id: 8,
    name: 'Bean Burrito Bowl',
    diet: 'vegan',
    servings: 4,
    instructions: 'Warm the kidney beans with chopped onion, serve over rice with diced pepper.',
    ingredients: [[18, 2], [6, 1], [8, 1], [20, 1]], // kidney beans x2, rice, pepper, onions
  },
  {
    id: 9,
    name: 'Veggie Pasta Bake',
    diet: 'vegetarian',
    servings: 4,
    instructions: 'Mix cooked pasta with tomato sauce, spinach and onion, top with mozzarella and bake 20 minutes.',
    ingredients: [[1, 1], [2, 1], [3, 1], [10, 1], [20, 1]], // pasta, tomato sauce, mozzarella, spinach, onions
  },
  {
    id: 10,
    name: 'Veggie Fried Rice',
    diet: 'vegan',
    servings: 4,
    instructions: 'Fry chopped onion, pepper and broccoli, add cooked rice and soy sauce and stir until hot.',
    ingredients: [[6, 1], [7, 1], [8, 1], [15, 1], [20, 1]], // rice, broccoli, pepper, soy sauce, onions
  },
  {
    id: 11,
    name: 'Spinach Chickpea Stew',
    diet: 'vegan',
    servings: 3,
    instructions: 'Simmer onion, diced potato, chickpeas and tomato sauce for 20 minutes, stir in the spinach at the end.',
    ingredients: [[11, 1], [10, 1], [20, 1], [21, 1], [2, 1]], // chickpeas, spinach, onions, potatoes, tomato sauce
  },
  {
    id: 12,
    name: 'Chicken Veg Tray Bake',
    diet: 'omnivore',
    servings: 4,
    instructions: 'Roast chicken pieces, potato chunks, broccoli and pepper on one tray for 35 minutes.',
    ingredients: [[5, 1], [21, 1], [7, 1], [8, 1]], // chicken, potatoes, broccoli, pepper
  },
  {
    id: 13,
    name: 'Tofu Spinach Scramble',
    diet: 'vegan',
    servings: 2,
    instructions: 'Crumble the tofu into a hot pan with onion and pepper, fold in the spinach at the end.',
    ingredients: [[14, 1], [10, 1], [20, 1], [8, 1]], // tofu, spinach, onions, pepper
  },
];
