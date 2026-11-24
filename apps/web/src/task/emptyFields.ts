/** A task field value counts as empty for the form's cut (PLNRAPP-830): nothing, '', an unchecked box, []. */
export const isEmptyValue = (v: unknown): boolean =>
  v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
