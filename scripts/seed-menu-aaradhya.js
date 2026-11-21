/**
 * Seeds Hotel Aaradhya's restaurant menu (from its printed PDF menu) into its
 * lodge row. Hard-wired to Aaradhya specifically — see seed-menu.js for the
 * generic, lodge-selectable version this was copied from.
 *
 * Idempotent: sections/items matched by name and updated in place, same as
 * seed-menu.js. Items priced "A.P.S." (as per size) in the PDF have no fixed
 * price and are skipped — they'd need a per-order price, not a menu price.
 *
 *   node scripts/seed-menu-aaradhya.js
 */
require('dotenv').config();
const { getPool, sql } = require('../src/config/connection');

const LODGE_PHONE = '9420680690';
const LODGE_NAME = 'Aaradhya';

const VEG = 'VEG';
const NON_VEG = 'NON_VEG';

// [name, description, price, foodType] — description left blank where the
// menu gives none; sortOrder is the item's index within its section.
const MENU = [
  {
    name: 'Breakfast & Beverages',
    items: [
      ['Upma', '', 80, VEG],
      ['Poha', '', 80, VEG],
      ['Sheera', '', 80, VEG],
      ['Bread Butter Jam', '', 50, VEG],
      ['Toast Butter', '', 60, VEG],
      ['Onion Pakoda', '', 90, VEG],
      ['French Fries', '', 140, VEG],
      ['Idli Sambhar', '', 90, VEG],
      ['Medu Vada', '', 110, VEG],
      ['Aloo Paratha With Curd', '', 120, VEG],
      ['Tomato Uttapam', '', 120, VEG],
      ['Masala Dosa', '', 120, VEG],
      ['Amboli Chutney', '', 100, VEG],
      ['Ghavne Chutney', '', 100, VEG],
      ['Boiled Egg', '', 40, NON_VEG],
      ['Fried Egg', '', 80, NON_VEG],
      ['Plain Omlette', '', 80, NON_VEG],
      ['Masala Omlette', '', 120, NON_VEG],
      ['Cheese Omlette', '', 120, NON_VEG],
      ['Egg Bhurji', '', 150, NON_VEG],
      ['Veg. Sandwich (Plain)', '', 100, VEG],
      ['Veg. Sandwich (Grilled)', '', 120, VEG],
      ['Omlette Sandwich (Plain)', '', 120, NON_VEG],
      ['Omlette Sandwich (Grilled)', '', 140, NON_VEG],
      ['Club Sandwich (Veg)', '', 120, VEG],
      ['Club Sandwich (Non-Veg)', '', 150, NON_VEG],
      ['Chicken Sandwich (Plain)', '', 120, NON_VEG],
      ['Chicken Sandwich (Grilled)', '', 150, NON_VEG],
      ['Masala Tea', '', 40, VEG],
      ['Coffee', '', 40, VEG],
      ['Hot Milk', '', 60, VEG],
      ['Cold Coffee', '', 150, VEG],
      ['Milk Shake', '', 150, VEG],
      ['Fresh Juice', '', 150, VEG],
      ['Buttermilk', '', 60, VEG],
      ['Fresh Lime Soda Water', '', 60, VEG],
      ['Solkadhi', '', 60, VEG],
      ['Lassi', '', 120, VEG],
      ['Packaged Drinking Water', '', 28, VEG],
      ['Soda', '', 28, VEG],
      ['Fanta', '', 28, VEG],
      ['Thums Up', '', 28, VEG],
      ['Sprite', '', 28, VEG],
      ['Maaza', '', 28, VEG],
    ],
  },
  {
    name: 'Greens & Goodness',
    items: [
      ['Plain Dahi', '', 100, VEG],
      ['Mix Raita', '', 120, VEG],
      ['Boondi Raita', '', 120, VEG],
      ['Pineapple Raita', '', 150, VEG],
      ['Boiled Veg', '', 150, VEG],
      ['Russian Salad', '', 180, VEG],
      ['Sauted Veg In Butter', '', 200, VEG],
    ],
  },
  {
    name: 'Soups',
    items: [
      ['Cream Of Tomato Soup', '', 120, VEG],
      ['Veg Manchow Soup', '', 110, VEG],
      ['Cream Of Mushroom Soup', '', 120, VEG],
      ['Hot & Sour Soup', '', 130, VEG],
      ['Veg Lemon Coriander Soup', '', 120, VEG],
      ['Veg Clear Soup', '', 110, VEG],
      ['Veg Sweet Corn Soup', '', 130, VEG],
      ['Chicken Manchow Soup', '', 130, NON_VEG],
      ['Cream Of Chicken Soup', '', 140, NON_VEG],
      ['Chicken Lemon Coriander Soup', '', 140, NON_VEG],
      ['Clear Chicken Soup', '', 120, NON_VEG],
      ['Chicken Sweet Corn Soup', '', 140, NON_VEG],
      ['Chicken Lung Fung Soup', '', 150, NON_VEG],
      ['Chicken Hot & Sour Soup', '', 150, NON_VEG],
    ],
  },
  {
    name: 'Appetizers',
    items: [
      ['Roasted Papad', '', 30, VEG],
      ['Masala Papad', '', 40, VEG],
      ['Sweet Corn Pakoda', '', 180, VEG],
      ['Hara Bhara Kabab', '', 200, VEG],
      ['Kaju Fry', '', 250, VEG],
      ['Veg Manchurian', '', 230, VEG],
      ['Gobi Manchurian', '', 200, VEG],
      ['Paneer Manchurian', '', 280, VEG],
      ['Paneer Chilly', '', 280, VEG],
      ['Paneer Crispy', '', 280, VEG],
      ['Egg Dry Fry', '', 120, NON_VEG],
      ['Egg Pakoda', '', 140, NON_VEG],
      ['Chicken Dry Fry', '', 300, NON_VEG],
      ['Chicken Manchurian', '', 270, NON_VEG],
      ['Chicken Chilly', '', 280, NON_VEG],
      ['Chicken 65', '', 270, NON_VEG],
      ['Chicken Crispy', '', 280, NON_VEG],
      ['Chicken Hong Kong', '', 300, NON_VEG],
      ['Chicken Magnet', '', 350, NON_VEG],
    ],
  },
  {
    name: 'Tandoori Tales',
    items: [
      ['Veg Seekh Kabab', '', 280, VEG],
      ['Paneer Tikka', '', 300, VEG],
      ['Paneer Banjara Kabab', '', 300, VEG],
      ['Paneer Lassuni Kabab', '', 300, VEG],
      ['Mushroom Tikka', '', 300, VEG],
      ['Baby Corn Tikka', '', 290, VEG],
      ['Veg Hariyali Kabab', '', 280, VEG],
      ['Paneer Reshmi Kabab', '', 290, VEG],
      ['Veg Kabab Platter', '', 1099, VEG],
      ['Chicken Malai Kabab', '', 350, NON_VEG],
      ['Chicken Banjara Kabab', '', 350, NON_VEG],
      ['Chicken Maratha Kebab', '', 320, NON_VEG],
      ['Chicken Seekh Kabab', '', 350, NON_VEG],
      ['Chicken Angara Kabab', '', 360, NON_VEG],
      ['Chicken Pahadi Kabab', '', 350, NON_VEG],
      ['Tandoori Chicken (Half)', '', 350, NON_VEG],
      ['Tandoori Chicken (Full)', '', 600, NON_VEG],
      ['Tandoori Chicken Platter', '', 1549, NON_VEG],
    ],
  },
  {
    name: 'Thalis',
    items: [
      ['Punjabi Thali', '2 Veg, Dal, 2 Roti/Chapati, Rice, Buttermilk, Salad, Pickle, Papad, Curd, Gulab Jamun', 250, VEG],
      ['Maharashtrian Thali', '2 Veg, Dal, 2 Roti/Chapati, Rice, Solkadhi, Koshimbir, Pickle, Papad, Curd, Gulab Jamun', 250, VEG],
      ['Egg Thali', 'Egg Masala, Tambda Rassa, Pandhra Rassa, Egg Bhurji, 2 Roti/Chapati, Rice, Solkadhi, Dahi-Kanda', 280, NON_VEG],
      ['Mutton Masala Thali', 'Mutton Masala, Tambda Rassa, Pandhra Rassa, Egg Masala, 2 Roti/Chapati, Rice, Solkadhi, Dahi-Kanda', 450, NON_VEG],
      ['Mutton Kharda Thali', 'Mutton Kharda, Tambda Rassa, Pandhra Rassa, Egg Masala, 2 Roti/Chapati, Rice, Solkadhi, Dahi-Kanda', 450, NON_VEG],
      ['Wada Kombda Thali', 'Malvani Chicken Masala, Rassa, Wade, Rice, Solkadhi, Dahi-Kanda', 350, NON_VEG],
    ],
  },
  {
    name: 'Signature Mains',
    items: [
      ['Dal Fry', '', 150, VEG],
      ['Dal Tadka', '', 190, VEG],
      ['Dal Kolhapuri', '', 200, VEG],
      ['Aloo Jeera', '', 170, VEG],
      ['Mix Veg Kolhapuri', '', 250, VEG],
      ['Palak Paneer', '', 250, VEG],
      ['Veg Makhanwala', '', 280, VEG],
      ['Veg Maratha', '', 250, VEG],
      ['Veg Maharaja', '', 260, VEG],
      ['Veg Hydrabadi', '', 300, VEG],
      ['Malai Kofta', '', 300, VEG],
      ['Paneer Bhurji', '', 300, VEG],
      ['Paneer Butter Masala', '', 320, VEG],
      ['Paneer Tikka Masala', '', 320, VEG],
      ['Paneer Chatpata', '', 320, VEG],
      ['Paneer Lahori', '', 350, VEG],
      ['Paneer Kaju Masala', '', 350, VEG],
      ['Aaradhya Special Veg', '', 700, VEG],
      ['Tambda Rassa', '', 70, NON_VEG],
      ['Pandhra Rassa', '', 70, NON_VEG],
      ['Egg Masala', '', 250, NON_VEG],
      ['Chicken Kadhai', '', 300, NON_VEG],
      ['Chicken Tikka Masala', '', 320, NON_VEG],
      ['Chicken Sukha', '', 300, NON_VEG],
      ['Chicken Hydrabadi', '', 300, NON_VEG],
      ['Chicken Chatpata', '', 350, NON_VEG],
      ['Rarha Chicken', '', 600, NON_VEG],
      ['Murgh Musslam', '', 800, NON_VEG],
      ['Mutton Sukha', '', 480, NON_VEG],
      ['Mutton Kolhapuri', '', 450, NON_VEG],
      ['Mutton Rogan Josh', '', 450, NON_VEG],
      ['Mutton Handi', '', 480, NON_VEG],
      ['Mutton Maratha', '', 500, NON_VEG],
      ['Mutton Kharda', '', 500, NON_VEG],
    ],
  },
  {
    name: 'Indian Breads',
    items: [
      ['Tandoori Roti (Plain)', '', 30, VEG],
      ['Tandoori Roti (Butter)', '', 35, VEG],
      ['Chapati', '', 25, VEG],
      ['Bhakari (Jowari, Nachani, Rice)', '', 40, VEG],
      ['Wheat Roti (Plain)', '', 35, VEG],
      ['Wheat Roti (Butter)', '', 40, VEG],
      ['Paratha (Plain)', '', 60, VEG],
      ['Paratha (Butter)', '', 70, VEG],
      ['Garlic Cheese Butter Naan', '', 150, VEG],
      ['Kulcha (Plain)', '', 60, VEG],
      ['Kulcha (Butter)', '', 80, VEG],
      ['Lachha Paratha (Plain)', '', 90, VEG],
      ['Lachha Paratha (Butter)', '', 110, VEG],
      ['Aloo Paratha With Curd', '', 120, VEG],
    ],
  },
  {
    name: 'Rice & Biryani',
    items: [
      ['Steam Rice (Half)', '', 80, VEG],
      ['Steam Rice (Full)', '', 120, VEG],
      ['Jeera Rice (Half)', '', 90, VEG],
      ['Jeera Rice (Full)', '', 140, VEG],
      ['Curd Rice', '', 150, VEG],
      ['Dal Khichdi', '', 190, VEG],
      ['Biryani Rice', '', 180, VEG],
      ['Ghee Rice', '', 180, VEG],
      ['Veg Biryani', '', 250, VEG],
      ['Egg Biryani', '', 250, NON_VEG],
      ['Chicken Biryani', '', 300, NON_VEG],
      ['Chicken Tikka Biryani', '', 320, NON_VEG],
      ['Mutton Biryani', '', 470, NON_VEG],
      ['Prawns Biryani', '', 450, NON_VEG],
    ],
  },
  {
    name: 'Noodles & More',
    items: [
      ['Veg Fried Rice', '', 240, VEG],
      ['Veg Schezwan Fried Rice', '', 250, VEG],
      ['Veg Tripple Schezwan Rice', '', 280, VEG],
      ['Veg Combination Rice', '', 280, VEG],
      ['Veg Hakka Noodles', '', 260, VEG],
      ['Veg Singapuri Noodles', '', 260, VEG],
      ['Egg Fried Rice', '', 260, NON_VEG],
      ['Chicken Fried Rice', '', 280, NON_VEG],
      ['Chicken Schezwan Fried Rice', '', 290, NON_VEG],
      ['Chicken Tripple Schezwan Rice', '', 300, NON_VEG],
      ['Chicken Combination Rice', '', 300, NON_VEG],
      ['Chicken Hakka Noodles', '', 260, NON_VEG],
      ['Chicken Schezwan Noodles', '', 280, NON_VEG],
      ['Prawns Fried Rice', '', 350, NON_VEG],
      ['Mix Fried Rice', '', 450, NON_VEG],
    ],
  },
  {
    name: 'Taste Of Kokan',
    items: [
      ['Plain Fish Curry', '', 150, NON_VEG],
    ],
  },
  {
    name: 'Desserts',
    items: [
      ['Vanilla Ice Cream', '', 60, VEG],
      ['Vanilla Ice Cream W/ Chocolate Sauce', '', 80, VEG],
      ['Chocolate Ice Cream', '', 90, VEG],
      ['Anjeer Badam Ice Cream', '', 100, VEG],
      ['Mango Ice Cream', '', 80, VEG],
      ['Gulab Jamun', '', 60, VEG],
      ['Gulab Jamun W/ Ice Cream', '', 120, VEG],
      ['Caramel Custard', '', 100, VEG],
      ['Serradura', '', 110, VEG],
      ['Ukadiche Modak On Tuesdays (5 Pieces)', '', 200, VEG],
    ],
  },
];

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
  const result = await pool.request()
    .input('phone', sql.NVarChar, LODGE_PHONE)
    .input('lodgeName', sql.NVarChar, LODGE_NAME)
    .query('SELECT id FROM dbo.lodges WHERE phone = @phone AND name = @lodgeName');

  if (result.recordset.length !== 1) {
    throw new Error(`Expected exactly one lodge matching phone ${LODGE_PHONE} / name "${LODGE_NAME}", found ${result.recordset.length}.`);
  }
  const lodgeId = result.recordset[0].id;
  console.log(`Seeding menu for "${LODGE_NAME}" (lodge id ${lodgeId})...`);

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
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
