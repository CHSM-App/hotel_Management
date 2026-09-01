import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCoordinate, splitCoordinatePair, validateCoordinates } from '../lib/coordinates';
import './LocationPicker.css';

// Where a property is, as a pin: a latitude/longitude pair typed in by hand,
// pasted from Google Maps, picked off a map, or taken from the browser's own
// position when staff are standing at the property.
//
// The two inputs are the source of truth and the map follows them: typing a
// valid pair moves the pin, clicking or dragging writes the pair back through
// onChange. Values travel as strings, like every other form field.
//
// Leaflet and its stylesheet are loaded on first render rather than bundled
// with the rest of the app — only internal staff ever see this control, and
// the guest-facing pages should not carry a map library for it. If the load
// fails (offline, blocked), the inputs still work and say so.

// Vengurla, where most of this system's properties are. Only the starting
// view; the pin goes wherever staff put it.
const DEFAULT_CENTER = [15.86, 73.63];
const DEFAULT_ZOOM = 12;
const PIN_ZOOM = 16;

const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export default function LocationPicker({ latitude, longitude, onChange, idPrefix = 'location', disabled = false }) {
  const mapEl = useRef(null);
  // Everything Leaflet-side lives here rather than in state: none of it is
  // rendered by React, and re-rendering on every drag would be wasteful.
  const mapRef = useRef(null);
  // Leaflet's click/drag handlers are bound once at mount; this keeps them
  // calling the latest onChange rather than the one from the first render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [mapState, setMapState] = useState('loading'); // loading | ready | failed
  const [notice, setNotice] = useState(null); // { tone: 'info' | 'error', text }

  const check = validateCoordinates({ latitude, longitude });
  const hasPin = check.ok && check.latitude !== null;
  const pinLat = hasPin ? check.latitude : null;
  const pinLng = hasPin ? check.longitude : null;

  const setPin = useCallback((lat, lng) => {
    onChangeRef.current({ latitude: formatCoordinate(lat), longitude: formatCoordinate(lng) });
  }, []);

  const placeMarker = useCallback(
    (lat, lng, pan) => {
      const ctx = mapRef.current;
      if (!ctx) return;
      if (!ctx.marker) {
        ctx.marker = ctx.L.marker([lat, lng], { draggable: !ctx.disabled, icon: ctx.pinIcon }).addTo(ctx.map);
        ctx.marker.on('dragend', () => {
          const p = ctx.marker.getLatLng();
          setNotice(null);
          setPin(p.lat, p.lng);
        });
      } else {
        ctx.marker.setLatLng([lat, lng]);
      }
      if (pan) ctx.map.setView([lat, lng], Math.max(ctx.map.getZoom(), PIN_ZOOM));
    },
    [setPin]
  );

  const setField = (key) => (e) => {
    const value = e.target.value;
    const pair = splitCoordinatePair(value);
    onChange(pair ?? { latitude, longitude, [key]: value });
  };

  const clearPin = () => {
    setNotice(null);
    onChange({ latitude: '', longitude: '' });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setNotice({ tone: 'error', text: 'This browser cannot report its location. Type the coordinates instead.' });
      return;
    }
    setNotice({ tone: 'info', text: 'Finding your location…' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin(pos.coords.latitude, pos.coords.longitude);
        const accuracy = Math.round(pos.coords.accuracy || 0);
        setNotice({
          tone: 'info',
          text: accuracy
            ? `Pin set to your location (accurate to about ${accuracy} m). Drag it to correct.`
            : 'Pin set to your location. Drag it to correct.',
        });
      },
      () => {
        setNotice({ tone: 'error', text: 'Could not get your location. Allow location access, or click the map.' });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  // Mount the map once. The pin at mount seeds the view; every change after
  // that goes through the sync effect below, which is why this deliberately
  // does not re-run when the pin moves.
  useEffect(() => {
    let cancelled = false;
    const initialPin = hasPin ? [pinLat, pinLng] : null;

    (async () => {
      try {
        const [leaflet, , icon, iconRetina, shadow] = await Promise.all([
          import('leaflet'),
          import('leaflet/dist/leaflet.css'),
          import('leaflet/dist/images/marker-icon.png'),
          import('leaflet/dist/images/marker-icon-2x.png'),
          import('leaflet/dist/images/marker-shadow.png'),
        ]);
        if (cancelled || !mapEl.current) return;
        const L = leaflet.default ?? leaflet;

        const map = L.map(mapEl.current, {
          center: initialPin ?? DEFAULT_CENTER,
          zoom: initialPin ? PIN_ZOOM : DEFAULT_ZOOM,
          // Off until the map is clicked, so scrolling down a long form does
          // not get caught zooming the map instead.
          scrollWheelZoom: false,
        });
        map.on('focus', () => map.scrollWheelZoom.enable());
        map.on('blur', () => map.scrollWheelZoom.disable());

        L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map);

        // Leaflet works out its default icon's URL from the stylesheet's path,
        // which a bundler breaks; naming the files explicitly sidesteps that.
        const pinIcon = L.icon({
          iconUrl: icon.default,
          iconRetinaUrl: iconRetina.default,
          shadowUrl: shadow.default,
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          shadowSize: [41, 41],
        });

        map.on('click', (e) => {
          if (mapRef.current?.disabled) return;
          setNotice(null);
          setPin(e.latlng.lat, e.latlng.lng);
        });

        mapRef.current = { L, map, marker: null, pinIcon, disabled: false };
        if (initialPin) placeMarker(initialPin[0], initialPin[1], false);
        setMapState('ready');
        // The container may have been laid out after Leaflet measured it (a
        // modal opening, a column settling); one more measure once painted.
        setTimeout(() => map.invalidateSize(), 0);
      } catch {
        if (!cancelled) setMapState('failed');
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.map.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeMarker, setPin]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    ctx.disabled = disabled;
    if (ctx.marker) {
      if (disabled) ctx.marker.dragging?.disable();
      else ctx.marker.dragging?.enable();
    }
  }, [disabled, mapState]);

  // Inputs → map. A pin that arrived from the map itself is already where the
  // marker is, so the view is left alone; a typed or pasted pair pans to it.
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || mapState !== 'ready') return;
    if (!hasPin) {
      if (ctx.marker) {
        ctx.marker.remove();
        ctx.marker = null;
      }
      return;
    }
    const current = ctx.marker?.getLatLng();
    const alreadyThere =
      current && Math.abs(current.lat - pinLat) < 1e-6 && Math.abs(current.lng - pinLng) < 1e-6;
    if (!alreadyThere) placeMarker(pinLat, pinLng, true);
  }, [mapState, hasPin, pinLat, pinLng, placeMarker]);

  const pairError = !check.ok ? check.message : '';

  return (
    <div className="locpick">
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-lat`}>Latitude</label>
          <input
            id={`${idPrefix}-lat`}
            inputMode="decimal"
            autoComplete="off"
            value={latitude ?? ''}
            onChange={setField('latitude')}
            placeholder="15.860000"
            disabled={disabled}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-lng`}>Longitude</label>
          <input
            id={`${idPrefix}-lng`}
            inputMode="decimal"
            autoComplete="off"
            value={longitude ?? ''}
            onChange={setField('longitude')}
            placeholder="73.630000"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="locpick__actions">
        <button type="button" className="locpick__btn" onClick={useMyLocation} disabled={disabled}>
          Use my current location
        </button>
        <button
          type="button"
          className="locpick__btn"
          onClick={clearPin}
          disabled={disabled || (!latitude && !longitude)}
        >
          Clear pin
        </button>
        {hasPin && (
          <a
            className="locpick__link"
            href={`https://www.google.com/maps?q=${pinLat},${pinLng}`}
            target="_blank"
            rel="noreferrer"
          >
            Check on Google Maps ↗
          </a>
        )}
      </div>

      {pairError && <p className="locpick__status locpick__status--error">{pairError}</p>}
      {!pairError && notice && (
        <p className={`locpick__status ${notice.tone === 'error' ? 'locpick__status--error' : ''}`}>
          {notice.text}
        </p>
      )}

      <div className={`locpick__map ${disabled ? 'locpick__map--disabled' : ''}`}>
        <div ref={mapEl} className="locpick__canvas" aria-label="Map — click to place the pin" />
        {mapState === 'loading' && <div className="locpick__overlay">Loading map…</div>}
        {mapState === 'failed' && (
          <div className="locpick__overlay">
            The map could not load. Type the coordinates, or paste them from Google Maps.
          </div>
        )}
      </div>

      <p className="locpick__hint">
        Click the map to drop the pin and drag it to the entrance. Or, in Google Maps, right-click the
        spot and click the coordinates to copy them, then paste into either box.
      </p>
    </div>
  );
}
