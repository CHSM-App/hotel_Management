// The user guide's content, written once and filtered to the property reading
// it.
//
// The dashboard already hides sections a property has no capability for — a
// restaurant has no tape chart, a plain lodge has no menu. A guide that
// explained them anyway would be worse than no guide: staff would hunt the
// sidebar for a button that was never going to be there, and conclude the
// software is broken rather than that the manual is generic.
//
// So every section, and every step inside a section, may carry a `when`
// predicate over the property's capability flags. `guideForLodge` resolves the
// whole document against one property's flags, and what comes back describes
// only what that property can actually do.
//
// Flags come from /me's `lodge` object: hasRooms, servesFood, foodRoomService,
// foodTableService, hasEvents. `permission` mirrors FEATURES in
// propertyProfile.js — the same two gates the sidebar uses, so the guide's
// contents and the sidebar's contents cannot disagree.

// A property's type, in the words the customer uses, derived from the same
// flags rather than stored separately — see PROPERTY_TYPES in propertyProfile.
export function describeProperty(lodge) {
  if (!lodge) return { label: 'your property', noun: 'property' };
  if (lodge.hasRooms && lodge.servesFood) {
    return { label: 'a lodge with meals', noun: 'lodge' };
  }
  if (lodge.hasRooms) return { label: 'a lodge', noun: 'lodge' };
  if (lodge.servesFood) return { label: 'a restaurant', noun: 'restaurant' };
  return { label: 'your property', noun: 'property' };
}

// How this property takes food orders, spelled out — the difference between
// room service and table service changes the instructions materially, so it is
// worth saying plainly rather than leaving staff to infer it.
export function describeFoodService(lodge) {
  if (!lodge?.servesFood) return null;
  const rooms = lodge.foodRoomService;
  const tables = lodge.foodTableService;
  if (rooms && tables) return 'to rooms and at dining tables';
  if (rooms) return 'to rooms only';
  if (tables) return 'at dining tables only';
  return null;
}

