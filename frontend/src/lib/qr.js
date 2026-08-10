import QRCode from 'qrcode';

// QR codes are generated in the browser, never fetched. These end up printed
// and stuck to a door or a table, so they have to render on a lodge's patchy
// connection and keep working if our server is unreachable at print time.
//
// Error correction level M tolerates roughly 15% damage, which is what a
// laminated card by a kitchen door needs; H would buy more at the cost of a
// denser code that cheap printers smudge.
export async function toQrDataUrl(text, { size = 240, margin = 1 } = {}) {
  return QRCode.toDataURL(text, {
    width: size,
    margin,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// The URLs the codes encode. Kept here so the printed sheet and the router
// can't drift apart — a QR that 404s is only discovered after it's on a wall.

// One code for the whole property. Guests scan it anywhere — in their room, at
// reception, on a table tent — and identify their room at checkout with the PIN
// issued at check-in. There is deliberately no per-room URL: the room number
// would be in the address without proving anything, and an endpoint that
// resolved it would report which rooms are occupied to anyone with the link.
export function orderUrl(origin, slug) {
  return `${origin}/order/${slug}`;
}

export function tableOrderUrl(origin, token) {
  return `${origin}/order/t/${token}`;
}
