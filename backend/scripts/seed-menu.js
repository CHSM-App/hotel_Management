/**
 * Seeds a standard multi-cuisine Indian menu into whichever lodge is named on
 * the command line.
 *
 *   node scripts/seed-menu.js --phone 8263829478 --name "Hotel Renuka Palace"
 *
 * Both arguments are required and both are matched, because a phone alone is
 * one typo away from writing a hundred dishes into somebody else's property.
 * There is deliberately no default lodge — this script first shipped hard-wired
 * to The Royal Palace, and a leftover default is exactly the kind of thing that
 * seeds the wrong menu six months later.
 *
 * Idempotent: sections and items are matched by name and updated in place, so
 * re-running after a price change just restates the prices. Item rows are never
 * deleted and never recreated — food_order_items.menu_item_id is a soft link
 * from past orders, and dropping a row would cut it.
 *
 * The printed menu splits each section into Veg / Egg / Non-Veg headings; the
 * schema carries that on the item as food_type instead, so those become one
 * section with typed items rather than three sections.
 */
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

// Read as a pair rather than positionally: the two are both strings, and
// getting them the wrong way round would otherwise fail with a confusing
// "no lodge found" instead of an obvious one.
function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const LODGE_PHONE = readArg('--phone');
const LODGE_NAME = readArg('--name');

if (!LODGE_PHONE || !LODGE_NAME) {
  console.error('Usage: node scripts/seed-menu.js --phone <number> --name "<lodge name>"');
  console.error('Example: node scripts/seed-menu.js --phone 8263829478 --name "Hotel Renuka Palace"');
  process.exit(1);
}

// Sections an earlier cut of this menu named differently. Folding the old name
// into the new one keeps the dishes already under it — and any order lines
// pointing at them — instead of leaving a stale section beside the new one.
// Each rename is guarded on the new name not already existing, so this is a
// no-op on a lodge being seeded for the first time.
const RENAMES = [['Starter', 'Starters']];

const VEG = 'VEG';
const EGG = 'EGG';
const NON_VEG = 'NON_VEG';

