import { z } from 'zod';

export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'user', 'url', 'money'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const choices = z
  .array(
    z.object({
      id: z.string().min(1).max(36),
      label: z.string().min(1).max(100),
      color: z.string().optional(),
    }),
  )
  .refine((c) => new Set(c.map((x) => x.id)).size === c.length, 'id вариантов уникальны');

export const fieldOptionsSchema = (type: FieldType): z.ZodType =>
  type === 'select'
    ? z.strictObject({ choices })
    : type === 'money'
      ? z.strictObject({ currency: z.string().regex(/^[A-Z]{3}$/) })
      : z.strictObject({});

export const defaultFieldOptions = (type: FieldType): Record<string, unknown> =>
  type === 'select' ? { choices: [] } : type === 'money' ? { currency: 'RUB' } : {};

const url = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'http(s) URL');

export const fieldValueSchema = (def: {
  type: FieldType;
  options: Record<string, unknown>;
}): z.ZodType => {
  switch (def.type) {
    case 'text':
      return z.string().min(1).max(5000);
    case 'number':
      return z.number().finite();
    case 'date':
      return z.iso.date();
    case 'select': {
      const ids = ((def.options.choices ?? []) as { id: string }[]).map((c) => c.id);
      return z.string().refine((v) => ids.includes(v), 'нет такого варианта');
    }
    case 'user':
      return z.uuid();
    case 'url':
      return url;
    case 'money':
      return z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
  }
};
