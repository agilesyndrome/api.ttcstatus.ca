/** Small JSON Schema helpers; response objects permit additive fields, inputs do not. */
export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const array = (items: unknown) => ({ type: 'array', items });
export const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
  additionalProperties = true,
) => ({
  type: 'object',
  properties,
  required,
  additionalProperties,
});
export const string = { type: 'string' };
export const number = { type: 'number' };
export const boolean = { type: 'boolean' };
export const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const timestamp = {
  type: 'string',
  format: 'date-time',
  description: 'UTC ISO 8601 timestamp.',
};
export const epoch = { type: 'integer', description: 'UTC epoch milliseconds.' };
export const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
export const version = { type: 'integer', const: 1 };
