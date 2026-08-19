const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ''}`;
}

function threeDigits(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return twoDigits(rest);
  return `${ONES[hundreds]} Hundred${rest ? ` ${twoDigits(rest)}` : ''}`;
}

// Indian numbering (Lakh/Crore), not Western thousands/millions.
function integerToWords(n) {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(' ');
}

export function amountInWords(amount) {
  const n = Math.round(Math.abs(Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let words = `Rupees ${integerToWords(rupees)}`;
  if (paise > 0) words += ` and ${integerToWords(paise)} Paise`;
  return `${words} Only`;
}

// The same amount in Marathi. Its own tables rather than a translation pass:
// Marathi number words are irregular through 99 (बावन्न, त्र्याण्णव…), so the
// only correct implementation is the full list, exactly as it is taught.
const ONES_MR = [
  '', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ', 'दहा',
  'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस', 'वीस',
  'एकवीस', 'बावीस', 'तेवीस', 'चोवीस', 'पंचवीस', 'सव्वीस', 'सत्तावीस', 'अठ्ठावीस', 'एकोणतीस', 'तीस',
  'एकतीस', 'बत्तीस', 'तेहतीस', 'चौतीस', 'पस्तीस', 'छत्तीस', 'सदतीस', 'अडतीस', 'एकोणचाळीस', 'चाळीस',
  'एक्केचाळीस', 'बेचाळीस', 'त्रेचाळीस', 'चव्वेचाळीस', 'पंचेचाळीस', 'सेहेचाळीस', 'सत्तेचाळीस', 'अठ्ठेचाळीस', 'एकोणपन्नास', 'पन्नास',
  'एक्कावन्न', 'बावन्न', 'त्रेपन्न', 'चोपन्न', 'पंचावन्न', 'छप्पन्न', 'सत्तावन्न', 'अठ्ठावन्न', 'एकोणसाठ', 'साठ',
  'एकसष्ट', 'बासष्ट', 'त्रेसष्ट', 'चौसष्ट', 'पासष्ट', 'सहासष्ट', 'सदुसष्ट', 'अडुसष्ट', 'एकोणसत्तर', 'सत्तर',
  'एक्काहत्तर', 'बाहत्तर', 'त्र्याहत्तर', 'चौऱ्याहत्तर', 'पंच्याहत्तर', 'शहात्तर', 'सत्याहत्तर', 'अठ्ठ्याहत्तर', 'एकोणऐंशी', 'ऐंशी',
  'एक्क्याऐंशी', 'ब्याऐंशी', 'त्र्याऐंशी', 'चौऱ्याऐंशी', 'पंच्याऐंशी', 'शहाऐंशी', 'सत्त्याऐंशी', 'अठ्ठ्याऐंशी', 'एकोणनव्वद', 'नव्वद',
  'एक्क्याण्णव', 'ब्याण्णव', 'त्र्याण्णव', 'चौऱ्याण्णव', 'पंचाण्णव', 'शहाण्णव', 'सत्त्याण्णव', 'अठ्ठ्याण्णव', 'नव्व्याण्णव',
];

function threeDigitsMr(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return ONES_MR[rest];
  // "शंभर" stands alone; composed it becomes "एकशे वीस", "दोनशे पाच".
  const head = hundreds === 1 ? (rest ? 'एकशे' : 'शंभर') : `${ONES_MR[hundreds]}शे`;
  return rest ? `${head} ${ONES_MR[rest]}` : head;
}

function integerToWordsMr(n) {
  if (n === 0) return 'शून्य';
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  const parts = [];
  if (crore) parts.push(`${threeDigitsMr(crore)} कोटी`);
  if (lakh) parts.push(`${threeDigitsMr(lakh)} लाख`);
  if (thousand) parts.push(`${threeDigitsMr(thousand)} हजार`);
  if (n) parts.push(threeDigitsMr(n));
  return parts.join(' ');
}

export function amountInWordsMr(amount) {
  const n = Math.round(Math.abs(Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let words = `रुपये ${integerToWordsMr(rupees)}`;
  if (paise > 0) words += ` व ${integerToWordsMr(paise)} पैसे`;
  return `${words} फक्त`;
}
