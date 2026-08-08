export function formatPrice(amount) {
  const n = Number(amount);
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
}
