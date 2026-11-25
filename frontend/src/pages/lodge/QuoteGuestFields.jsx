import { isIndianMobile } from './quotationKinds';

// "Guest name" + "Mobile", both optional — shared by the three non-room panels.
export default function GuestFields({ name, setName, phone, setPhone }) {
  const bad = phone !== '' && !isIndianMobile(phone);
  return (
    <div className="sim-fields">
      <div className="field">
        <label htmlFor="quote-guest-name">Guest name (optional)</label>
        <input id="quote-guest-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="quote-guest-phone">Mobile (optional)</label>
        <input
          id="quote-guest-phone"
          inputMode="numeric"
          value={phone}
          maxLength={10}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        />
        {bad && <small className="field__error">Enter a valid 10-digit mobile number.</small>}
      </div>
    </div>
  );
}

