/**
 * Seeds a kitchen store cupboard and a recipe for every dish seed-menu.js
 * writes, into whichever lodge is named on the command line.
 *
 *   node scripts/seed-inventory.js --phone 8263829478 --name "Hotel Renuka Palace"
 *
 * Run seed-menu.js first — recipes attach to dishes by name, and a dish that
 * isn't there yet is reported rather than created.
 *
 * Idempotent, but not symmetrically so, because the two halves mean different
 * things:
 *
 *   Materials are matched by name and their QUANTITY IS NEVER RESTATED. Only
 *   the low-stock level is updated. The number on a material is the shelf, and
 *   after one service it is a fact this file knows nothing about — re-running
 *   the seed must not quietly put the rice back.
 *
 *   Recipes are replaced outright per dish. They are a description of the dish
 *   rather than a running total, so restating them is exactly what re-running
 *   should do.
 *
 * Quantities are per single serving, in each material's own unit. There is no
 * conversion anywhere in the feature, so anything measured out in grams per
 * plate is stocked in grams — hence 50000 g of rice rather than 50 kg. That
 * keeps every recipe number below readable as what a cook would actually say.
 */
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const LODGE_PHONE = readArg('--phone');
const LODGE_NAME = readArg('--name');

if (!LODGE_PHONE || !LODGE_NAME) {
  console.error('Usage: node scripts/seed-inventory.js --phone <number> --name "<lodge name>"');
  console.error('Example: node scripts/seed-inventory.js --phone 8263829478 --name "Hotel Renuka Palace"');
  process.exit(1);
}

