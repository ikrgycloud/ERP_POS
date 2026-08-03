export const cleanDigits = (value = "") => String(value || "").replace(/\D/g, "");

export function isBlank(value) {
  return String(value ?? "").trim().length === 0;
}

export function isValidEmail(value) {
  if (isBlank(value)) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value).trim());
}

export function isValidPhone(value) {
  const digits = cleanDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

export function isValidIndianMobile(value) {
  return /^[6-9]\d{9}$/.test(cleanDigits(value));
}

export function isValidPincode(value) {
  if (isBlank(value)) {
    return true;
  }
  return /^\d{6}$/.test(cleanDigits(value));
}

export function isValidPan(value) {
  if (isBlank(value)) {
    return true;
  }
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(String(value).trim());
}

export function isValidGstin(value) {
  if (isBlank(value)) {
    return true;
  }
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(String(value).trim());
}

export function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function isNonNegativeNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function isValidDate(value) {
  if (isBlank(value)) {
    return true;
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const [yearText, monthText, dayText] = text.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function requiredErrors(form, fields) {
  return fields.reduce((errors, [key, label]) => {
    if (isBlank(form[key])) {
      errors[key] = `${label} is required`;
    }
    return errors;
  }, {});
}

export function firstError(errors) {
  return Object.values(errors).find(Boolean) || "";
}
