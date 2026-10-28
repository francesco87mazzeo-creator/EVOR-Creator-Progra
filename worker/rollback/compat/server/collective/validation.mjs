// Pure Web-platform module: no Node APIs, network, storage or credentials.
export class ValidationError extends Error {
  constructor(code, path) {
    super(`${code} at ${path}`);
    this.name = 'ValidationError';
    this.code = code;
    this.path = path;
  }
}
export function fail(code, path) { throw new ValidationError(code, path); }
export function record(value, allowed, required, path = '$') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('TYPE', path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', path);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('TYPE', path);
  }
  for (const key of required) if (!Object.hasOwn(descriptors, key)) fail('MISSING_FIELD', `${path}.${key}`);
  return value;
}
export function exact(value, keys, path) { return record(value, keys, keys, path); }
export function text(value, maximum, path, required = false) {
  if (typeof value !== 'string') fail('TYPE', path);
  if (value.length > maximum) fail('LENGTH', path);
  if (required && !value.trim()) fail('REQUIRED', path);
  return value;
}
export function number(value, minimum, maximum, path, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) fail('TYPE', path);
  if (value < minimum || value > maximum) fail('RANGE', path);
  return value;
}
export function enumeration(value, values, path) {
  if (typeof value !== typeof values[0]) fail('TYPE', path);
  if (!values.includes(value)) fail('ENUM', path);
  return value;
}
export function iso(value, path) {
  text(value, 24, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('FORMAT', path);
  return value;
}
export function url(value, path) {
  text(value, 2048, path);
  if (!value) return value;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || /\s/.test(value)) fail('FORMAT', path);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    fail('FORMAT', path);
  }
  return value;
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function array(value, minimum, maximum, path) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('TYPE', path);
  if (value.length < minimum || value.length > maximum) fail('LENGTH', path);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('TYPE', path);
  for (let i=0;i<value.length;i++) {
    const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
    if (!descriptor || !Object.hasOwn(descriptor,'value') || !descriptor.enumerable) fail('TYPE', path);
  }
  return value;
}