const SECTIONS = [
  {
    key: 'bookings',
    title: 'Bookings & tape chart',
    permission: 'bookings.manage',
    when: (f) => f.hasRooms,
    summary:
      'The tape chart is the front desk on one screen: every room down the side, every night across the top, each booking a bar you can read at a glance.',
    steps: [
      {
        heading: 'Read the chart',
        body: 'Rooms run down the left, dates across the top. A bar is a booking; its colour is its status. Today’s column is marked, so what needs doing now is always in view.',
      },
      {
        heading: 'Take a booking',
        body: 'Drag across the empty nights in a room’s row, or press New booking. Enter the guest’s name and phone, check the dates and the rate, then save. The bar appears immediately.',
      },
      {
        heading: 'Quote the right rate',
        body: 'The rate is computed from the room’s category and your price chart — season, weekend and any extras. You can override it on the booking when you have agreed a different price.',
      },
      {
        heading: 'Take an advance',
        body: 'Record any deposit against the booking and issue a receipt. It is subtracted automatically when the final bill is raised, so nobody has to remember it at checkout.',
      },
      {
        heading: 'Check the guest in',
        body: 'Open the booking and press Check in. The room becomes occupied and the stay starts counting.',
        when: (f) => !f.foodRoomService,
      },
      {
        heading: 'Check the guest in',
        body: 'Open the booking and press Check in. The room becomes occupied, and a food PIN is issued — the guest uses their room number and that PIN to order from their own phone.',
        when: (f) => f.foodRoomService,
      },
      {
        heading: 'Move or extend a stay',
        body: 'Drag the bar to another room to move it, or drag its right edge to add nights. A move that would double-book a room is refused, so a clash cannot be saved by accident.',
      },
      {
        heading: 'Check out and bill',
        body: 'Open the booking and press Check out, then Bill now. The nights, any late-checkout charge and the tax are worked out for you.',
      },
    ],
    notes: [
      {
        text: 'Food never appears on the stay bill. Room-service orders are settled on their own food bill against the room, so a guest who ordered meals leaves with two documents, not one.',
        when: (f) => f.servesFood,
      },
      {
        text: 'Checking out clears the guest’s food PIN. Their phone stops being able to order the moment they leave, with nothing for you to switch off.',
        when: (f) => f.foodRoomService,
      },
      {
        text: 'A booking is never deleted once it has been billed. Cancel it or void the bill instead — the record of what happened has to survive.',
      },
    ],
  },

  {
    key: 'billing',
    title: 'Billing & Invoices',
    permission: 'billing.manage',
    // No capability gate, exactly as in FEATURES: every property sells
    // something, and this screen adapts to what that is.
    summary:
      'Every document the property issues — tax invoices, bills of supply, advance receipts, and the record of what was actually collected.',
    steps: [
      {
        heading: 'Bill a stay',
        body: 'Find the checked-out booking and press Bill now. Nights, late checkout and tax are computed; you confirm rather than calculate. Any advance already taken comes off the balance.',
        when: (f) => f.hasRooms,
      },
      {
        heading: 'Close a table',
        body: 'Open tabs are listed by where the food went. Pick the table, check the items, and settle it. The party’s whole visit closes on one bill.',
        when: (f) => f.foodTableService,
      },
      {
        heading: 'Settle a room’s food',
        body: 'Food ordered to a room is its own tab, separate from the stay. Settle it against the room whether or not anyone is still checked in.',
        when: (f) => f.foodRoomService,
      },
      {
        heading: 'Bill a takeaway',
        body: 'Each counter order bills on its own — one walk-in, one bill. A day of takeaways never piles into a single tab where the first person to pay would cover everyone.',
        when: (f) => f.servesFood,
      },
      {
        heading: 'Take the payment',
        body: 'Record how it was paid — cash, card, UPI, or a split across them. What you enter is what the day’s collection report will show, so record the split as it actually happened.',
      },
      {
        heading: 'Apply a discount',
        body: 'Enter a discount, or type the total you have agreed and let the system work backwards to the discount that produces it. Give a reason — it prints on the bill.',
      },
      {
        heading: 'Fix a mistake',
        body: 'A wrong bill is voided and reissued, never edited or deleted. The void stays on the record, which is what keeps the number sequence honest.',
      },
    ],
    notes: [
      {
        text: 'Bill numbers run in an unbroken sequence and are never reused. A gap in the series is the first thing an audit asks about, so the system will not create one.',
      },
      {
        text: 'Issuing a bill stamps its orders, so the same food cannot be billed twice — even if someone opens the tab again.',
        when: (f) => f.servesFood,
      },
      {
        text: 'Rooms and food are taxed at different rates and are shown separately on the document. That separation is a GST requirement, not a display choice.',
        when: (f) => f.hasRooms && f.servesFood,
      },
    ],
  },

  {
    key: 'guests',
    title: 'Booking Details',
    permission: 'guests.view',
    when: (f) => f.hasRooms,
    summary:
      'The guest register — who stayed, the ID they showed, and the vehicles on the property. This is the record you produce when the police or an inspector asks for it.',
    steps: [
      {
        heading: 'Record every occupant',
        body: 'Add each person staying, not only the one who booked. The count here should match the people actually in the room.',
      },
      {
        heading: 'Capture the ID',
        body: 'Record the ID type and number for the main guest, and upload a photo of it where you have one. This is the part an inspection actually checks.',
      },
      {
        heading: 'Note the vehicle',
        body: 'Add the vehicle number if they have parked on the property — it is what lets you match a car to a room later.',
      },
      {
        heading: 'Find an old stay',
        body: 'Search the register by name, phone or dates to pull up a past guest and everything recorded about their stay.',
      },
    ],
    notes: [
      {
        text: 'Fill this in at check-in, while the guest is standing in front of you. Chasing an ID after they have driven off is the one problem this screen cannot solve.',
      },
    ],
  },

  {
    key: 'food',
    title: 'Food orders',
    permission: 'orders.manage',
    when: (f) => f.servesFood,
    summary:
      'The live kitchen queue, and the counter form for taking an order yourself.',
    steps: [
      {
        heading: 'Watch the queue',
        body: 'New orders arrive at the top with a sound. Move each along as the kitchen works: Accept, then Preparing, then Ready, then Delivered.',
      },
      {
        heading: 'Tick off dishes',
        body: 'On a multi-dish ticket the kitchen can mark each dish ready as it comes up, so a long order shows its real progress rather than jumping from nothing to done.',
      },
      {
        heading: 'Take an order at the counter',
        body: 'Press Take an order and choose where it is going. Staff-typed orders skip the accept step and go straight to the kitchen, because you already took them.',
      },
      {
        heading: 'Order to a room',
        body: 'Pick the room and the panel shows who is checked into it. Check that name against the person in front of you before charging food to their stay.',
        when: (f) => f.foodRoomService,
      },
      {
        heading: 'Order for a table',
        body: 'Pick the table and the order joins that table’s tab. The party keeps ordering, and one bill closes the whole visit.',
        when: (f) => f.foodTableService,
      },
      {
        heading: 'Counter and takeaway',
        body: 'For Counter / takeaway the guest’s name and phone are required — the food leaves the building, and that is the only way to call them back or work out whose order it was.',
      },
      {
        heading: 'Cancel an order',
        body: 'Cancel with a reason if the kitchen cannot make it. The reason is kept, which is what tells you later whether you are running out of the same dish every week.',
      },
    ],
    notes: [
      {
        text: 'A guest who gets their food PIN wrong five times locks that room out of ordering for fifteen minutes. They will phone the desk — you can clear the lockout for them without waiting for the timer.',
        when: (f) => f.foodRoomService,
      },
      {
        text: 'Marking an order delivered is not the same as taking the money. Delivered orders stay unbilled until someone settles the tab in Billing.',
      },
    ],
  },

  {
    key: 'events',
    title: 'Events & functions',
    permission: 'events.manage',
    when: (f) => f.hasEvents,
    summary:
      'The function diary for halls and lawns — from a first enquiry through to the final bill.',
    steps: [
      {
        heading: 'Log the enquiry',
        body: 'Create the event with the date, the space and who is asking. It sits in the diary as an enquiry, holding nothing yet.',
      },
      {
        heading: 'Hold the date',
        body: 'Confirm it to a hold so the space shows as taken and nobody books over it.',
      },
      {
        heading: 'Quote and take an advance',
        body: 'Record what was quoted, then the advance when it is paid, and issue a receipt. The advance comes off the final balance automatically.',
      },
      {
        heading: 'Bill the function',
        body: 'Afterwards, add anything extra that was used and raise the bill. Press Settle & bill from the event itself rather than hunting for it in Billing.',
      },
    ],
    notes: [
      {
        text: 'An enquiry holds nothing. Until you confirm it to a hold, the same date can still be promised to somebody else.',
      },
    ],
  },

  {
    key: 'rooms',
    title: 'Rooms & rates',
    permission: 'rooms.manage',
    when: (f) => f.hasRooms,
    summary:
      'Set up once and then largely left alone: your categories, the rooms in them, and the price chart every quoted rate comes from.',
    steps: [
      {
        heading: 'Create categories first',
        body: 'Group rooms by what they are worth — Deluxe, AC, Non-AC. The category carries the base price, so rooms are priced together rather than one at a time.',
      },
      {
        heading: 'Add the rooms',
        body: 'Add rooms into a category with their numbers, beds and maximum occupancy. A numbered run can be added in one go rather than room by room.',
      },
      {
        heading: 'Set seasons and weekends',
        body: 'Layer your season and weekend rules over the base price. Together they produce the rate the booking form quotes.',
      },
      {
        heading: 'Check before you rely on it',
        body: 'Use the price simulator to ask what a given date would quote. Cheaper to check here than to discover it at the desk with a guest waiting.',
      },
      {
        heading: 'Switchable charges',
        body: 'Extras a booking can turn on or off — an extra bed, a heater. Attach each to the rooms that can actually offer it.',
      },
    ],
    notes: [
      {
        text: 'A room with bookings on record cannot be deleted, only deactivated. Deleting it would orphan the stays that belong to it.',
      },
      {
        text: 'Changing a base price affects future quotes only. Bills already issued keep the price they were raised at.',
      },
    ],
  },

  {
    key: 'menu',
    title: 'Menu & QR codes',
    permission: 'food.manage',
    when: (f) => f.servesFood,
    summary:
      'What the kitchen can cook, and how guests order it without an app or a login.',
    steps: [
      {
        heading: 'Build the menu',
        body: 'Add sections, then dishes inside them. Mark each dish veg or non-veg — guests filter on it.',
      },
      {
        heading: 'Dishes sold by size',
        body: 'A dish with portions carries a price per size — Half and Full — instead of one price. Each size can run out on its own.',
      },
      {
        heading: 'Mark what has run out',
        body: 'Turn a dish off when the kitchen runs out. It disappears from the guest menu at once, so nobody orders what you cannot cook. Turn it back on tomorrow.',
      },
      {
        heading: 'Set up dining tables',
        body: 'Add each table with the label printed on it. That label is what appears on the kitchen ticket, so it must match the physical table.',
        when: (f) => f.foodTableService,
      },
      {
        heading: 'Print the QR codes',
        body: 'Print each table’s code and put it on the table. Guests scan it, read the menu, and order without installing anything.',
        when: (f) => f.foodTableService,
      },
      {
        heading: 'Room ordering',
        body: 'Guests in rooms do not scan anything. They open your menu page and enter their room number and the food PIN issued at check-in.',
        when: (f) => f.foodRoomService,
      },
    ],
    notes: [
      {
        text: 'A table’s QR code is printed once and stays valid. Reprint it only if the table label changes.',
        when: (f) => f.foodTableService,
      },
      {
        text: 'Turning a dish off is not the same as deleting it. Use off for tonight’s shortage; delete only for something you will never serve again.',
      },
    ],
  },

  {
    key: 'staff',
    title: 'Staff & roles',
    permission: 'staff.manage',
    summary: 'Who can sign in, and what each of them can reach once they do.',
    steps: [
      {
        heading: 'Add a staff login',
        body: 'Create the person with their phone or email and give them a role. That role decides which sections appear in their sidebar.',
      },
      {
        heading: 'Shape a role',
        body: 'Roles are built from permissions. A receptionist gets bookings and billing; the kitchen gets only the food queue and nothing financial.',
        when: (f) => f.servesFood,
      },
      {
        heading: 'Shape a role',
        body: 'Roles are built from permissions. Give a receptionist bookings and billing, and keep setup and reports for whoever runs the property.',
        when: (f) => !f.servesFood,
      },
      {
        heading: 'When someone leaves',
        body: 'Deactivate the login rather than deleting it. Their name stays attached to the bills and bookings they raised, which is what an audit needs.',
      },
    ],
    notes: [
      {
        text: 'Everyone should have their own login. On a shared one, a bill cannot be traced back to whoever raised it.',
      },
    ],
  },

  {
    key: 'reports',
    title: 'Report & Analytics',
    permission: 'reports.view',
    when: (f) => f.hasRooms,
    summary: 'What the property did, in a form you can hand to an accountant or a bank.',
    steps: [
      {
        heading: 'Pick the period',
        body: 'Choose the dates you want. Everything on the screen follows that range.',
      },
      {
        heading: 'Read the occupancy',
        body: 'How full the property was and what the rooms earned, so you can compare this month against the last one honestly.',
      },
      {
        heading: 'Download the booking report',
        body: 'The full list of stays over the period, as a file you can keep or send on.',
      },
      {
        heading: 'The GST summary',
        body: 'Totals what was collected at each tax rate, split the way a return asks for it. This is the page your accountant wants.',
      },
    ],
  },
];