const MENU = [
  {
    name: 'Breakfast',
    items: [
      ['Idli Sambar', 'Soft steamed rice cakes served with sambar and chutney.', 60, VEG],
      ['Medu Vada', 'Crispy South Indian lentil fritters served with sambar and chutney.', 70, VEG],
      ['Masala Dosa', 'Crispy dosa filled with spiced potato masala.', 100, VEG],
      ['Plain Dosa', 'Thin and crispy South Indian rice and lentil crepe.', 80, VEG],
      ['Onion Uttapam', 'Soft thick uttapam topped with fresh onions and spices.', 110, VEG],
      ['Poha', 'Flattened rice cooked with onion, peanuts and mild spices.', 60, VEG],
      ['Upma', 'Semolina cooked with vegetables, herbs and mild spices.', 60, VEG],
      ['Aloo Paratha', 'Indian flatbread stuffed with spiced potato filling.', 100, VEG],
      ['Egg Bhurji', 'Scrambled eggs cooked with onion, tomato and Indian spices.', 100, EGG],
      ['Masala Omelette', 'Omelette prepared with onion, tomato, green chilli and herbs.', 90, EGG],
      ['Cheese Omelette', 'Fluffy omelette filled with melted cheese and herbs.', 130, EGG],
      ['Chicken Sandwich', 'Grilled sandwich filled with seasoned chicken and vegetables.', 160, NON_VEG],
      ['Chicken Omelette', 'Omelette prepared with chicken pieces, onion and spices.', 150, NON_VEG],
    ],
  },
  {
    name: 'Starters',
    items: [
      ['Veg Manchurian', 'Crispy vegetable balls tossed in tangy Manchurian sauce.', 160, VEG],
      ['Gobi Manchurian', 'Crispy cauliflower tossed in spicy Indo-Chinese sauce.', 150, VEG],
      ['Paneer Chilli', 'Paneer cubes tossed with onion, capsicum and chilli sauce.', 220, VEG],
      ['Paneer Tikka', 'Marinated paneer grilled with capsicum and onion.', 240, VEG],
      ['Crispy Corn', 'Crispy fried corn tossed with spices and herbs.', 180, VEG],
      ['Veg Spring Roll', 'Crispy rolls stuffed with seasoned vegetables.', 160, VEG],
      ['Chilli Egg', 'Boiled eggs tossed with onion, capsicum and spicy sauce.', 150, EGG],
      ['Egg 65', 'Crispy fried egg pieces coated with South Indian spices.', 160, EGG],
      ['Egg Pakora', 'Spiced egg pieces coated in gram flour and deep-fried.', 140, EGG],
      ['Chicken 65', 'Crispy fried chicken marinated with South Indian spices.', 240, NON_VEG],
      ['Chicken Lollipop', 'Fried chicken wings marinated with aromatic spices.', 280, NON_VEG],
      ['Chicken Chilli', 'Chicken tossed with onion, capsicum and chilli sauce.', 260, NON_VEG],
      ['Chicken Tikka', 'Grilled chicken pieces marinated in yogurt and spices.', 280, NON_VEG],
      ['Fish Fry', 'Fish marinated with spices and shallow-fried.', 280, NON_VEG],
      ['Prawns Fry', 'Spiced prawns fried until crisp and golden.', 320, NON_VEG],
    ],
  },
  {
    name: 'Soups',
    items: [
      ['Veg Clear Soup', 'Light soup prepared with fresh vegetables and herbs.', 100, VEG],
      ['Veg Manchow Soup', 'Spicy vegetable soup topped with crispy noodles.', 130, VEG],
      ['Hot & Sour Veg Soup', 'Tangy and spicy soup with vegetables and herbs.', 130, VEG],
      ['Sweet Corn Soup', 'Creamy sweet corn soup with fresh vegetables.', 120, VEG],
      ['Chicken Clear Soup', 'Light chicken broth with vegetables and herbs.', 140, NON_VEG],
      ['Chicken Manchow Soup', 'Spicy chicken soup topped with crispy noodles.', 160, NON_VEG],
      ['Chicken Hot & Sour Soup', 'Spicy and tangy chicken soup with vegetables.', 160, NON_VEG],
    ],
  },
  {
    name: 'Main Course – Indian',
    items: [
      ['Dal Fry', 'Yellow lentils tempered with garlic, cumin and spices.', 140, VEG],
      ['Dal Tadka', 'Creamy lentils finished with aromatic Indian tempering.', 160, VEG],
      ['Mix Veg', 'Seasonal vegetables cooked in a flavorful Indian gravy.', 180, VEG],
      ['Veg Kolhapuri', 'Mixed vegetables cooked in spicy Kolhapuri masala.', 190, VEG],
      ['Paneer Butter Masala', 'Paneer cooked in rich tomato, butter and cream gravy.', 220, VEG],
      ['Kadai Paneer', 'Paneer cooked with capsicum, onion and kadai spices.', 220, VEG],
      ['Shahi Paneer', 'Paneer cooked in rich creamy and mildly spiced gravy.', 230, VEG],
      ['Veg Handi', 'Mixed vegetables cooked in a rich restaurant-style gravy.', 200, VEG],
      ['Egg Curry', 'Boiled eggs cooked in onion-tomato Indian gravy.', 160, EGG],
      ['Egg Masala', 'Eggs cooked with onion, tomato and aromatic spices.', 170, EGG],
      ['Egg Kolhapuri', 'Eggs cooked in a spicy Kolhapuri-style gravy.', 180, EGG],
      ['Chicken Masala', 'Chicken cooked in a rich onion-tomato masala.', 260, NON_VEG],
      ['Chicken Handi', 'Chicken cooked slowly in a creamy restaurant-style gravy.', 280, NON_VEG],
      ['Butter Chicken', 'Tender chicken cooked in creamy tomato and butter gravy.', 300, NON_VEG],
      ['Chicken Kolhapuri', 'Chicken cooked in spicy traditional Kolhapuri masala.', 280, NON_VEG],
      ['Kadai Chicken', 'Chicken cooked with capsicum, onion and kadai spices.', 290, NON_VEG],
      ['Mutton Masala', 'Tender mutton cooked in rich Indian masala gravy.', 380, NON_VEG],
      ['Mutton Handi', 'Slow-cooked mutton prepared in aromatic gravy.', 400, NON_VEG],
      ['Fish Curry', 'Fish cooked in flavorful Indian curry gravy.', 320, NON_VEG],
      ['Prawns Masala', 'Prawns cooked with onion, tomato and aromatic spices.', 360, NON_VEG],
    ],
  },
  {
    name: 'Rice & Biryani',
    items: [
      ['Steamed Rice', 'Freshly steamed long-grain rice.', 100, VEG],
      ['Jeera Rice', 'Basmati rice flavored with roasted cumin seeds.', 140, VEG],
      ['Veg Pulao', 'Basmati rice cooked with vegetables and aromatic spices.', 160, VEG],
      ['Veg Biryani', 'Fragrant rice layered with vegetables and biryani spices.', 180, VEG],
      ['Egg Biryani', 'Aromatic basmati rice cooked with boiled eggs and spices.', 200, EGG],
      ['Egg Fried Rice', 'Fried rice tossed with scrambled egg and vegetables.', 180, EGG],
      ['Chicken Biryani', 'Fragrant basmati rice layered with spiced chicken.', 260, NON_VEG],
      ['Chicken Dum Biryani', 'Slow-cooked chicken and aromatic rice prepared dum style.', 280, NON_VEG],
      ['Mutton Biryani', 'Fragrant basmati rice cooked with tender mutton and spices.', 360, NON_VEG],
      ['Fish Biryani', 'Aromatic rice prepared with seasoned fish and spices.', 340, NON_VEG],
      ['Prawns Biryani', 'Basmati rice cooked with spiced prawns and herbs.', 380, NON_VEG],
    ],
  },
  {
    name: 'Indian Breads',
    items: [
      ['Tandoori Roti', 'Traditional whole-wheat flatbread cooked in a tandoor.', 35, VEG],
      ['Butter Roti', 'Tandoori roti topped with butter.', 45, VEG],
      ['Plain Naan', 'Soft refined-flour flatbread cooked in a tandoor.', 50, VEG],
      ['Butter Naan', 'Soft naan topped with melted butter.', 60, VEG],
      ['Garlic Naan', 'Naan topped with fresh garlic and herbs.', 80, VEG],
      ['Cheese Naan', 'Soft naan stuffed with melted cheese.', 100, VEG],
      ['Aloo Paratha', 'Flatbread stuffed with spiced potato filling.', 100, VEG],
    ],
  },
  {
    name: 'Chinese',
    items: [
      ['Veg Fried Rice', 'Stir-fried rice with fresh vegetables and sauces.', 160, VEG],
      ['Schezwan Fried Rice', 'Spicy fried rice prepared with Schezwan sauce.', 180, VEG],
      ['Veg Hakka Noodles', 'Stir-fried noodles with vegetables and Chinese sauces.', 160, VEG],
      ['Veg Manchurian Gravy', 'Vegetable dumplings served in spicy Manchurian gravy.', 180, VEG],
      ['Egg Fried Rice', 'Fried rice tossed with egg and fresh vegetables.', 180, EGG],
      ['Egg Hakka Noodles', 'Hakka noodles tossed with scrambled egg and vegetables.', 190, EGG],
      ['Chicken Fried Rice', 'Stir-fried rice with chicken, vegetables and sauces.', 220, NON_VEG],
      ['Chicken Schezwan Rice', 'Spicy fried rice with chicken and Schezwan sauce.', 240, NON_VEG],
      ['Chicken Hakka Noodles', 'Noodles tossed with chicken, vegetables and sauces.', 220, NON_VEG],
      ['Chicken Manchurian', 'Crispy chicken served with spicy Manchurian sauce.', 260, NON_VEG],
    ],
  },
  {
    name: 'Snacks & Fast Food',
    items: [
      ['Veg Sandwich', 'Fresh vegetables and cheese served in toasted bread.', 120, VEG],
      ['Cheese Sandwich', 'Toasted bread filled with melted cheese.', 140, VEG],
      ['Veg Burger', 'Vegetable patty served with lettuce, sauce and bun.', 150, VEG],
      ['French Fries', 'Crispy golden potato fries served with sauce.', 100, VEG],
      ['Veg Pizza', 'Pizza topped with vegetables and melted cheese.', 220, VEG],
      ['Egg Sandwich', 'Toasted sandwich filled with seasoned egg and vegetables.', 130, EGG],
      ['Egg Burger', 'Burger with egg, vegetables and house sauce.', 150, EGG],
      ['Chicken Sandwich', 'Toasted bread filled with seasoned chicken and vegetables.', 160, NON_VEG],
      ['Chicken Burger', 'Chicken patty served with lettuce, cheese and sauce.', 200, NON_VEG],
      ['Chicken Pizza', 'Pizza topped with chicken, vegetables and cheese.', 280, NON_VEG],
    ],
  },
  {
    name: 'Desserts',
    items: [
      ['Gulab Jamun', 'Soft milk-solid dumplings soaked in sugar syrup.', 70, VEG],
      ['Ice Cream', 'Creamy ice cream available in assorted flavors.', 80, VEG],
      ['Kulfi', 'Traditional Indian frozen milk dessert.', 90, VEG],
      ['Brownie with Ice Cream', 'Warm chocolate brownie served with ice cream.', 160, VEG],
      ['Fruit Salad', 'Fresh seasonal fruits served with sweet dressing.', 120, VEG],
    ],
  },
  {
    name: 'Beverages',
    items: [
      ['Tea', 'Hot Indian tea brewed with milk and spices.', 25, VEG],
      ['Coffee', 'Freshly prepared hot coffee with milk.', 35, VEG],
      ['Cold Coffee', 'Chilled creamy coffee served with ice.', 100, VEG],
      ['Fresh Lime Water', 'Refreshing lime drink with sugar and water.', 50, VEG],
      ['Fresh Lime Soda', 'Fizzy lime drink served sweet or salted.', 70, VEG],
      ['Sweet Lassi', 'Thick yogurt drink blended with sugar.', 90, VEG],
      ['Mango Lassi', 'Creamy yogurt drink blended with mango.', 100, VEG],
      ['Soft Drink', 'Chilled carbonated beverage.', 50, VEG],
      ['Mineral Water', 'Packaged drinking water.', 30, VEG],
    ],
  },
];

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

