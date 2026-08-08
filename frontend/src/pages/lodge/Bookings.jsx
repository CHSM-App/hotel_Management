import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPatchForm, apiPostForm, apiGetBlob, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './chartSections.css';
import './tapeChart.css';
import './Bookings.css';

const DAYS_VISIBLE = 10;
const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];
const ID_PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const ID_PROOF_MAX_BYTES = 5 * 1024 * 1024;
const STATUS_LABEL = { BOOKED: 'Booked', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' };
const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const BATHROOM_TYPE_LABEL = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Check-in eligibility has to go by the IST calendar date specifically —
// every lodge on this system is in India, and UTC lags IST by up to 5.5
// hours, so plain todayIso() would still read "yesterday" for the first
// few hours of an IST day. Kept separate from todayIso() (used elsewhere
// just for UI defaults) so this stays matched to the backend's own guard.
function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function formatDateHead(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
  };
}

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const emptyGuest = { name: '', phone: '', idProofType: '', idProofFile: null };

const initialNewBooking = {
  bookingType: 'WALK_IN',
  checkInDate: todayIso(),
  checkOutDate: addDays(todayIso(), 1),
  roomId: '',
  switchableChargeIds: [],
  guestName: '',
  guestPhone: '',
  numGuests: 1,
  idProofType: '',
  idProofFile: null,
  advanceAmount: '',
  advancePaymentMethod: '',
  guests: [],
  vehicleNumbers: [],
};

