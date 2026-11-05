export function isValidE164Phone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length < 6 ? "••••" : `+${digits.slice(0, 2)}••••••${digits.slice(-3)}`;
}
