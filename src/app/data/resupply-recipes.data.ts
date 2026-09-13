import { Recipe } from '../models/resupply.model';

export const DEFAULT_RESUPPLY_RECIPES: readonly Recipe[] = [
  {
    id: 'tuna-sandwich',
    name: 'Tuna Sandwich',
    description: 'High-protein trail classic using pouch tuna, bread slices, and mayo packet.',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 350,
      carbs: 28,
      protein: 26,
      fat: 14,
      sodium: 600,
      fluids: 40
    },
    ingredients: [
      { name: 'Bread', quantity: 2, unit: 'slices', department: 'Bakery' },
      { name: 'Tuna pouch (85g)', quantity: 1, unit: 'pouch', department: 'Canned/Protein' },
      { name: 'Mayonnaise packet (15g)', quantity: 1, unit: 'packet', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'avocado-sandwich',
    name: 'Avocado Sandwich',
    description: 'Calorie-dense whole avocado with cheddar cheese and seasoning on hearty bread.',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 490,
      carbs: 42,
      protein: 16,
      fat: 31,
      sodium: 440,
      fluids: 110
    },
    ingredients: [
      { name: 'Bread', quantity: 2, unit: 'slices', department: 'Bakery' },
      { name: 'Avocado', quantity: 1, unit: 'whole', department: 'Produce' },
      { name: 'Cheddar cheese (28g)', quantity: 1, unit: 'slice', department: 'Dairy' },
      { name: 'Salt & pepper packet', quantity: 1, unit: 'packet', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'bag-of-chips',
    name: 'Bag of Chips (50g / 1.75 oz)',
    description: 'Quick sodium and lipid replenishment from crispy grab-and-go potato chips.',
    servings: 1,
    category: 'snack',
    isCustom: false,
    nutrients: {
      calories: 270,
      carbs: 26,
      protein: 3,
      fat: 17,
      sodium: 260,
      fluids: 0
    },
    ingredients: [
      { name: 'Potato chips (50g)', quantity: 1, unit: 'bag', department: 'Snacks/Candy' }
    ]
  },
  {
    id: 'pizza-quarter-slice',
    name: 'Quarter Slice of Pizza (salami reference)',
    description: 'Jumbo gas station or town quarter-pie slice packed with salt, fat, and carbs.',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 520,
      carbs: 52,
      protein: 22,
      fat: 25,
      sodium: 1150,
      fluids: 30
    },
    ingredients: [
      { name: 'Salami pizza slice (190g)', quantity: 1, unit: 'slice', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'half-subway-sub',
    name: 'Half Subway Sub (6-inch)',
    description: 'Fresh 6-inch cold cut or turkey sub with provolone cheese and crisp vegetables.',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 440,
      carbs: 46,
      protein: 21,
      fat: 20,
      sodium: 1020,
      fluids: 60
    },
    ingredients: [
      { name: '6-inch Subway Sub', quantity: 1, unit: 'sub', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'cheeseburger',
    name: '1 Cheeseburger',
    description: 'Hot diner or fast-food burger offering rapid protein, lipids, and sodium.',
    servings: 1,
    category: 'quick_bite',
    isCustom: false,
    nutrients: {
      calories: 310,
      carbs: 33,
      protein: 16,
      fat: 13,
      sodium: 720,
      fluids: 30
    },
    ingredients: [
      { name: 'Cheeseburger (fast food / diner)', quantity: 1, unit: 'burger', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'double-burger',
    name: '1 Double Burger (Big Mac / Whopper)',
    description: 'Double-patty fast food powerhouse (Big Mac / Whopper style) loaded with heavy fats, protein, and recovery sodium.',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 620,
      carbs: 48,
      protein: 28,
      fat: 36,
      sodium: 1080,
      fluids: 45
    },
    ingredients: [
      { name: 'Double Burger (Big Mac / Whopper)', quantity: 1, unit: 'burger', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'large-fries',
    name: '1 Fast Food Large Fries (Big Fries)',
    description: 'Crispy salted fast-food fries providing rapid carbohydrate energy and crucial sodium replenishment.',
    servings: 1,
    category: 'quick_bite',
    isCustom: false,
    nutrients: {
      calories: 490,
      carbs: 66,
      protein: 6,
      fat: 23,
      sodium: 400,
      fluids: 15
    },
    ingredients: [
      { name: 'Large French Fries (fast food)', quantity: 1, unit: 'serving', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'salted-nuts',
    name: '1 Bag of Salted Nuts (100g)',
    description: 'Super-dense sustained energy pack high in monounsaturated fats and essential minerals.',
    servings: 1,
    category: 'snack',
    isCustom: false,
    nutrients: {
      calories: 610,
      carbs: 21,
      protein: 20,
      fat: 53,
      sodium: 480,
      fluids: 0
    },
    ingredients: [
      { name: 'Salted mixed nuts (100g)', quantity: 1, unit: 'bag', department: 'Snacks/Candy' }
    ]
  },
  {
    id: 'gummy-bears',
    name: '1 Bag of Gummy Bears (150g)',
    description: 'Pure rapid glycemic carbohydrates for immediate power surges and climb pacing.',
    servings: 1,
    category: 'snack',
    isCustom: false,
    nutrients: {
      calories: 515,
      carbs: 116,
      protein: 10,
      fat: 0,
      sodium: 50,
      fluids: 0
    },
    ingredients: [
      { name: 'Gummy bears (150g)', quantity: 1, unit: 'bag', department: 'Snacks/Candy' }
    ]
  },
  {
    id: 'snickers-bar',
    name: '1 Snickers Bar (52.7g / 1.86 oz)',
    description: 'Legendary bikepacking pocket bar combining peanuts, caramel, nougat, and milk chocolate.',
    servings: 1,
    category: 'snack',
    isCustom: false,
    nutrients: {
      calories: 250,
      carbs: 33,
      protein: 4,
      fat: 12,
      sodium: 120,
      fluids: 0
    },
    ingredients: [
      { name: 'Snickers bar (52.7g)', quantity: 1, unit: 'bar', department: 'Snacks/Candy' }
    ]
  },
  {
    id: 'gatorade',
    name: '1 Bottle Gatorade (591 ml / 20 oz)',
    description: 'Fluid replenishment with isotonic carbohydrates and key electrolyte salts.',
    servings: 1,
    category: 'drink',
    isCustom: false,
    nutrients: {
      calories: 140,
      carbs: 36,
      protein: 0,
      fat: 0,
      sodium: 270,
      fluids: 591
    },
    ingredients: [
      { name: 'Gatorade (591 ml)', quantity: 1, unit: 'bottle', department: 'Beverages' }
    ]
  },
  {
    id: 'water-bottle',
    name: '1 Bottle Water (500 ml / 16.9 oz)',
    description: 'Pure hydration bottle for bidon refills and backcountry freeze-dried rehydration.',
    servings: 1,
    category: 'drink',
    isCustom: false,
    nutrients: {
      calories: 0,
      carbs: 0,
      protein: 0,
      fat: 0,
      sodium: 5,
      fluids: 500
    },
    ingredients: [
      { name: 'Water bottle (500 ml)', quantity: 1, unit: 'bottle', department: 'Beverages' }
    ]
  },
  {
    id: 'pb-honey-tortilla',
    name: 'Peanut Butter & Honey Tortilla Roll-Up',
    description: 'Crushproof bikepacking roll-up combining simple sugars with dense plant lipids.',
    servings: 1,
    category: 'quick_bite',
    isCustom: false,
    nutrients: {
      calories: 460,
      carbs: 60,
      protein: 13,
      fat: 21,
      sodium: 520,
      fluids: 10
    },
    ingredients: [
      { name: 'Flour tortilla (large)', quantity: 1, unit: 'tortilla', department: 'Bakery' },
      { name: 'Peanut butter (32g)', quantity: 2, unit: 'tbsp', department: 'Canned/Protein' },
      { name: 'Honey (21g)', quantity: 1, unit: 'tbsp', department: 'Snacks/Candy' }
    ]
  },
  {
    id: 'trail-pad-thai',
    name: 'Instant Ramen with Tuna / Nut Butter ("Trail Pad Thai")',
    description: 'The ultimate warm bikepacking dinner: instant noodles emulsified with peanut butter and tuna.',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 660,
      carbs: 61,
      protein: 37,
      fat: 31,
      sodium: 1790,
      fluids: 350
    },
    ingredients: [
      { name: 'Instant ramen (85g)', quantity: 1, unit: 'pack', department: 'Canned/Protein' },
      { name: 'Tuna pouch (85g)', quantity: 1, unit: 'pouch', department: 'Canned/Protein' },
      { name: 'Peanut butter (32g)', quantity: 2, unit: 'tbsp', department: 'Canned/Protein' },
      { name: 'Soy sauce / seasoning packet', quantity: 1, unit: 'packet', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'breakfast-burrito',
    name: 'Gas Station Breakfast Burrito (150g)',
    description: 'Hearty warm roll stuffed with scrambled eggs, hash browns, cheese, and sausage.',
    servings: 1,
    category: 'quick_bite',
    isCustom: false,
    nutrients: {
      calories: 380,
      carbs: 32,
      protein: 15,
      fat: 22,
      sodium: 780,
      fluids: 30
    },
    ingredients: [
      { name: 'Breakfast burrito (150g)', quantity: 1, unit: 'burrito', department: 'Prepared/Deli' }
    ]
  },
  {
    id: 'pringles',
    name: 'Canister of Pringles (156g / 5.5 oz)',
    description: 'Rigid canister that fits into handlebar roll or feed bag, providing durable sodium and carbs.',
    servings: 1,
    category: 'snack',
    isCustom: false,
    nutrients: {
      calories: 840,
      carbs: 90,
      protein: 6,
      fat: 51,
      sodium: 850,
      fluids: 0
    },
    ingredients: [
      { name: 'Pringles can (156g)', quantity: 1, unit: 'can', department: 'Snacks/Candy' }
    ]
  },
  {
    id: 'chocolate-milk',
    name: 'Chocolate Milk (500 ml / 16 oz)',
    description: 'Optimal 4:1 carb-to-protein ratio recovery beverage with calcium, fluids, and fast sugars.',
    servings: 1,
    category: 'drink',
    isCustom: false,
    nutrients: {
      calories: 380,
      carbs: 58,
      protein: 16,
      fat: 9,
      sodium: 340,
      fluids: 500
    },
    ingredients: [
      { name: 'Chocolate milk (500 ml)', quantity: 1, unit: 'bottle', department: 'Dairy' }
    ]
  }
];
