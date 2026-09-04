// The asterisk on a label the form won't submit without. Sighted readers get
// the mark, screen readers get the word — an asterisk read aloud in the middle
// of a label is noise, and a title attribute alone is never announced.
//
// Only ever put this on a field the form's own submit-time checks actually stop
// on, so the mark stays worth believing. Where two fields satisfy one
// requirement between them (an ID number *or* a scanned document), mark
// neither: the check stops on neither field, only on both being empty at once,
// and two marks side by side are read as two cards being wanted. `label` is
// only ever read aloud, so it cannot do that arithmetic for a sighted reader.
// Name the requirement in prose near the fields instead, where there is room
// for the word "or".
//
// Styles live in pages/lodge/forms.css alongside the fields it sits in.
export default function RequiredMark({ label = 'required' }) {
  return (
    <span className="field__req" title={label}>
      <span aria-hidden="true">*</span>
      <span className="field__req-text">{` (${label})`}</span>
    </span>
  );
}