// [name, unit, opening stock, warn below, group]
//
// The group is the heading the material sits under on the Inventory tab. It
// must be one of the values raw_materials.category allows — GRAINS, PRODUCE,
// PROTEIN, BAKERY, STAPLES, SPICES, BOTTLED, OTHER — and is checked below
// before anything is written.
//
// Opening levels are roughly a week of service for a property this size, and
// the warn-below level is roughly a day of it — enough that the low-stock
// filter on the Inventory tab means something the moment this is seeded.
const MATERIALS = [
  // Grains, flours and pulses
  ['Basmati rice', 'G', 50000, 6000, 'GRAINS'],
  ['Wheat flour', 'G', 30000, 4000, 'GRAINS'],
  ['Refined flour (maida)', 'G', 20000, 2500, 'GRAINS'],
  ['Semolina (rava)', 'G', 10000, 1200, 'GRAINS'],
  ['Rice flour', 'G', 12000, 1500, 'GRAINS'],
  ['Gram flour (besan)', 'G', 8000, 1000, 'GRAINS'],
  ['Flattened rice (poha)', 'G', 5000, 600, 'GRAINS'],
  ['Urad dal', 'G', 10000, 1200, 'GRAINS'],
  ['Toor dal', 'G', 12000, 1500, 'GRAINS'],
  ['Cornflour', 'G', 5000, 600, 'GRAINS'],
  ['Noodles', 'G', 8000, 1000, 'GRAINS'],
  ['Corn kernels', 'G', 5000, 600, 'GRAINS'],

  // Bakery, bought in units
  ['Bread slices', 'PCS', 120, 24, 'BAKERY'],
  ['Burger buns', 'PCS', 40, 10, 'BAKERY'],
  ['Pizza base', 'PCS', 30, 8, 'BAKERY'],
  ['Spring roll sheets', 'PCS', 60, 15, 'BAKERY'],
  ['Brownie', 'PCS', 30, 8, 'BAKERY'],

  // Vegetables and fresh
  ['Potato', 'G', 30000, 4000, 'PRODUCE'],
  ['Onion', 'G', 40000, 5000, 'PRODUCE'],
  ['Tomato', 'G', 25000, 3000, 'PRODUCE'],
  ['Capsicum', 'G', 8000, 1000, 'PRODUCE'],
  ['Cauliflower', 'G', 8000, 1000, 'PRODUCE'],
  ['Carrot', 'G', 8000, 1000, 'PRODUCE'],
  ['Cabbage', 'G', 8000, 1000, 'PRODUCE'],
  ['Green peas', 'G', 5000, 600, 'PRODUCE'],
  ['Green chilli', 'G', 2000, 300, 'PRODUCE'],
  ['Ginger', 'G', 3000, 400, 'PRODUCE'],
  ['Garlic', 'G', 3000, 400, 'PRODUCE'],
  ['Coriander leaves', 'G', 2000, 300, 'PRODUCE'],
  ['Curry leaves', 'G', 600, 100, 'PRODUCE'],
  ['Lemon', 'PCS', 80, 20, 'PRODUCE'],
  ['Mixed fruits', 'G', 6000, 800, 'PRODUCE'],
  ['Coconut', 'G', 6000, 800, 'PRODUCE'],
  ['Cashew nuts', 'G', 3000, 400, 'PRODUCE'],
  ['Peanuts', 'G', 3000, 400, 'PRODUCE'],

  // Dairy, egg and meat
  ['Paneer', 'G', 12000, 1500, 'PROTEIN'],
  ['Milk', 'ML', 40000, 5000, 'PROTEIN'],
  ['Curd', 'G', 12000, 1500, 'PROTEIN'],
  ['Butter', 'G', 6000, 800, 'PROTEIN'],
  ['Fresh cream', 'ML', 5000, 600, 'PROTEIN'],
  ['Cheese', 'G', 6000, 800, 'PROTEIN'],
  ['Eggs', 'PCS', 240, 48, 'PROTEIN'],
  ['Chicken', 'G', 30000, 4000, 'PROTEIN'],
  ['Mutton', 'G', 12000, 2000, 'PROTEIN'],
  ['Fish', 'G', 12000, 2000, 'PROTEIN'],
  ['Prawns', 'G', 8000, 1200, 'PROTEIN'],
  ['Ice cream', 'ML', 6000, 1000, 'PROTEIN'],

  // Oils, sugar, salt
  ['Cooking oil', 'ML', 25000, 3000, 'STAPLES'],
  ['Ghee', 'ML', 4000, 500, 'STAPLES'],
  ['Sugar', 'G', 15000, 2000, 'STAPLES'],
  ['Salt', 'G', 10000, 1200, 'STAPLES'],

  // Spices and masalas
  ['Garam masala', 'G', 2500, 300, 'SPICES'],
  ['Red chilli powder', 'G', 3000, 400, 'SPICES'],
  ['Turmeric powder', 'G', 1500, 200, 'SPICES'],
  ['Coriander powder', 'G', 2000, 300, 'SPICES'],
  ['Cumin seeds', 'G', 1500, 200, 'SPICES'],
  ['Mustard seeds', 'G', 1000, 150, 'SPICES'],
  ['Black pepper', 'G', 1000, 150, 'SPICES'],
  ['Chaat masala', 'G', 1000, 150, 'SPICES'],
  ['Kolhapuri masala', 'G', 1500, 200, 'SPICES'],
  ['Tandoori masala', 'G', 1500, 200, 'SPICES'],
  ['Sambar masala', 'G', 2000, 300, 'SPICES'],

  // Sauces and bottled
  ['Schezwan sauce', 'ML', 3000, 400, 'BOTTLED'],
  ['Soy sauce', 'ML', 3000, 400, 'BOTTLED'],
  ['Tomato ketchup', 'ML', 5000, 700, 'BOTTLED'],
  ['Vinegar', 'ML', 2000, 300, 'BOTTLED'],
  ['Mango pulp', 'ML', 3000, 400, 'BOTTLED'],
  ['Tea leaves', 'G', 3000, 400, 'BOTTLED'],
  ['Coffee powder', 'G', 2000, 300, 'BOTTLED'],
  ['Gulab jamun mix', 'G', 3000, 400, 'BOTTLED'],
  ['Soft drink bottle', 'PCS', 72, 18, 'BOTTLED'],
  ['Soda water bottle', 'PCS', 48, 12, 'BOTTLED'],
  ['Mineral water bottle', 'PCS', 120, 24, 'BOTTLED'],
];

const CATEGORIES = ['GRAINS', 'BAKERY', 'PRODUCE', 'PROTEIN', 'STAPLES', 'SPICES', 'BOTTLED', 'OTHER'];

