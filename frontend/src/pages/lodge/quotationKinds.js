export const KINDS = [
  { key: 'ROOM', label: 'Room' },
  { key: 'EVENT', label: 'Event' },
  { key: 'FOOD', label: 'Restaurant' },
  { key: 'BAR', label: 'Bar' },
];

export const KIND_LABEL = { ROOM: 'Room', EVENT: 'Event', FOOD: 'Restaurant', BAR: 'Bar' };

export const isIndianMobile = (digits) => /^[6-9]\d{9}$/.test(digits);

// Mirrors KIND_PERMISSIONS in backend/src/modules/quotations/quotations.service.js.
export const quotableKinds = (permissions = []) => {
  const has = (...keys) => keys.some((k) => permissions.includes(k));
  return [
    has('rooms.manage', 'bookings.manage') && 'ROOM',
    has('events.manage') && 'EVENT',
    has('orders.manage', 'orders.take') && 'FOOD',
    has('bar.manage', 'bar.take', 'bar.bill') && 'BAR',
  ].filter(Boolean);
};
