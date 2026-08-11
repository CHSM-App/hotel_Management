const { z } = require('zod');

const FOOD_TYPES = ['VEG', 'NON_VEG', 'EGG'];

const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Section name is required.'),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

const createMenuItemSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a menu section.'),
  name: z.string().trim().min(1, 'Item name is required.'),
  description: z.string().trim().max(300).optional().default(''),
  price: z.coerce.number().min(0, 'Price can’t be negative.'),
  foodType: z.enum(FOOD_TYPES, { error: 'Choose veg, non-veg or egg.' }).optional().default('VEG'),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

// A dish's sizes in the order they should appear. An empty list is the way
// back to a single-price dish, so it is valid on purpose — see setItemPortions.
const itemPortionsSchema = z.object({
  portions: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Every size needs a name, like “Half plate”.').max(60),
        price: z.coerce.number().min(0, 'Price can’t be negative.'),
        isAvailable: z.boolean().optional().default(true),
      })
    )
    .max(10, 'That’s a lot of sizes for one dish.')
    .default([]),
});

const availabilitySchema = z.object({
  isAvailable: z.boolean({ error: 'isAvailable must be true or false.' }),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

// hasRooms is deliberately absent — whether a property has rooms at all is set
// by Vengurla Tech at onboarding, not toggled by the owner. Turning it off on a
// live lodge would strand its bookings behind a hidden section.
const foodSettingsSchema = z.object({
  servesFood: z.boolean({ error: 'servesFood must be true or false.' }),
  foodRoomService: z.boolean({ error: 'foodRoomService must be true or false.' }),
  foodTableService: z.boolean({ error: 'foodTableService must be true or false.' }),
});

module.exports = {
  FOOD_TYPES,
  createMenuCategorySchema,
  updateMenuCategorySchema: createMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema: createMenuItemSchema,
  itemPortionsSchema,
  availabilitySchema,
  statusSchema,
  foodSettingsSchema,
};
