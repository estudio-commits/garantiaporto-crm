// National mobile numbers default to Uruguay. Foreign numbers require an explicit country prefix.
export function whatsappNumber(value: string): string | null {
  const input = value.trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return null;
  let number = input.replace(/\D/g, "");
  const international = input.startsWith("+") || number.startsWith("00");
  if (number.startsWith("00")) number = number.slice(2);
  if (/^59809\d{7}$/.test(number)) number = "598" + number.slice(4);
  if (/^5989\d{7}$/.test(number)) return number;
  if (number.startsWith("598")) return null;
  if (international) return /^[1-9]\d{7,14}$/.test(number) ? number : null;
  if (/^09\d{7}$/.test(number)) return "598" + number.slice(1);
  if (/^9\d{7}$/.test(number)) return "598" + number;
  return null;
}
export const whatsappUrl = (value: string) => {
  const phone = whatsappNumber(value);
  return phone ? `https://api.whatsapp.com/send?phone=${phone}` : null;
};
