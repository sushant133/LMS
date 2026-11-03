/**
 * Keep only the fields the request actually sent.
 *
 * `schema.partial().parse(body)` still fills in each field's `.default(...)`, so an
 * update that omits a field (e.g. paymentMethod → "CASH", openingBalanceNpr → 0)
 * would silently overwrite the saved value. Updates must change only what was sent.
 */
export const keepProvidedFields = <T extends Record<string, unknown>>(payload: T, body: unknown): Partial<T> => {
  const sent = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const result: Partial<T> = {};
  for (const key of Object.keys(payload) as Array<keyof T>) {
    if (Object.prototype.hasOwnProperty.call(sent, key) && sent[key as string] !== undefined) {
      result[key] = payload[key];
    }
  }
  return result;
};
