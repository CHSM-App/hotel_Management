// A latitude/longitude pair as the forms hold it: two strings, so a half-typed
// "15." can exist without anything lurching, checked once on submit.

export function parseCoordinate(value) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// Six decimal places is what the column stores (about 10 cm); trailing zeros
// are trimmed so a typed "15.86" is not rewritten as "15.860000".
export function formatCoordinate(n) {
  return String(Number(n.toFixed(6)));
}

// Returns the numbers to send (null when the pin is empty) or a message the
// form can show. Shared by the picker and the forms, so what a form rejects
// is exactly what the picker refuses to draw.
export function validateCoordinates({ latitude, longitude }) {
  const latText = String(latitude ?? '').trim();
  const lngText = String(longitude ?? '').trim();
  if (latText === '' && lngText === '') return { ok: true, latitude: null, longitude: null };
  if (latText === '' || lngText === '') {
    return { ok: false, message: 'Enter both latitude and longitude, or leave both empty.' };
  }
  const lat = parseCoordinate(latText);
  const lng = parseCoordinate(lngText);
  if (lat === null || lng === null) return { ok: false, message: 'Latitude and longitude must be numbers.' };
  if (lat < -90 || lat > 90) return { ok: false, message: 'Latitude must be between -90 and 90.' };
  if (lng < -180 || lng > 180) return { ok: false, message: 'Longitude must be between -180 and 180.' };
  return { ok: true, latitude: lat, longitude: lng };
}

// "15.86, 73.63" pasted into either box — the shape Google Maps copies — fills
// both rather than jamming the whole thing into one.
export function splitCoordinatePair(text) {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 2 && parseCoordinate(parts[0]) !== null && parseCoordinate(parts[1]) !== null) {
    return { latitude: parts[0], longitude: parts[1] };
  }
  return null;
}