// Advice that holds wherever the reader happens to be. Always shown first on
// the page, because the commonest question from new staff is not "how do I
// bill" but "why does my screen look different from hers".
export const GUIDE_INTRO = {
  key: 'start',
  title: 'Getting started',
  summary:
    'The sidebar on the dashboard is your menu. Front desk is the day-to-day work, Setup is what you configure once, and Insights is what the property did.',
  steps: [
    {
      heading: 'You only see what you can use',
      body: 'The sections in your sidebar depend on your role and on what this property offers. A shorter menu than a colleague’s is not a fault — it is the role you were given.',
    },
    {
      heading: 'Signing in',
      body: 'Use the phone or email your manager registered, and your own password. Everyone gets their own login, so the work can be traced back to whoever did it.',
    },
    {
      heading: 'This guide follows the property',
      body: 'What you are reading below describes only what this property actually has switched on. Anything not listed is not hidden from you — it simply is not part of this setup.',
    },
  ],
  notes: [],
};

const passes = (entry, flags) => (typeof entry.when === 'function' ? entry.when(flags) : true);

// Resolves the whole guide against one property's capabilities and one user's
// permissions. Steps and notes are filtered as well as sections — this is what
// stops a rooms-only lodge being told to print table QR codes, and a
// receptionist being walked through a screen they cannot open.
//
// A section whose steps all filter out is dropped rather than rendered empty.
export function guideForLodge(lodge, permissions = []) {
  const flags = {
    hasRooms: !!lodge?.hasRooms,
    servesFood: !!lodge?.servesFood,
    foodRoomService: !!lodge?.foodRoomService,
    foodTableService: !!lodge?.foodTableService,
    hasEvents: !!lodge?.hasEvents,
  };

  const sections = SECTIONS.filter(
    (s) => passes(s, flags) && (!s.permission || permissions.includes(s.permission))
  )
    .map((section) => ({
      ...section,
      steps: section.steps.filter((step) => passes(step, flags)),
      notes: (section.notes || []).filter((note) => passes(note, flags)).map((n) => n.text),
    }))
    .filter((section) => section.steps.length > 0);

  return [GUIDE_INTRO, ...sections];
}
