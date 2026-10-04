export const validUsername = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{2,29}$/.test(value);