export default function Bookings({ onCheckedOut }) {
  const session = getSession();
  const token = session?.token;

  const [rangeStart, setRangeStart] = useState(todayIso());
  const [tapeData, setTapeData] = useState(null);
  const [tapeError, setTapeError] = useState('');

  const dates = useMemo(
    () => Array.from({ length: DAYS_VISIBLE }, (_, i) => addDays(rangeStart, i)),
    [rangeStart]
  );
  const rangeEnd = useMemo(() => addDays(rangeStart, DAYS_VISIBLE), [rangeStart]);

  const loadTapeChart = () => {
    apiGet(`/bookings/tape-chart?startDate=${rangeStart}&endDate=${rangeEnd}`, { token })
      .then((data) => {
        setTapeData(data);
        setTapeError('');
      })
      .catch((err) => {
        setTapeError(err instanceof ApiError ? err.message : 'Could not load the tape chart.');
      });
  };

  useEffect(() => {
    loadTapeChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart]);

  // New booking modal
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [newBooking, setNewBooking] = useState(initialNewBooking);
  const [availableRooms, setAvailableRooms] = useState(null);
  const [availableRoomsError, setAvailableRoomsError] = useState('');
  const [quote, setQuote] = useState(null);
  const [newBookingError, setNewBookingError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openNewBooking = (presetRoomId, presetDate) => {
    const checkInDate = presetDate || todayIso();
    setNewBooking({
      ...initialNewBooking,
      checkInDate,
      checkOutDate: addDays(checkInDate, 1),
      roomId: presetRoomId ? String(presetRoomId) : '',
      // Walk-in means "the guest is here now" — not a valid concept for a
      // future date, so a tape-chart click on a later day starts the form
      // as a pre-reservation instead of silently offering an option that
      // would fail at check-in time.
      bookingType: checkInDate > todayIso() ? 'RESERVATION' : 'WALK_IN',
    });
    setNewBookingError('');
    setAvailableRooms(null);
    setQuote(null);
    setShowNewBooking(true);
  };

  const closeNewBooking = () => {
    if (submitting) return;
    setShowNewBooking(false);
  };

  const validRange =
    newBooking.checkInDate && newBooking.checkOutDate && newBooking.checkOutDate > newBooking.checkInDate;
  const isFutureCheckIn = newBooking.checkInDate > todayIso();
  // A pre-reservation can be held without ID proof; a walk-in is standing at
  // the desk, so theirs is captured on the spot.
  const idProofOptional = newBooking.bookingType === 'RESERVATION';

  useEffect(() => {
    if (!showNewBooking || !validRange) return;
    apiGet(
      `/bookings/available-rooms?checkInDate=${newBooking.checkInDate}&checkOutDate=${newBooking.checkOutDate}`,
      { token }
    )
      .then((data) => {
        setAvailableRooms(data.rooms);
        setAvailableRoomsError('');
        setNewBooking((f) => (f.roomId && data.rooms.some((r) => String(r.id) === f.roomId) ? f : { ...f, roomId: '', switchableChargeIds: [] }));
      })
      .catch((err) => {
        setAvailableRooms([]);
        setAvailableRoomsError(err instanceof ApiError ? err.message : 'Could not load available rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewBooking, newBooking.checkInDate, newBooking.checkOutDate]);

  useEffect(() => {
    if (!showNewBooking || !validRange || !newBooking.roomId) {
      setQuote(null);
      return;
    }
    const chargeIds = newBooking.switchableChargeIds.join(',');
    apiGet(
      `/bookings/price-quote?roomId=${newBooking.roomId}&checkInDate=${newBooking.checkInDate}&checkOutDate=${newBooking.checkOutDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}`,
      { token }
    )
      .then((data) => setQuote(data))
      .catch(() => setQuote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewBooking, newBooking.roomId, newBooking.checkInDate, newBooking.checkOutDate, newBooking.switchableChargeIds]);

  const selectedRoom = availableRooms?.find((r) => String(r.id) === newBooking.roomId);
  const overOccupancy = Boolean(
    selectedRoom?.maxOccupancy && Number(newBooking.numGuests) > selectedRoom.maxOccupancy
  );

  const toggleCharge = (chargeId) => {
    setNewBooking((f) => ({
      ...f,
      switchableChargeIds: f.switchableChargeIds.includes(chargeId)
        ? f.switchableChargeIds.filter((id) => id !== chargeId)
        : [...f.switchableChargeIds, chargeId],
    }));
  };

  // Guest details are captured for at least the primary guest (guestName/
  // guestPhone above); staff can optionally add details for the rest, up to
  // numGuests total.
  const maxAdditionalGuests = Math.max(0, (Number(newBooking.numGuests) || 1) - 1);

  const handleNumGuestsChange = (value) => {
    setNewBooking((f) => {
      const maxAdditional = Math.max(0, (Number(value) || 1) - 1);
      return { ...f, numGuests: value, guests: f.guests.slice(0, maxAdditional) };
    });
  };

  const addGuest = () => {
    setNewBooking((f) =>
      f.guests.length >= maxAdditionalGuests ? f : { ...f, guests: [...f.guests, { ...emptyGuest }] }
    );
  };

  const removeGuest = (index) => {
    setNewBooking((f) => ({ ...f, guests: f.guests.filter((_, i) => i !== index) }));
  };

  const updateGuest = (index, patch) => {
    setNewBooking((f) => ({
      ...f,
      guests: f.guests.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));
  };

  const addVehicle = () => {
    setNewBooking((f) => ({ ...f, vehicleNumbers: [...f.vehicleNumbers, ''] }));
  };

  const removeVehicle = (index) => {
    setNewBooking((f) => ({ ...f, vehicleNumbers: f.vehicleNumbers.filter((_, i) => i !== index) }));
  };

  const updateVehicle = (index, value) => {
    setNewBooking((f) => ({
      ...f,
      vehicleNumbers: f.vehicleNumbers.map((v, i) => (i === index ? value : v)),
    }));
  };

  const handleCreateBooking = async (e) => {
    e.preventDefault();
    setNewBookingError('');

    if (!validRange) {
      setNewBookingError('Check-out date must be after check-in date.');
      return;
    }
    // Belt-and-braces: the UI already hides Walk-in for a future date, but
    // a walk-in for a date that hasn't arrived would try to check itself in
    // immediately after creating the booking — and the backend's check-in
    // guard would reject that, leaving the booking created but the form
    // showing an error, as if it had failed outright.
    if (newBooking.bookingType === 'WALK_IN' && isFutureCheckIn) {
      setNewBookingError('Walk-in isn’t available for a future check-in date — switch to pre-reservation.');
      return;
    }
    if (!newBooking.roomId) {
      setNewBookingError('Choose a room.');
      return;
    }
    if (!newBooking.guestName.trim()) {
      setNewBookingError('Enter the guest name.');
      return;
    }
    if (!newBooking.guestPhone.trim()) {
      setNewBookingError('Enter the guest phone number.');
      return;
    }
    // A walk-in guest is here now, so their ID proof is captured immediately;
    // a pre-reservation defers it to whenever they actually check in.
    if (newBooking.bookingType === 'WALK_IN') {
      if (!newBooking.idProofType) {
        setNewBookingError('Choose the ID proof type.');
        return;
      }
      if (!newBooking.idProofFile) {
        setNewBookingError('Upload the guest’s ID proof (image or PDF).');
        return;
      }
    }
    if (newBooking.idProofFile && newBooking.idProofFile.size > ID_PROOF_MAX_BYTES) {
      setNewBookingError('ID proof file must be 5MB or smaller.');
      return;
    }
    const hasAdvanceAmount = newBooking.advanceAmount.trim() !== '';
    if (hasAdvanceAmount && !newBooking.advancePaymentMethod) {
      setNewBookingError('Choose a payment method for the advance amount.');
      return;
    }
    if (newBooking.guests.some((g) => !g.name.trim())) {
      setNewBookingError('Enter a name for each additional guest, or remove the empty row.');
      return;
    }
    if (newBooking.guests.some((g) => g.idProofFile && g.idProofFile.size > ID_PROOF_MAX_BYTES)) {
      setNewBookingError('Each ID proof file must be 5MB or smaller.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('roomId', String(Number(newBooking.roomId)));
      formData.append('checkInDate', newBooking.checkInDate);
      formData.append('checkOutDate', newBooking.checkOutDate);
      formData.append('guestName', newBooking.guestName.trim());
      formData.append('guestPhone', newBooking.guestPhone.trim());
      formData.append('numGuests', String(Number(newBooking.numGuests) || 1));
      formData.append('switchableChargeIds', JSON.stringify(newBooking.switchableChargeIds));
      if (newBooking.idProofType) formData.append('idProofType', newBooking.idProofType);
      if (newBooking.idProofFile) formData.append('idProofDocument', newBooking.idProofFile);
      if (hasAdvanceAmount) {
        formData.append('advanceAmount', String(Number(newBooking.advanceAmount)));
        formData.append('advancePaymentMethod', newBooking.advancePaymentMethod);
      }

      formData.append(
        'vehicleNumbers',
        JSON.stringify(newBooking.vehicleNumbers.map((v) => v.trim()).filter(Boolean))
      );

      formData.append(
        'guests',
        JSON.stringify(
          newBooking.guests.map((g) => ({
            name: g.name.trim(),
            phone: g.phone.trim(),
            ...(g.idProofType ? { idProofType: g.idProofType } : {}),
          }))
        )
      );
      newBooking.guests.forEach((g, i) => {
        if (g.idProofFile) formData.append(`guestIdProofDocument_${i}`, g.idProofFile);
      });

      const created = await apiPostForm('/bookings', formData, { token });
      if (newBooking.bookingType === 'WALK_IN') {
        await apiPatch(`/bookings/${created.id}/check-in`, {}, { token });
      }
      setShowNewBooking(false);
      loadTapeChart();
    } catch (err) {
      setNewBookingError(err instanceof ApiError ? err.message : 'Could not create the booking.');
    } finally {
      setSubmitting(false);
    }
  };

  // Booking detail modal
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [bookingDetail, setBookingDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [showCheckInForm, setShowCheckInForm] = useState(false);
  const initialCheckInForm = {
    advanceAmount: '',
    advancePaymentMethod: '',
    idProofType: '',
    idProofFile: null,
    guests: [],
    vehicleNumbers: [],
  };
  const [checkInForm, setCheckInForm] = useState(initialCheckInForm);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  // A booking stays editable for its whole life, right up until its bill is
  // issued — a guest might extend their stay, switch rooms, add someone to
  // the party, or the front desk just mistyped a phone number. Room and
  // check-out date edits are further restricted to BOOKED/CHECKED_IN by the
  // backend — once checked out there's no "stay" left to move or extend,
  // only extras can still be corrected.
  const [showEditBooking, setShowEditBooking] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editAvailableRooms, setEditAvailableRooms] = useState(null);
  const [editAvailableRoomsError, setEditAvailableRoomsError] = useState('');
  const [editQuote, setEditQuote] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');

  const canEditBooking = Boolean(
    bookingDetail && bookingDetail.status !== 'CANCELLED' && !bookingDetail.hasIssuedInvoice
  );
  const canEditStayDetails = Boolean(
    canEditBooking && (bookingDetail.status === 'BOOKED' || bookingDetail.status === 'CHECKED_IN')
  );

  // A pre-reservation holds the room for a future date — check-in only
  // opens once that date arrives, matching the backend's own guard.
  const canCheckInNow = Boolean(bookingDetail && bookingDetail.checkInDate <= todayIsoIST());

  const openEditBooking = () => {
    setEditForm({
      checkOutDate: bookingDetail.checkOutDate,
      roomId: String(bookingDetail.roomId),
      numGuests: String(bookingDetail.numGuests),
      guestName: bookingDetail.guestName,
      guestPhone: bookingDetail.guestPhone,
      switchableChargeIds: bookingDetail.switchableCharges.map((c) => c.id),
    });
    setEditAvailableRooms(null);
    setEditAvailableRoomsError('');
    setEditQuote(null);
    setEditError('');
    setShowCheckInForm(false);
    setShowEditBooking(true);
  };

  const toggleEditFormCharge = (chargeId) => {
    setEditForm((f) => ({
      ...f,
      switchableChargeIds: f.switchableChargeIds.includes(chargeId)
        ? f.switchableChargeIds.filter((id) => id !== chargeId)
        : [...f.switchableChargeIds, chargeId],
    }));
  };

  useEffect(() => {
    if (!showEditBooking || !canEditStayDetails || !editForm?.checkOutDate) return;
    apiGet(`/bookings/${selectedBookingId}/available-rooms?checkOutDate=${editForm.checkOutDate}`, { token })
      .then((data) => {
        setEditAvailableRooms(data.rooms);
        setEditAvailableRoomsError('');
      })
      .catch((err) => {
        setEditAvailableRooms([]);
        setEditAvailableRoomsError(err instanceof ApiError ? err.message : 'Could not load available rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditBooking, editForm?.checkOutDate]);

  useEffect(() => {
    if (!showEditBooking || !editForm?.roomId || !bookingDetail) {
      setEditQuote(null);
      return;
    }
    const chargeIds = editForm.switchableChargeIds.join(',');
    apiGet(
      `/bookings/price-quote?roomId=${editForm.roomId}&checkInDate=${bookingDetail.checkInDate}&checkOutDate=${editForm.checkOutDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}`,
      { token }
    )
      .then((data) => setEditQuote(data))
      .catch(() => setEditQuote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditBooking, editForm?.roomId, editForm?.checkOutDate, editForm?.switchableChargeIds]);

  const handleSaveEditBooking = async (e) => {
    e.preventDefault();
    setEditError('');

    if (canEditStayDetails) {
      if (!editForm.checkOutDate || editForm.checkOutDate <= bookingDetail.checkInDate) {
        setEditError('Check-out date must be after check-in date.');
        return;
      }
      if (!editForm.roomId) {
        setEditError('Choose a room.');
        return;
      }
      if (!editForm.numGuests || Number(editForm.numGuests) <= 0) {
        setEditError('Enter a guest count greater than 0.');
        return;
      }
      if (!editForm.guestName.trim()) {
        setEditError('Enter the guest name.');
        return;
      }
      if (!editForm.guestPhone.trim()) {
        setEditError('Enter the guest phone number.');
        return;
      }
    }

    setEditSubmitting(true);
    try {
      const body = canEditStayDetails
        ? {
            checkOutDate: editForm.checkOutDate,
            roomId: Number(editForm.roomId),
            numGuests: Number(editForm.numGuests),
            guestName: editForm.guestName.trim(),
            guestPhone: editForm.guestPhone.trim(),
            switchableChargeIds: editForm.switchableChargeIds,
          }
        : { switchableChargeIds: editForm.switchableChargeIds };

      const { booking } = await apiPatch(`/bookings/${selectedBookingId}`, body, { token });
      setBookingDetail(booking);
      setShowEditBooking(false);
      loadTapeChart();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not save these changes.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const openDetail = (bookingId) => {
    setSelectedBookingId(bookingId);
    setBookingDetail(null);
    setDetailError('');
    setShowCheckInForm(false);
    setCheckInForm(initialCheckInForm);
    setActionError('');
    setIdProofError('');
    setShowEditBooking(false);
    setEditForm(null);
    setEditError('');
  };

  // At booking time only the primary guest is required — a pre-booked stay
  // might arrive with more guests or a vehicle the guest couldn't name in
  // advance, so check-in can add to whatever guests/vehicles already exist.
  const maxAdditionalGuestsAtCheckIn = bookingDetail
    ? Math.max(0, bookingDetail.numGuests - 1 - bookingDetail.guests.length - checkInForm.guests.length)
    : 0;

  // A walk-in booking already has its ID proof on file; a pre-reservation
  // doesn't, so check-in is where it becomes required.
  const needsIdProofAtCheckIn = Boolean(bookingDetail && !bookingDetail.idProofType);

  const addCheckInGuest = () => {
    setCheckInForm((f) =>
      maxAdditionalGuestsAtCheckIn <= 0 ? f : { ...f, guests: [...f.guests, { ...emptyGuest }] }
    );
  };

  const removeCheckInGuest = (index) => {
    setCheckInForm((f) => ({ ...f, guests: f.guests.filter((_, i) => i !== index) }));
  };

  const updateCheckInGuest = (index, patch) => {
    setCheckInForm((f) => ({
      ...f,
      guests: f.guests.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));
  };

  const addCheckInVehicle = () => {
    setCheckInForm((f) => ({ ...f, vehicleNumbers: [...f.vehicleNumbers, ''] }));
  };

  const removeCheckInVehicle = (index) => {
    setCheckInForm((f) => ({ ...f, vehicleNumbers: f.vehicleNumbers.filter((_, i) => i !== index) }));
  };

  const updateCheckInVehicle = (index, value) => {
    setCheckInForm((f) => ({
      ...f,
      vehicleNumbers: f.vehicleNumbers.map((v, i) => (i === index ? value : v)),
    }));
  };

  const closeDetail = () => {
    if (actionSubmitting) return;
    setSelectedBookingId(null);
  };

  const [idProofError, setIdProofError] = useState('');

  const handleViewIdProof = async () => {
    setIdProofError('');
    try {
      const blob = await apiGetBlob(`/bookings/${selectedBookingId}/id-proof`, { token });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  const handleViewGuestIdProof = async (guestId) => {
    setIdProofError('');
    try {
      const blob = await apiGetBlob(`/bookings/${selectedBookingId}/guests/${guestId}/id-proof`, { token });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  useEffect(() => {
    if (!selectedBookingId) return;
    apiGet(`/bookings/${selectedBookingId}`, { token })
      .then((data) => setBookingDetail(data.booking))
      .catch((err) => setDetailError(err instanceof ApiError ? err.message : 'Could not load this booking.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookingId]);

  const handleCheckIn = async (e) => {
    e.preventDefault();
    setActionError('');

    const hasAmount = checkInForm.advanceAmount.trim() !== '';
    if (hasAmount && !checkInForm.advancePaymentMethod) {
      setActionError('Choose a payment method for the advance amount.');
      return;
    }
    if (needsIdProofAtCheckIn && !checkInForm.idProofType) {
      setActionError('Choose the ID proof type.');
      return;
    }
    if (needsIdProofAtCheckIn && !checkInForm.idProofFile) {
      setActionError('Upload the guest’s ID proof (image or PDF).');
      return;
    }
    if (checkInForm.idProofFile && checkInForm.idProofFile.size > ID_PROOF_MAX_BYTES) {
      setActionError('ID proof file must be 5MB or smaller.');
      return;
    }
    if (checkInForm.guests.some((g) => !g.name.trim())) {
      setActionError('Enter a name for each additional guest, or remove the empty row.');
      return;
    }
    if (checkInForm.guests.some((g) => g.idProofFile && g.idProofFile.size > ID_PROOF_MAX_BYTES)) {
      setActionError('Each ID proof file must be 5MB or smaller.');
      return;
    }

    setActionSubmitting(true);
    try {
      const formData = new FormData();
      if (hasAmount) {
        formData.append('advanceAmount', String(Number(checkInForm.advanceAmount)));
        formData.append('advancePaymentMethod', checkInForm.advancePaymentMethod);
      }
      if (checkInForm.idProofType) formData.append('idProofType', checkInForm.idProofType);
      if (checkInForm.idProofFile) formData.append('idProofDocument', checkInForm.idProofFile);
      formData.append(
        'vehicleNumbers',
        JSON.stringify(checkInForm.vehicleNumbers.map((v) => v.trim()).filter(Boolean))
      );
      formData.append(
        'guests',
        JSON.stringify(
          checkInForm.guests.map((g) => ({
            name: g.name.trim(),
            phone: g.phone.trim(),
            ...(g.idProofType ? { idProofType: g.idProofType } : {}),
          }))
        )
      );
      checkInForm.guests.forEach((g, i) => {
        if (g.idProofFile) formData.append(`guestIdProofDocument_${i}`, g.idProofFile);
      });

      await apiPatchForm(`/bookings/${selectedBookingId}/check-in`, formData, { token });
      setSelectedBookingId(null);
      loadTapeChart();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check in this guest.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    setActionError('');
    setActionSubmitting(true);
    try {
      await apiPatch(`/bookings/${selectedBookingId}/check-out`, {}, { token });
      setSelectedBookingId(null);
      loadTapeChart();
      onCheckedOut?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check out this guest.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setActionError('');
    setActionSubmitting(true);
    try {
      await apiPatch(`/bookings/${selectedBookingId}/cancel`, {}, { token });
      setSelectedBookingId(null);
      loadTapeChart();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not cancel this booking.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const today = todayIso();

  return (
    <div className="bookings-panel">
      <div className="bookings-panel__toolbar">
        <div className="bookings-panel__nav">
          <button type="button" className="btn-secondary" onClick={() => setRangeStart(addDays(rangeStart, -7))}>
            ← Earlier
          </button>
          <span className="bookings-panel__range">
            {formatDateLong(rangeStart)} – {formatDateLong(addDays(rangeStart, DAYS_VISIBLE - 1))}
          </span>
          <button type="button" className="btn-secondary" onClick={() => setRangeStart(addDays(rangeStart, 7))}>
            Later →
          </button>
          {rangeStart !== today && (
            <button type="button" className="btn-secondary" onClick={() => setRangeStart(today)}>
              Today
            </button>
          )}
        </div>
        <button type="button" className="btn-accent" onClick={() => openNewBooking()}>
          + New booking
        </button>
      </div>

      <div className="tape-legend">
        <span><i className="tape-legend__swatch tape-legend__swatch--vacant" />Vacant</span>
        <span><i className="tape-legend__swatch tape-legend__swatch--booked" />Booked</span>
        <span><i className="tape-legend__swatch tape-legend__swatch--checked-in" />Checked in</span>
      </div>

      {tapeError && (
        <div className="dash-card">
          <div className="dash-state">{tapeError}</div>
        </div>
      )}

      {!tapeError && !tapeData && (
        <div className="dash-card">
          <div className="dash-state">Loading the tape chart…</div>
        </div>
      )}

      {!tapeError && tapeData && tapeData.rooms.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">Add rooms on the Rooms &amp; rates tab first.</div>
        </div>
      )}

      {!tapeError && tapeData && tapeData.rooms.length > 0 && (
        <div className="tape-chart-scroll">
          <div className="tape-grid">
            <div className="tape-grid__corner">Room</div>
            {dates.map((d, i) => {
              const { weekday, day } = formatDateHead(d);
              return (
                <div
                  key={d}
                  className={`tape-grid__date-head${d === today ? ' tape-grid__date-head--today' : ''}`}
                  style={{ gridColumn: i + 2, gridRow: 1 }}
                >
                  <span>{weekday}</span>
                  <strong>{day}</strong>
                </div>
              );
            })}

            {tapeData.rooms.map((room, rIdx) => (
              <div key={room.id} style={{ display: 'contents' }}>
                <div className="tape-grid__room-label" style={{ gridColumn: 1, gridRow: rIdx + 2 }}>
                  {room.roomNumber}
                  <span>{room.categoryName}</span>
                </div>
                {dates.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    className="tape-grid__cell"
                    style={{ gridColumn: i + 2, gridRow: rIdx + 2 }}
                    onClick={() => openNewBooking(room.id, d)}
                    title={`${room.roomNumber} — ${formatDateLong(d)} — vacant`}
                  />
                ))}
                {tapeData.bookings
                  .filter((b) => String(b.roomId) === String(room.id))
                  .map((booking) => {
                    const startIdx = Math.max(0, daysBetween(rangeStart, booking.checkInDate));
                    const endIdx = Math.min(DAYS_VISIBLE, daysBetween(rangeStart, booking.checkOutDate));
                    if (endIdx <= startIdx) return null;
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        className={`tape-grid__bar tape-grid__bar--${booking.status === 'CHECKED_IN' ? 'checked-in' : 'booked'}`}
                        style={{ gridColumn: `${startIdx + 2} / ${endIdx + 2}`, gridRow: rIdx + 2 }}
                        onClick={() => openDetail(booking.id)}
                        title={`${booking.guestName} — ${STATUS_LABEL[booking.status]}`}
                      >
                        {booking.guestName}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}

      {showNewBooking && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={closeNewBooking}>
          <div
            className="glass-panel bookings-panel__modal bookings-panel__modal--form"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="booking-form" onSubmit={handleCreateBooking} noValidate>
              {/* Header stays put while the body scrolls: the booking type
                  changes what the rest of the form requires, so it shouldn't
                  scroll out of sight. */}
              <div className="booking-form__head">
                <h3>New booking</h3>
                <div className="toggle-group">
                  {!isFutureCheckIn && (
                    <button
                      type="button"
                      aria-pressed={newBooking.bookingType === 'WALK_IN'}
                      onClick={() => setNewBooking((f) => ({ ...f, bookingType: 'WALK_IN' }))}
                    >
                      Walk-in
                    </button>
                  )}
                  <button
                    type="button"
                    aria-pressed={newBooking.bookingType === 'RESERVATION'}
                    onClick={() => setNewBooking((f) => ({ ...f, bookingType: 'RESERVATION' }))}
                  >
                    Pre-reservation
                  </button>
                </div>
                <p className="bookings-panel__hint">
                  {isFutureCheckIn
                    ? 'Walk-in isn’t available for a future check-in date — this holds the room for a guest arriving later.'
                    : newBooking.bookingType === 'WALK_IN'
                    ? 'Guest is here now — creates the booking and checks them in immediately.'
                    : 'Holds the room for a guest arriving later. ID proof can be added at check-in.'}
                </p>
              </div>

              <div className="booking-form__body">
                {newBookingError && <div className="form-banner form-banner--error">{newBookingError}</div>}

                <div className="form-section">
                  <div className="form-section__title">
                    <span className="form-section__num">1</span>Stay &amp; room
                  </div>
                  <div className="field-row">
                  <div className="field">
                    <label htmlFor="checkInDate">Check-in</label>
                    <input
                      id="checkInDate"
                      type="date"
                      value={newBooking.checkInDate}
                      onChange={(e) => {
                        const checkInDate = e.target.value;
                        setNewBooking((f) => ({
                          ...f,
                          checkInDate,
                          bookingType: checkInDate > todayIso() ? 'RESERVATION' : f.bookingType,
                        }));
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="checkOutDate">Check-out</label>
                    <input
                      id="checkOutDate"
                      type="date"
                      value={newBooking.checkOutDate}
                      onChange={(e) => setNewBooking((f) => ({ ...f, checkOutDate: e.target.value }))}
                    />
                  </div>
                </div>

                {!validRange && <p className="bookings-panel__hint">Choose a valid date range first.</p>}
                {validRange && availableRoomsError && (
                  <div className="form-banner form-banner--error">{availableRoomsError}</div>
                )}
                {validRange && !availableRoomsError && (
                  <div className="field">
                    <label htmlFor="roomId">Available rooms</label>
                    <select
                      id="roomId"
                      value={newBooking.roomId}
                      onChange={(e) =>
                        setNewBooking((f) => ({ ...f, roomId: e.target.value, switchableChargeIds: [] }))
                      }
                      disabled={!availableRooms}
                    >
                      <option value="">
                        {availableRooms ? 'Choose a room' : 'Loading…'}
                      </option>
                      {availableRooms?.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.roomNumber} — {r.categoryName}
                          {r.floor ? ` · Floor ${r.floor}` : ''}
                        </option>
                      ))}
                    </select>
                    {availableRooms && availableRooms.length === 0 && (
                      <p className="bookings-panel__hint">No rooms are free for this date range.</p>
                    )}
                  </div>
                )}

                {/* Room facts as chips rather than a label/value table — this
                    is reference detail being skimmed, not data being entered,
                    and the table form cost four rows of height for it. */}
                {selectedRoom && (
                  <div className="booking-form__room-meta">
                    <div className="booking-form__chips">
                      <span className="booking-form__chip booking-form__chip--rate">
                        {formatPrice(selectedRoom.categoryBasePrice)}/night
                      </span>
                      <span className="booking-form__chip">{selectedRoom.categoryName}</span>
                      {selectedRoom.bedSize && (
                        <span className="booking-form__chip">{BED_SIZE_LABEL[selectedRoom.bedSize]} bed</span>
                      )}
                      {selectedRoom.bathroomType && (
                        <span className="booking-form__chip">
                          {BATHROOM_TYPE_LABEL[selectedRoom.bathroomType]}
                        </span>
                      )}
                      {selectedRoom.maxOccupancy && (
                        <span className="booking-form__chip">
                          Sleeps {selectedRoom.maxOccupancy}
                        </span>
                      )}
                    </div>
                    {selectedRoom.description && (
                      <p className="booking-form__room-note">{selectedRoom.description}</p>
                    )}
                  </div>
                )}

                {selectedRoom && selectedRoom.switchableCharges.length > 0 && (
                  <div className="field">
                    <label>Extras</label>
                    <div className="checkbox-grid">
                      {selectedRoom.switchableCharges.map((charge) => (
                        <label className="checkbox-chip" key={charge.id}>
                          <input
                            type="checkbox"
                            checked={newBooking.switchableChargeIds.includes(charge.id)}
                            onChange={() => toggleCharge(charge.id)}
                          />
                          {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {quote && (
                  <div className="sim-result">
                    {quote.charges.map((charge, i) => (
                      <div className="sim-result__line" key={i}>
                        <span>
                          {charge.label}
                          {quote.nights.length > 1 ? ` (${quote.nights.length} nights)` : ''}
                        </span>
                        <span>{formatPrice(charge.amount)}</span>
                      </div>
                    ))}
                    <div className="sim-result__total">
                      <span>
                        Total · {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                      </span>
                      <span>{formatPrice(quote.totalPrice)}</span>
                    </div>
                  </div>
                )}
              </div>

                <div className="form-section">
                  <div className="form-section__title">
                    <span className="form-section__num">2</span>Guest details
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="guestName">Guest name</label>
                      <input
                        id="guestName"
                        value={newBooking.guestName}
                        onChange={(e) => setNewBooking((f) => ({ ...f, guestName: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="guestPhone">Phone</label>
                      <input
                        id="guestPhone"
                        value={newBooking.guestPhone}
                        onChange={(e) => setNewBooking((f) => ({ ...f, guestPhone: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="numGuests">Number of guests</label>
                      <input
                        id="numGuests"
                        type="number"
                        min="1"
                        value={newBooking.numGuests}
                        onChange={(e) => handleNumGuestsChange(e.target.value)}
                      />
                      {/* Caught here rather than at submit — the room's limit
                          is right above, so the conflict is obvious in place. */}
                      {overOccupancy && (
                        <p className="booking-form__warn">
                          Room {selectedRoom.roomNumber} sleeps {selectedRoom.maxOccupancy}.
                        </p>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="idProofType">
                        ID proof type{idProofOptional ? ' (optional)' : ''}
                      </label>
                      <select
                        id="idProofType"
                        value={newBooking.idProofType}
                        onChange={(e) => setNewBooking((f) => ({ ...f, idProofType: e.target.value }))}
                      >
                        <option value="">Choose one</option>
                        {ID_PROOF_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* File inputs render their own filename text, so this needs
                      the full width — sharing a triple row truncated it. */}
                  <div className="field">
                    <label htmlFor="idProofFile">
                      ID proof document{idProofOptional ? ' (optional)' : ''}
                    </label>
                    <input
                      id="idProofFile"
                      type="file"
                      accept={ID_PROOF_ACCEPT}
                      onChange={(e) => setNewBooking((f) => ({ ...f, idProofFile: e.target.files[0] || null }))}
                    />
                    <p className="bookings-panel__hint">Image (JPG/PNG/WEBP) or PDF, up to 5MB.</p>
                  </div>

                  {/* Only offered once the party is bigger than one — with a
                      single guest the button could only ever be disabled. */}
                  {maxAdditionalGuests > 0 && (
                    <div className="booking-form__subhead">
                      Other guests
                      <span className="booking-form__subhead-count">
                        {newBooking.guests.length} of {maxAdditionalGuests} added
                      </span>
                    </div>
                  )}
                {newBooking.guests.length > 0 && (
                  <div className="bookings-panel__repeat-list">
                    {newBooking.guests.map((guest, index) => (
                      <div className="bookings-panel__guest-row" key={index}>
                        <div className="field">
                          <label htmlFor={`guestGuestName-${index}`}>Name</label>
                          <input
                            id={`guestGuestName-${index}`}
                            value={guest.name}
                            onChange={(e) => updateGuest(index, { name: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`guestPhone-${index}`}>Phone (optional)</label>
                          <input
                            id={`guestPhone-${index}`}
                            value={guest.phone}
                            onChange={(e) => updateGuest(index, { phone: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`guestIdProofType-${index}`}>ID proof type (optional)</label>
                          <select
                            id={`guestIdProofType-${index}`}
                            value={guest.idProofType}
                            onChange={(e) => updateGuest(index, { idProofType: e.target.value })}
                          >
                            <option value="">None</option>
                            {ID_PROOF_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`guestIdProofFile-${index}`}>ID proof document (optional)</label>
                          <input
                            id={`guestIdProofFile-${index}`}
                            type="file"
                            accept={ID_PROOF_ACCEPT}
                            onChange={(e) => updateGuest(index, { idProofFile: e.target.files[0] || null })}
                          />
                        </div>
                        <button
                          type="button"
                          className="bookings-panel__remove-btn"
                          onClick={() => removeGuest(index)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {maxAdditionalGuests > 0 && (
                  <button
                    type="button"
                    className="bookings-panel__add-btn"
                    onClick={addGuest}
                    disabled={newBooking.guests.length >= maxAdditionalGuests}
                  >
                    + Add guest
                  </button>
                )}
                </div>

              <details className="form-section form-section--collapsible">
                <summary>
                  <span className="form-section__num">3</span>
                  Advance payment
                  {newBooking.advanceAmount.trim() !== '' && (
                    <span className="form-section__badge">{formatPrice(Number(newBooking.advanceAmount))}</span>
                  )}
                </summary>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="newBookingAdvanceAmount">Amount</label>
                    <input
                      id="newBookingAdvanceAmount"
                      type="number"
                      min="0"
                      value={newBooking.advanceAmount}
                      onChange={(e) => setNewBooking((f) => ({ ...f, advanceAmount: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="newBookingAdvancePaymentMethod">Method</label>
                    <select
                      id="newBookingAdvancePaymentMethod"
                      value={newBooking.advancePaymentMethod}
                      onChange={(e) => setNewBooking((f) => ({ ...f, advancePaymentMethod: e.target.value }))}
                    >
                      <option value="">Choose one</option>
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                    </select>
                  </div>
                </div>
              </details>

              <details className="form-section form-section--collapsible">
                <summary>
                  <span className="form-section__num">4</span>
                  Vehicles
                  {newBooking.vehicleNumbers.length > 0 && (
                    <span className="form-section__badge">{newBooking.vehicleNumbers.length}</span>
                  )}
                </summary>
                {newBooking.vehicleNumbers.length > 0 && (
                  <div className="bookings-panel__repeat-list">
                    {newBooking.vehicleNumbers.map((vehicleNumber, index) => (
                      <div className="bookings-panel__vehicle-row" key={index}>
                        <input
                          value={vehicleNumber}
                          onChange={(e) => updateVehicle(index, e.target.value)}
                          placeholder="MH07AB1234"
                        />
                        <button
                          type="button"
                          className="bookings-panel__remove-btn"
                          onClick={() => removeVehicle(index)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" className="bookings-panel__add-btn" onClick={addVehicle}>
                  + Add vehicle
                </button>
              </details>

              </div>

              {/* Total and actions pinned below the scroll area. The itemised
                  breakdown still lives up in the form, but the figure being
                  charged has to stay visible while filling in guest details —
                  otherwise you commit to a price you can no longer see. */}
              <div className="booking-form__foot">
                <div className="booking-form__total">
                  {quote ? (
                    <>
                      <span className="booking-form__total-label">
                        {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                      </span>
                      <span className="booking-form__total-value">{formatPrice(quote.totalPrice)}</span>
                    </>
                  ) : (
                    <span className="booking-form__total-label">Pick dates and a room</span>
                  )}
                </div>
                <div className="booking-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={closeNewBooking} disabled={submitting}>
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={submitting}>
                    {submitting
                      ? 'Booking…'
                      : newBooking.bookingType === 'WALK_IN'
                      ? 'Add and check in'
                      : 'Create reservation'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedBookingId && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={closeDetail}>
          <div className="glass-panel bookings-panel__modal" onClick={(e) => e.stopPropagation()}>
            {detailError && <div className="form-banner form-banner--error">{detailError}</div>}

            {!detailError && !bookingDetail && <div className="dash-state">Loading…</div>}

            {!detailError && bookingDetail && (
              <>
                <div className="bookings-panel__detail-header">
                  <h3>{bookingDetail.guestName}</h3>
                  <span
                    className={`badge ${bookingDetail.status === 'CHECKED_IN' ? 'badge--on' : 'badge--off'}`}
                  >
                    {STATUS_LABEL[bookingDetail.status]}
                  </span>
                </div>

                <div className="chart-list">
                  <div className="chart-row">
                    <span className="chart-row__name">Room</span>
                    <span className="chart-row__value">
                      {bookingDetail.roomNumber} · {bookingDetail.categoryName}
                    </span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Dates</span>
                    <span className="chart-row__value">
                      {formatDateLong(bookingDetail.checkInDate)} – {formatDateLong(bookingDetail.checkOutDate)}
                    </span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Phone</span>
                    <span className="chart-row__value">{bookingDetail.guestPhone}</span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Guests</span>
                    <span className="chart-row__value">{bookingDetail.numGuests}</span>
                  </div>
                  {bookingDetail.idProofType && (
                    <div className="chart-row">
                      <span className="chart-row__name">ID proof</span>
                      <span className="chart-row__value">
                        {bookingDetail.idProofType}
                        {bookingDetail.hasIdProofDocument && (
                          <button type="button" className="bookings-panel__link-btn" onClick={handleViewIdProof}>
                            View
                          </button>
                        )}
                      </span>
                    </div>
                  )}
                  {bookingDetail.guests.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Other guests</span>
                      <span className="chart-row__value">
                        <div className="bookings-panel__guest-detail-list">
                          {bookingDetail.guests.map((g) => (
                            <div key={g.id} className="bookings-panel__guest-detail">
                              {g.name}
                              {g.phone ? ` · ${g.phone}` : ''}
                              {g.idProofType ? ` · ${g.idProofType}` : ''}
                              {g.hasIdProofDocument && (
                                <button
                                  type="button"
                                  className="bookings-panel__link-btn"
                                  onClick={() => handleViewGuestIdProof(g.id)}
                                >
                                  View
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </span>
                    </div>
                  )}
                  {idProofError && (
                    <div className="chart-row">
                      <span className="chart-row__value form-banner form-banner--error">{idProofError}</span>
                    </div>
                  )}
                  {bookingDetail.vehicleNumbers.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Vehicles</span>
                      <span className="chart-row__value">{bookingDetail.vehicleNumbers.join(' · ')}</span>
                    </div>
                  )}
                  {bookingDetail.switchableCharges.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Extras</span>
                      <span className="chart-row__value">
                        {bookingDetail.switchableCharges.map((c) => c.name).join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className="chart-row">
                    <span className="chart-row__name">Total price</span>
                    <span className="chart-row__value">{formatPrice(bookingDetail.totalPrice)}</span>
                  </div>
                  {bookingDetail.advanceAmount != null && (
                    <div className="chart-row">
                      <span className="chart-row__name">Advance paid</span>
                      <span className="chart-row__value">
                        {formatPrice(bookingDetail.advanceAmount)} ({bookingDetail.advancePaymentMethod})
                      </span>
                    </div>
                  )}
                </div>

                {actionError && <div className="form-banner form-banner--error">{actionError}</div>}

                {showEditBooking && editForm && (
                  <form onSubmit={handleSaveEditBooking} className="form-section">
                    <div className="form-section__title">
                      {canEditStayDetails ? 'Edit booking' : 'Edit extras'}
                    </div>
                    <p className="bookings-panel__hint">
                      {canEditStayDetails
                        ? 'Editable until this stay is billed — extend the stay, move rooms or fix a detail.'
                        : 'This stay is already checked out — only extras can still be corrected before billing.'}
                    </p>

                    {canEditStayDetails && (
                      <>
                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="editGuestName">Guest name</label>
                            <input
                              id="editGuestName"
                              value={editForm.guestName}
                              onChange={(e) => setEditForm((f) => ({ ...f, guestName: e.target.value }))}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="editGuestPhone">Phone</label>
                            <input
                              id="editGuestPhone"
                              value={editForm.guestPhone}
                              onChange={(e) => setEditForm((f) => ({ ...f, guestPhone: e.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="editCheckOutDate">Check-out</label>
                            <input
                              id="editCheckOutDate"
                              type="date"
                              min={addDays(bookingDetail.checkInDate, 1)}
                              value={editForm.checkOutDate}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, checkOutDate: e.target.value, roomId: '' }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="editNumGuests">Number of guests</label>
                            <input
                              id="editNumGuests"
                              type="number"
                              min="1"
                              value={editForm.numGuests}
                              onChange={(e) => setEditForm((f) => ({ ...f, numGuests: e.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="field">
                          <label htmlFor="editRoomId">Room</label>
                          {editAvailableRoomsError && (
                            <div className="form-banner form-banner--error">{editAvailableRoomsError}</div>
                          )}
                          {!editAvailableRoomsError && (
                            <select
                              id="editRoomId"
                              value={editForm.roomId}
                              onChange={(e) => setEditForm((f) => ({ ...f, roomId: e.target.value }))}
                              disabled={!editAvailableRooms}
                            >
                              <option value="">{editAvailableRooms ? 'Choose a room' : 'Loading…'}</option>
                              {editAvailableRooms?.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.roomNumber} — {r.categoryName} · {formatPrice(r.categoryBasePrice)}/night
                                  {r.floor ? ` · Floor ${r.floor}` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </>
                    )}

                    <div className="field">
                      <label>Extras</label>
                      {bookingDetail.availableSwitchableCharges.length === 0 && (
                        <p className="bookings-panel__hint">No extras configured for this lodge.</p>
                      )}
                      {bookingDetail.availableSwitchableCharges.length > 0 && (
                        <div className="checkbox-grid">
                          {bookingDetail.availableSwitchableCharges.map((charge) => (
                            <label className="checkbox-chip" key={charge.id}>
                              <input
                                type="checkbox"
                                checked={editForm.switchableChargeIds.includes(charge.id)}
                                onChange={() => toggleEditFormCharge(charge.id)}
                              />
                              {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {editQuote && (
                      <div className="sim-result">
                        {editQuote.charges.map((charge, i) => (
                          <div className="sim-result__line" key={i}>
                            <span>
                              {charge.label}
                              {editQuote.nights.length > 1 ? ` (${editQuote.nights.length} nights)` : ''}
                            </span>
                            <span>{formatPrice(charge.amount)}</span>
                          </div>
                        ))}
                        <div className="sim-result__total">
                          <span>
                            Total · {editQuote.nights.length} night{editQuote.nights.length === 1 ? '' : 's'}
                          </span>
                          <span>{formatPrice(editQuote.totalPrice)}</span>
                        </div>
                      </div>
                    )}

                    {editError && <div className="form-banner form-banner--error">{editError}</div>}
                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowEditBooking(false)}
                        disabled={editSubmitting}
                      >
                        Back
                      </button>
                      <button className="btn-accent" type="submit" disabled={editSubmitting}>
                        {editSubmitting ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </form>
                )}

                {bookingDetail.status === 'BOOKED' && !showCheckInForm && !showEditBooking && (
                  <>
                    {!canCheckInNow && (
                      <p className="bookings-panel__hint">
                        Reserved for {formatDateLong(bookingDetail.checkInDate)} — check-in opens on that date.
                      </p>
                    )}
                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="bookings-panel__danger-link"
                        onClick={handleCancel}
                        disabled={actionSubmitting}
                      >
                        Cancel booking
                      </button>
                      <button type="button" className="btn-secondary" onClick={openEditBooking} disabled={actionSubmitting}>
                        Edit booking
                      </button>
                      <button
                        type="button"
                        className="btn-accent"
                        onClick={() => setShowCheckInForm(true)}
                        disabled={actionSubmitting || !canCheckInNow}
                        title={canCheckInNow ? undefined : 'Check-in opens on the reserved date.'}
                      >
                        Check in
                      </button>
                    </div>
                  </>
                )}

                {bookingDetail.status === 'BOOKED' && showCheckInForm && (
                  <form onSubmit={handleCheckIn} className="form-section">
                    {needsIdProofAtCheckIn && (
                      <>
                        <div className="form-section__title">Guest ID proof</div>
                        <p className="bookings-panel__hint">
                          Wasn&apos;t collected when this room was reserved — required before check-in.
                        </p>
                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="checkInIdProofType">ID proof type</label>
                            <select
                              id="checkInIdProofType"
                              value={checkInForm.idProofType}
                              onChange={(e) => setCheckInForm((f) => ({ ...f, idProofType: e.target.value }))}
                            >
                              <option value="">Choose one</option>
                              {ID_PROOF_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor="checkInIdProofFile">ID proof document</label>
                            <input
                              id="checkInIdProofFile"
                              type="file"
                              accept={ID_PROOF_ACCEPT}
                              onChange={(e) =>
                                setCheckInForm((f) => ({ ...f, idProofFile: e.target.files[0] || null }))
                              }
                            />
                            <p className="bookings-panel__hint">Image (JPG/PNG/WEBP) or PDF, up to 5MB.</p>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="form-section__title">Advance payment (optional)</div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="advanceAmount">Amount</label>
                        <input
                          id="advanceAmount"
                          type="number"
                          min="0"
                          value={checkInForm.advanceAmount}
                          onChange={(e) => setCheckInForm((f) => ({ ...f, advanceAmount: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="advancePaymentMethod">Method</label>
                        <select
                          id="advancePaymentMethod"
                          value={checkInForm.advancePaymentMethod}
                          onChange={(e) =>
                            setCheckInForm((f) => ({ ...f, advancePaymentMethod: e.target.value }))
                          }
                        >
                          <option value="">Choose one</option>
                          <option value="CASH">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="CARD">Card</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-section__title">Add guest details (optional)</div>
                    <p className="bookings-panel__hint">
                      For guests whose details weren&apos;t taken at booking time.
                    </p>
                    {checkInForm.guests.length > 0 && (
                      <div className="bookings-panel__repeat-list">
                        {checkInForm.guests.map((guest, index) => (
                          <div className="bookings-panel__guest-row" key={index}>
                            <div className="field">
                              <label htmlFor={`checkInGuestName-${index}`}>Name</label>
                              <input
                                id={`checkInGuestName-${index}`}
                                value={guest.name}
                                onChange={(e) => updateCheckInGuest(index, { name: e.target.value })}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`checkInGuestPhone-${index}`}>Phone (optional)</label>
                              <input
                                id={`checkInGuestPhone-${index}`}
                                value={guest.phone}
                                onChange={(e) => updateCheckInGuest(index, { phone: e.target.value })}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`checkInGuestIdProofType-${index}`}>ID proof type (optional)</label>
                              <select
                                id={`checkInGuestIdProofType-${index}`}
                                value={guest.idProofType}
                                onChange={(e) => updateCheckInGuest(index, { idProofType: e.target.value })}
                              >
                                <option value="">None</option>
                                {ID_PROOF_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field">
                              <label htmlFor={`checkInGuestIdProofFile-${index}`}>
                                ID proof document (optional)
                              </label>
                              <input
                                id={`checkInGuestIdProofFile-${index}`}
                                type="file"
                                accept={ID_PROOF_ACCEPT}
                                onChange={(e) =>
                                  updateCheckInGuest(index, { idProofFile: e.target.files[0] || null })
                                }
                              />
                            </div>
                            <button
                              type="button"
                              className="bookings-panel__remove-btn"
                              onClick={() => removeCheckInGuest(index)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="bookings-panel__add-btn"
                      onClick={addCheckInGuest}
                      disabled={maxAdditionalGuestsAtCheckIn <= 0}
                    >
                      + Add guest
                    </button>

                    <div className="form-section__title">Add vehicles (optional)</div>
                    {checkInForm.vehicleNumbers.length > 0 && (
                      <div className="bookings-panel__repeat-list">
                        {checkInForm.vehicleNumbers.map((vehicleNumber, index) => (
                          <div className="bookings-panel__vehicle-row" key={index}>
                            <input
                              value={vehicleNumber}
                              onChange={(e) => updateCheckInVehicle(index, e.target.value)}
                              placeholder="MH07AB1234"
                            />
                            <button
                              type="button"
                              className="bookings-panel__remove-btn"
                              onClick={() => removeCheckInVehicle(index)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="button" className="bookings-panel__add-btn" onClick={addCheckInVehicle}>
                      + Add vehicle
                    </button>

                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowCheckInForm(false)}
                        disabled={actionSubmitting}
                      >
                        Back
                      </button>
                      <button className="btn-accent" type="submit" disabled={actionSubmitting}>
                        {actionSubmitting ? 'Checking in…' : 'Confirm check-in'}
                      </button>
                    </div>
                  </form>
                )}

                {bookingDetail.status === 'CHECKED_IN' && !showEditBooking && (
                  <div className="bookings-panel__actions">
                    <button type="button" className="btn-secondary" onClick={openEditBooking} disabled={actionSubmitting}>
                      Edit booking
                    </button>
                    <button
                      type="button"
                      className="btn-accent"
                      onClick={handleCheckOut}
                      disabled={actionSubmitting}
                    >
                      {actionSubmitting ? 'Checking out…' : 'Check out'}
                    </button>
                  </div>
                )}

                {bookingDetail.status === 'CHECKED_OUT' && !showEditBooking && (
                  <div className="bookings-panel__actions">
                    {canEditBooking ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={openEditBooking}
                        disabled={actionSubmitting}
                      >
                        Edit extras
                      </button>
                    ) : (
                      <span className="bookings-panel__hint">This stay has been billed — extras are locked.</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