// Keyed by section then dish, not by dish alone: three dishes appear in two
// sections each (Aloo Paratha, Chicken Sandwich, Egg Fried Rice) and are
// separate rows on separate menus. menu_items is unique on (category, name),
// so the section is genuinely part of the key.
const RECIPES = {
  Breakfast: {
    'Idli Sambar': [['Rice flour', 100], ['Urad dal', 40], ['Toor dal', 50], ['Sambar masala', 10], ['Onion', 30], ['Coconut', 20]],
    'Medu Vada': [['Urad dal', 100], ['Toor dal', 40], ['Sambar masala', 8], ['Green chilli', 5], ['Ginger', 5], ['Curry leaves', 3], ['Cooking oil', 40]],
    'Masala Dosa': [['Rice flour', 120], ['Urad dal', 40], ['Potato', 150], ['Onion', 40], ['Turmeric powder', 2], ['Mustard seeds', 2], ['Curry leaves', 2], ['Coconut', 20], ['Cooking oil', 20]],
    'Plain Dosa': [['Rice flour', 120], ['Urad dal', 40], ['Coconut', 20], ['Cooking oil', 15]],
    'Onion Uttapam': [['Rice flour', 120], ['Urad dal', 40], ['Onion', 60], ['Green chilli', 5], ['Coriander leaves', 5], ['Cooking oil', 15]],
    Poha: [['Flattened rice (poha)', 100], ['Onion', 40], ['Peanuts', 20], ['Green chilli', 5], ['Turmeric powder', 2], ['Mustard seeds', 2], ['Curry leaves', 2], ['Lemon', 0.25], ['Cooking oil', 10]],
    Upma: [['Semolina (rava)', 100], ['Onion', 40], ['Carrot', 30], ['Green peas', 20], ['Mustard seeds', 2], ['Curry leaves', 2], ['Cooking oil', 15]],
    'Aloo Paratha': [['Wheat flour', 120], ['Potato', 150], ['Onion', 30], ['Green chilli', 5], ['Coriander leaves', 5], ['Butter', 15], ['Cooking oil', 10]],
    'Egg Bhurji': [['Eggs', 3], ['Onion', 50], ['Tomato', 40], ['Green chilli', 5], ['Turmeric powder', 1], ['Coriander leaves', 5], ['Cooking oil', 15]],
    'Masala Omelette': [['Eggs', 3], ['Onion', 40], ['Tomato', 30], ['Green chilli', 5], ['Coriander leaves', 5], ['Cooking oil', 12]],
    'Cheese Omelette': [['Eggs', 3], ['Cheese', 50], ['Butter', 10], ['Cooking oil', 10]],
    'Chicken Sandwich': [['Bread slices', 3], ['Chicken', 100], ['Onion', 20], ['Tomato', 20], ['Butter', 15], ['Tomato ketchup', 15]],
    'Chicken Omelette': [['Eggs', 3], ['Chicken', 80], ['Onion', 40], ['Green chilli', 5], ['Cooking oil', 12]],
  },

  Starters: {
    'Veg Manchurian': [['Cabbage', 80], ['Carrot', 50], ['Refined flour (maida)', 40], ['Cornflour', 30], ['Soy sauce', 15], ['Garlic', 10], ['Ginger', 8], ['Green chilli', 5], ['Cooking oil', 50]],
    'Gobi Manchurian': [['Cauliflower', 200], ['Refined flour (maida)', 40], ['Cornflour', 30], ['Soy sauce', 15], ['Garlic', 10], ['Ginger', 8], ['Cooking oil', 50]],
    'Paneer Chilli': [['Paneer', 180], ['Capsicum', 60], ['Onion', 60], ['Cornflour', 25], ['Soy sauce', 15], ['Garlic', 10], ['Green chilli', 5], ['Cooking oil', 30]],
    'Paneer Tikka': [['Paneer', 200], ['Curd', 60], ['Capsicum', 50], ['Onion', 50], ['Tandoori masala', 15], ['Ginger', 8], ['Garlic', 8], ['Cooking oil', 20]],
    'Crispy Corn': [['Corn kernels', 150], ['Cornflour', 40], ['Chaat masala', 5], ['Red chilli powder', 3], ['Cooking oil', 50]],
    'Veg Spring Roll': [['Spring roll sheets', 4], ['Cabbage', 60], ['Carrot', 40], ['Noodles', 30], ['Soy sauce', 10], ['Cooking oil', 50]],
    'Chilli Egg': [['Eggs', 3], ['Capsicum', 50], ['Onion', 50], ['Cornflour', 15], ['Soy sauce', 12], ['Garlic', 8], ['Cooking oil', 25]],
    'Egg 65': [['Eggs', 3], ['Cornflour', 30], ['Red chilli powder', 5], ['Curry leaves', 3], ['Ginger', 5], ['Cooking oil', 45]],
    'Egg Pakora': [['Eggs', 3], ['Gram flour (besan)', 60], ['Red chilli powder', 4], ['Turmeric powder', 2], ['Cooking oil', 50]],
    'Chicken 65': [['Chicken', 200], ['Cornflour', 35], ['Curd', 40], ['Red chilli powder', 6], ['Curry leaves', 3], ['Ginger', 8], ['Garlic', 8], ['Cooking oil', 60]],
    'Chicken Lollipop': [['Chicken', 250], ['Cornflour', 40], ['Refined flour (maida)', 25], ['Red chilli powder', 6], ['Ginger', 8], ['Garlic', 8], ['Cooking oil', 70]],
    'Chicken Chilli': [['Chicken', 200], ['Capsicum', 60], ['Onion', 60], ['Cornflour', 25], ['Soy sauce', 15], ['Garlic', 10], ['Cooking oil', 35]],
    'Chicken Tikka': [['Chicken', 220], ['Curd', 70], ['Tandoori masala', 18], ['Capsicum', 40], ['Onion', 40], ['Ginger', 8], ['Garlic', 8], ['Cooking oil', 20]],
    'Fish Fry': [['Fish', 220], ['Rice flour', 40], ['Red chilli powder', 6], ['Turmeric powder', 3], ['Ginger', 6], ['Garlic', 6], ['Cooking oil', 50]],
    'Prawns Fry': [['Prawns', 200], ['Rice flour', 30], ['Red chilli powder', 6], ['Turmeric powder', 3], ['Garlic', 8], ['Cooking oil', 45]],
  },

  Soups: {
    'Veg Clear Soup': [['Carrot', 40], ['Cabbage', 40], ['Green peas', 20], ['Black pepper', 2], ['Cornflour', 8], ['Salt', 2]],
    'Veg Manchow Soup': [['Cabbage', 50], ['Carrot', 40], ['Noodles', 20], ['Cornflour', 15], ['Soy sauce', 10], ['Garlic', 8], ['Cooking oil', 10]],
    'Hot & Sour Veg Soup': [['Cabbage', 50], ['Carrot', 40], ['Capsicum', 30], ['Cornflour', 15], ['Soy sauce', 10], ['Vinegar', 10], ['Black pepper', 3]],
    'Sweet Corn Soup': [['Corn kernels', 120], ['Carrot', 30], ['Cornflour', 15], ['Milk', 50], ['Sugar', 5]],
    'Chicken Clear Soup': [['Chicken', 100], ['Carrot', 30], ['Black pepper', 3], ['Cornflour', 8], ['Salt', 2]],
    'Chicken Manchow Soup': [['Chicken', 100], ['Cabbage', 40], ['Noodles', 20], ['Cornflour', 15], ['Soy sauce', 10], ['Garlic', 8]],
    'Chicken Hot & Sour Soup': [['Chicken', 100], ['Cabbage', 40], ['Capsicum', 30], ['Cornflour', 15], ['Soy sauce', 10], ['Vinegar', 10], ['Black pepper', 3]],
  },

  'Main Course – Indian': {
    'Dal Fry': [['Toor dal', 120], ['Onion', 50], ['Tomato', 40], ['Garlic', 10], ['Cumin seeds', 3], ['Turmeric powder', 2], ['Coriander leaves', 5], ['Cooking oil', 20]],
    'Dal Tadka': [['Toor dal', 120], ['Onion', 50], ['Tomato', 40], ['Garlic', 10], ['Cumin seeds', 4], ['Turmeric powder', 2], ['Coriander leaves', 5], ['Ghee', 15]],
    'Mix Veg': [['Carrot', 60], ['Green peas', 40], ['Cauliflower', 60], ['Potato', 50], ['Onion', 60], ['Tomato', 50], ['Garam masala', 6], ['Cooking oil', 25]],
    'Veg Kolhapuri': [['Carrot', 50], ['Green peas', 40], ['Cauliflower', 50], ['Potato', 50], ['Onion', 70], ['Tomato', 60], ['Kolhapuri masala', 12], ['Coconut', 20], ['Cooking oil', 25]],
    'Paneer Butter Masala': [['Paneer', 180], ['Tomato', 120], ['Onion', 60], ['Butter', 30], ['Fresh cream', 40], ['Cashew nuts', 20], ['Garam masala', 5], ['Cooking oil', 15]],
    'Kadai Paneer': [['Paneer', 180], ['Capsicum', 70], ['Onion', 70], ['Tomato', 80], ['Garam masala', 6], ['Coriander powder', 5], ['Cooking oil', 20]],
    'Shahi Paneer': [['Paneer', 180], ['Onion', 60], ['Tomato', 90], ['Fresh cream', 50], ['Cashew nuts', 25], ['Milk', 40], ['Garam masala', 5], ['Cooking oil', 15]],
    'Veg Handi': [['Carrot', 50], ['Green peas', 40], ['Paneer', 60], ['Potato', 40], ['Onion', 70], ['Tomato', 70], ['Fresh cream', 30], ['Garam masala', 6], ['Cooking oil', 25]],
    'Egg Curry': [['Eggs', 3], ['Onion', 70], ['Tomato', 70], ['Garam masala', 6], ['Turmeric powder', 2], ['Red chilli powder', 4], ['Cooking oil', 20]],
    'Egg Masala': [['Eggs', 3], ['Onion', 80], ['Tomato', 60], ['Garam masala', 6], ['Coriander powder', 5], ['Cooking oil', 20]],
    'Egg Kolhapuri': [['Eggs', 3], ['Onion', 80], ['Tomato', 70], ['Kolhapuri masala', 12], ['Coconut', 20], ['Cooking oil', 22]],
    'Chicken Masala': [['Chicken', 250], ['Onion', 90], ['Tomato', 80], ['Garam masala', 8], ['Ginger', 10], ['Garlic', 10], ['Cooking oil', 30]],
    'Chicken Handi': [['Chicken', 250], ['Onion', 90], ['Tomato', 80], ['Curd', 60], ['Fresh cream', 30], ['Garam masala', 8], ['Cooking oil', 30]],
    'Butter Chicken': [['Chicken', 250], ['Tomato', 140], ['Butter', 35], ['Fresh cream', 50], ['Cashew nuts', 20], ['Garam masala', 6], ['Cooking oil', 15]],
    'Chicken Kolhapuri': [['Chicken', 250], ['Onion', 100], ['Tomato', 80], ['Kolhapuri masala', 15], ['Coconut', 25], ['Cooking oil', 30]],
    'Kadai Chicken': [['Chicken', 250], ['Capsicum', 70], ['Onion', 80], ['Tomato', 80], ['Coriander powder', 6], ['Garam masala', 7], ['Cooking oil', 28]],
    'Mutton Masala': [['Mutton', 250], ['Onion', 100], ['Tomato', 80], ['Garam masala', 9], ['Ginger', 12], ['Garlic', 12], ['Cooking oil', 35]],
    'Mutton Handi': [['Mutton', 250], ['Onion', 100], ['Tomato', 80], ['Curd', 70], ['Fresh cream', 25], ['Garam masala', 9], ['Cooking oil', 35]],
    'Fish Curry': [['Fish', 250], ['Onion', 80], ['Tomato', 70], ['Coconut', 40], ['Turmeric powder', 3], ['Red chilli powder', 6], ['Cooking oil', 25]],
    'Prawns Masala': [['Prawns', 220], ['Onion', 80], ['Tomato', 70], ['Coconut', 25], ['Garam masala', 7], ['Garlic', 10], ['Cooking oil', 25]],
  },

  'Rice & Biryani': {
    'Steamed Rice': [['Basmati rice', 180], ['Salt', 2]],
    'Jeera Rice': [['Basmati rice', 180], ['Cumin seeds', 5], ['Ghee', 15], ['Salt', 2]],
    'Veg Pulao': [['Basmati rice', 180], ['Carrot', 40], ['Green peas', 30], ['Onion', 40], ['Garam masala', 5], ['Ghee', 15]],
    'Veg Biryani': [['Basmati rice', 200], ['Carrot', 50], ['Green peas', 40], ['Cauliflower', 40], ['Onion', 60], ['Curd', 50], ['Garam masala', 8], ['Ghee', 20]],
    'Egg Biryani': [['Basmati rice', 200], ['Eggs', 2], ['Onion', 60], ['Curd', 50], ['Garam masala', 8], ['Ghee', 20]],
    'Egg Fried Rice': [['Basmati rice', 180], ['Eggs', 2], ['Carrot', 40], ['Cabbage', 30], ['Soy sauce', 12], ['Cooking oil', 20]],
    'Chicken Biryani': [['Basmati rice', 220], ['Chicken', 220], ['Onion', 80], ['Curd', 60], ['Garam masala', 10], ['Ghee', 25]],
    'Chicken Dum Biryani': [['Basmati rice', 220], ['Chicken', 250], ['Onion', 90], ['Curd', 70], ['Fresh cream', 20], ['Garam masala', 12], ['Ghee', 30]],
    'Mutton Biryani': [['Basmati rice', 220], ['Mutton', 250], ['Onion', 90], ['Curd', 70], ['Garam masala', 12], ['Ghee', 30]],
    'Fish Biryani': [['Basmati rice', 220], ['Fish', 220], ['Onion', 80], ['Curd', 60], ['Garam masala', 10], ['Ghee', 25]],
    'Prawns Biryani': [['Basmati rice', 220], ['Prawns', 200], ['Onion', 80], ['Curd', 60], ['Garam masala', 10], ['Ghee', 25]],
  },

  'Indian Breads': {
    'Tandoori Roti': [['Wheat flour', 100], ['Salt', 1]],
    'Butter Roti': [['Wheat flour', 100], ['Butter', 15], ['Salt', 1]],
    'Plain Naan': [['Refined flour (maida)', 110], ['Curd', 25], ['Milk', 20], ['Salt', 1]],
    'Butter Naan': [['Refined flour (maida)', 110], ['Curd', 25], ['Milk', 20], ['Butter', 18]],
    'Garlic Naan': [['Refined flour (maida)', 110], ['Curd', 25], ['Garlic', 12], ['Butter', 15], ['Coriander leaves', 4]],
    'Cheese Naan': [['Refined flour (maida)', 110], ['Curd', 25], ['Cheese', 55], ['Butter', 12]],
    'Aloo Paratha': [['Wheat flour', 120], ['Potato', 150], ['Onion', 30], ['Green chilli', 5], ['Butter', 15], ['Cooking oil', 10]],
  },

  Chinese: {
    'Veg Fried Rice': [['Basmati rice', 180], ['Carrot', 40], ['Cabbage', 40], ['Capsicum', 30], ['Soy sauce', 12], ['Cooking oil', 20]],
    'Schezwan Fried Rice': [['Basmati rice', 180], ['Carrot', 40], ['Cabbage', 40], ['Schezwan sauce', 25], ['Cooking oil', 20]],
    'Veg Hakka Noodles': [['Noodles', 150], ['Carrot', 40], ['Cabbage', 50], ['Capsicum', 30], ['Soy sauce', 12], ['Cooking oil', 20]],
    'Veg Manchurian Gravy': [['Cabbage', 80], ['Carrot', 50], ['Refined flour (maida)', 40], ['Cornflour', 35], ['Soy sauce', 18], ['Garlic', 12], ['Cooking oil', 40]],
    'Egg Fried Rice': [['Basmati rice', 180], ['Eggs', 2], ['Carrot', 40], ['Cabbage', 30], ['Soy sauce', 12], ['Cooking oil', 20]],
    'Egg Hakka Noodles': [['Noodles', 150], ['Eggs', 2], ['Carrot', 40], ['Cabbage', 40], ['Soy sauce', 12], ['Cooking oil', 20]],
    'Chicken Fried Rice': [['Basmati rice', 180], ['Chicken', 130], ['Carrot', 40], ['Cabbage', 30], ['Soy sauce', 12], ['Cooking oil', 22]],
    'Chicken Schezwan Rice': [['Basmati rice', 180], ['Chicken', 130], ['Carrot', 40], ['Schezwan sauce', 28], ['Cooking oil', 22]],
    'Chicken Hakka Noodles': [['Noodles', 150], ['Chicken', 130], ['Carrot', 40], ['Cabbage', 40], ['Soy sauce', 12], ['Cooking oil', 22]],
    'Chicken Manchurian': [['Chicken', 200], ['Cornflour', 35], ['Refined flour (maida)', 25], ['Soy sauce', 18], ['Garlic', 12], ['Cooking oil', 45]],
  },

  'Snacks & Fast Food': {
    'Veg Sandwich': [['Bread slices', 3], ['Cheese', 30], ['Tomato', 30], ['Onion', 20], ['Capsicum', 20], ['Butter', 15], ['Tomato ketchup', 12]],
    'Cheese Sandwich': [['Bread slices', 3], ['Cheese', 70], ['Butter', 18]],
    'Veg Burger': [['Burger buns', 1], ['Potato', 120], ['Cabbage', 25], ['Refined flour (maida)', 20], ['Tomato ketchup', 15], ['Cooking oil', 25]],
    'French Fries': [['Potato', 250], ['Salt', 3], ['Tomato ketchup', 20], ['Cooking oil', 60]],
    'Veg Pizza': [['Pizza base', 1], ['Cheese', 90], ['Capsicum', 40], ['Onion', 35], ['Tomato', 40], ['Tomato ketchup', 30]],
    'Egg Sandwich': [['Bread slices', 3], ['Eggs', 2], ['Onion', 25], ['Butter', 15], ['Tomato ketchup', 12]],
    'Egg Burger': [['Burger buns', 1], ['Eggs', 2], ['Cabbage', 25], ['Onion', 20], ['Tomato ketchup', 15], ['Cooking oil', 12]],
    'Chicken Sandwich': [['Bread slices', 3], ['Chicken', 110], ['Onion', 25], ['Tomato', 25], ['Butter', 15], ['Tomato ketchup', 15]],
    'Chicken Burger': [['Burger buns', 1], ['Chicken', 130], ['Cabbage', 25], ['Cheese', 25], ['Tomato ketchup', 18], ['Cooking oil', 25]],
    'Chicken Pizza': [['Pizza base', 1], ['Chicken', 120], ['Cheese', 90], ['Capsicum', 35], ['Onion', 30], ['Tomato ketchup', 30]],
  },

  Desserts: {
    'Gulab Jamun': [['Gulab jamun mix', 60], ['Sugar', 80], ['Milk', 30], ['Cooking oil', 40]],
    'Ice Cream': [['Ice cream', 120]],
    Kulfi: [['Milk', 200], ['Sugar', 40], ['Cashew nuts', 15]],
    'Brownie with Ice Cream': [['Brownie', 1], ['Ice cream', 100], ['Sugar', 10]],
    'Fruit Salad': [['Mixed fruits', 200], ['Sugar', 15], ['Fresh cream', 30]],
  },

  Beverages: {
    Tea: [['Tea leaves', 6], ['Milk', 120], ['Sugar', 15]],
    Coffee: [['Coffee powder', 8], ['Milk', 130], ['Sugar', 15]],
    'Cold Coffee': [['Coffee powder', 10], ['Milk', 180], ['Sugar', 25], ['Ice cream', 40]],
    'Fresh Lime Water': [['Lemon', 1], ['Sugar', 20], ['Salt', 1]],
    'Fresh Lime Soda': [['Lemon', 1], ['Sugar', 20], ['Soda water bottle', 1]],
    'Sweet Lassi': [['Curd', 200], ['Sugar', 30], ['Milk', 40]],
    'Mango Lassi': [['Curd', 180], ['Mango pulp', 80], ['Sugar', 25]],
    'Soft Drink': [['Soft drink bottle', 1]],
    'Mineral Water': [['Mineral water bottle', 1]],
  },
};