async function applyRenames(tx, lodgeId) {
  for (const [from, to] of RENAMES) {
    const result = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('from', sql.NVarChar, from)
      .input('to', sql.NVarChar, to)
      .query(`
        UPDATE dbo.menu_categories SET name = @to
        OUTPUT inserted.id
        WHERE lodge_id = @lodgeId AND name = @from
          AND NOT EXISTS (
            SELECT 1 FROM dbo.menu_categories
            WHERE lodge_id = @lodgeId AND name = @to
          )
      `);
    if (result.recordset.length > 0) {
      console.log(`  renamed section "${from}" → "${to}"`);
    }
  }
}

async function upsertCategory(tx, lodgeId, name, sortOrder) {
  const existing = await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .query('SELECT id FROM dbo.menu_categories WHERE lodge_id = @lodgeId AND name = @name');

  if (existing.recordset.length > 0) {
    const id = existing.recordset[0].id;
    await new sql.Request(tx)
      .input('id', sql.BigInt, id)
      .input('sortOrder', sql.Int, sortOrder)
      .query('UPDATE dbo.menu_categories SET sort_order = @sortOrder, is_active = 1 WHERE id = @id');
    return { id, created: false };
  }

  const inserted = await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .input('sortOrder', sql.Int, sortOrder)
    .query(`
      INSERT INTO dbo.menu_categories (lodge_id, name, sort_order)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @sortOrder)
    `);
  return { id: inserted.recordset[0].id, created: true };
}