async function resolveLodge(request) {
  const result = await request
    .input('phone', sql.NVarChar, LODGE_PHONE)
    .input('lodgeName', sql.NVarChar, LODGE_NAME)
    .query('SELECT id, name FROM dbo.lodges WHERE phone = @phone AND name = @lodgeName');

  if (result.recordset.length === 0) {
    throw new Error(`No lodge found with phone ${LODGE_PHONE} named "${LODGE_NAME}".`);
  }
  if (result.recordset.length > 1) {
    throw new Error(`Phone ${LODGE_PHONE} matches more than one lodge — refusing to guess.`);
  }
  return result.recordset[0].id;
}

// Every material a recipe names has to be one this file also stocks. Checked
// before anything is written, because the alternative is a dish that silently
// deducts one ingredient fewer than it should.
function checkRecipesAgainstMaterials() {
  const stocked = new Set(MATERIALS.map(([name]) => name));
  const problems = [];

  // A group the column won't accept fails the whole run on the first INSERT,
  // partway through, with a constraint name for a message. Caught here so it
  // names the material instead.
  for (const [name, , , , category] of MATERIALS) {
    if (!CATEGORIES.includes(category)) {
      problems.push(`material "${name}": unknown group "${category}"`);
    }
  }

  for (const [section, dishes] of Object.entries(RECIPES)) {
    for (const [dish, lines] of Object.entries(dishes)) {
      const seen = new Set();
      for (const [material, quantity] of lines) {
        if (!stocked.has(material)) problems.push(`${section} / ${dish}: unknown material "${material}"`);
        if (seen.has(material)) problems.push(`${section} / ${dish}: "${material}" listed twice`);
        if (!(quantity > 0)) problems.push(`${section} / ${dish}: "${material}" has quantity ${quantity}`);
        seen.add(material);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Recipe data is inconsistent:\n  ${problems.join('\n  ')}`);
  }
}

async function upsertMaterial(tx, lodgeId, [name, unit, opening, threshold, category]) {
  const existing = await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .query('SELECT id FROM dbo.raw_materials WHERE lodge_id = @lodgeId AND name = @name');

  if (existing.recordset.length > 0) {
    const id = existing.recordset[0].id;
    // quantity is deliberately absent from this UPDATE. See the header. The
    // group is restated, so a cupboard seeded before groups existed gets
    // filed properly on the next run.
    await new sql.Request(tx)
      .input('id', sql.BigInt, id)
      .input('threshold', sql.Decimal(12, 3), threshold)
      .input('category', sql.NVarChar, category)
      .query(`
        UPDATE dbo.raw_materials
        SET low_stock_threshold = @threshold, category = @category, is_active = 1
        WHERE id = @id
      `);
    return { id, created: false };
  }

  const inserted = await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .input('unit', sql.NVarChar, unit)
    .input('category', sql.NVarChar, category)
    .input('quantity', sql.Decimal(12, 3), opening)
    .input('threshold', sql.Decimal(12, 3), threshold)
    .query(`
      INSERT INTO dbo.raw_materials (lodge_id, name, unit, category, quantity, low_stock_threshold)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @unit, @category, @quantity, @threshold)
    `);
  const id = inserted.recordset[0].id;

  // The opening count is a movement like any other, or the ledger for this
  // material would start mid-story and never add up to the row it sits on.
  if (opening !== 0) {
    await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('materialId', sql.BigInt, id)
      .input('quantity', sql.Decimal(12, 3), opening)
      .query(`
        INSERT INTO dbo.stock_movements
          (lodge_id, material_id, change_qty, balance_after, reason, note)
        VALUES
          (@lodgeId, @materialId, @quantity, @quantity, 'OPENING', 'Seeded opening stock')
      `);
  }

  return { id, created: true };
}

async function run() {
  checkRecipesAgainstMaterials();

  const pool = await getPool();
  const lodgeId = await resolveLodge(pool.request());
  console.log(`Seeding inventory for "${LODGE_NAME}" (lodge id ${lodgeId})...\n`);

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // ---------------------------------------------------------- materials
    const materialIds = new Map();
    let materialsAdded = 0;

    for (const material of MATERIALS) {
      const { id, created } = await upsertMaterial(tx, lodgeId, material);
      materialIds.set(material[0], id);
      if (created) materialsAdded += 1;
    }
    console.log(
      `Store cupboard: ${materialsAdded} added, ${MATERIALS.length - materialsAdded} already there ` +
        `(existing stock levels left alone).`
    );

    // ------------------------------------------------------------ recipes
    const itemsResult = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        SELECT i.id, i.name AS item_name, c.name AS section_name
        FROM dbo.menu_items i
        JOIN dbo.menu_categories c ON c.id = i.category_id
        WHERE i.lodge_id = @lodgeId
      `);

    const itemIdByKey = new Map(
      itemsResult.recordset.map((row) => [`${row.section_name} ${row.item_name}`, row.id])
    );

    let written = 0;
    let lines = 0;
    const missing = [];

    for (const [section, dishes] of Object.entries(RECIPES)) {
      let sectionWritten = 0;

      for (const [dish, recipe] of Object.entries(dishes)) {
        const itemId = itemIdByKey.get(`${section} ${dish}`);
        if (!itemId) {
          missing.push(`${section} / ${dish}`);
          continue;
        }

        await new sql.Request(tx)
          .input('itemId', sql.BigInt, itemId)
          .query('DELETE FROM dbo.menu_item_recipes WHERE item_id = @itemId');

        for (const [material, quantity] of recipe) {
          await new sql.Request(tx)
            .input('lodgeId', sql.BigInt, lodgeId)
            .input('itemId', sql.BigInt, itemId)
            .input('materialId', sql.BigInt, materialIds.get(material))
            .input('quantity', sql.Decimal(12, 3), quantity)
            .query(`
              INSERT INTO dbo.menu_item_recipes (lodge_id, item_id, portion_id, material_id, quantity)
              VALUES (@lodgeId, @itemId, NULL, @materialId, @quantity)
            `);
          lines += 1;
        }

        sectionWritten += 1;
        written += 1;
      }

      console.log(`  ${section}: ${sectionWritten} recipes`);
    }

    // Dishes on the menu that this file says nothing about. They still sell —
    // they just take nothing out of the cupboard — so it is worth naming them
    // rather than letting the total quietly not add up.
    const described = new Set();
    for (const [section, dishes] of Object.entries(RECIPES)) {
      for (const dish of Object.keys(dishes)) described.add(`${section} ${dish}`);
    }
    const undescribed = itemsResult.recordset.filter(
      (row) => !described.has(`${row.section_name} ${row.item_name}`)
    );

    await tx.commit();

    console.log(`\nDone — ${written} recipes written, ${lines} ingredient lines total.`);

    if (missing.length > 0) {
      console.log(`\n${missing.length} recipe(s) had no matching dish on the menu:`);
      for (const key of missing) console.log(`  ${key}`);
      console.log('Run seed-menu.js for this lodge first.');
    }
    if (undescribed.length > 0) {
      console.log(`\n${undescribed.length} dish(es) on the menu have no recipe here:`);
      for (const row of undescribed) console.log(`  ${row.section_name} / ${row.item_name}`);
    }
    if (missing.length === 0 && undescribed.length === 0) {
      console.log('Every dish on the menu has a recipe.');
    }
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