async function upsertItem(tx, lodgeId, categoryId, [name, description, price, foodType], sortOrder) {
  const existing = await new sql.Request(tx)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, name)
    .query('SELECT id FROM dbo.menu_items WHERE category_id = @categoryId AND name = @name');

  if (existing.recordset.length > 0) {
    await new sql.Request(tx)
      .input('id', sql.BigInt, existing.recordset[0].id)
      .input('description', sql.NVarChar, description)
      .input('price', sql.Decimal(10, 2), price)
      .input('foodType', sql.NVarChar, foodType)
      .input('sortOrder', sql.Int, sortOrder)
      .query(`
        UPDATE dbo.menu_items
        SET description = @description, price = @price, food_type = @foodType,
            sort_order = @sortOrder, is_active = 1
        WHERE id = @id
      `);
    return false;
  }

  await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, name)
    .input('description', sql.NVarChar, description)
    .input('price', sql.Decimal(10, 2), price)
    .input('foodType', sql.NVarChar, foodType)
    .input('sortOrder', sql.Int, sortOrder)
    .query(`
      INSERT INTO dbo.menu_items (lodge_id, category_id, name, description, price, food_type, sort_order)
      VALUES (@lodgeId, @categoryId, @name, @description, @price, @foodType, @sortOrder)
    `);
  return true;
}

async function run() {
  const pool = await getPool();
  const lodgeId = await resolveLodge(pool.request());
  console.log(`Seeding menu for "${LODGE_NAME}" (lodge id ${lodgeId})...`);

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    await applyRenames(tx, lodgeId);

    let created = 0;
    let updated = 0;

    for (const [index, section] of MENU.entries()) {
      const category = await upsertCategory(tx, lodgeId, section.name, index + 1);

      let sectionCreated = 0;
      for (const [itemIndex, item] of section.items.entries()) {
        const isNew = await upsertItem(tx, lodgeId, category.id, item, itemIndex + 1);
        if (isNew) sectionCreated += 1;
      }

      created += sectionCreated;
      updated += section.items.length - sectionCreated;
      console.log(
        `  ${section.name}: ${sectionCreated} added, ${section.items.length - sectionCreated} updated` +
          `${category.created ? ' (new section)' : ''}`
      );
    }

    await tx.commit();
    console.log(`Done — ${created} items added, ${updated} items updated across ${MENU.length} sections.`);
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
