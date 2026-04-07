import { describe, expect, it } from 'vitest';

import {
  validateId,
  validateIdList,
  validateOptionalId,
  validatePositiveInt,
  ValidationError,
} from '../validation';

describe('ValidationError', () => {
  it('is an instance of Error', () => {
    const err = new ValidationError('bad input');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('bad input');
  });
});

describe('validateId', () => {
  it('accepts a valid positive integer', () => {
    expect(validateId(123, 'chat_id')).toBe(123);
  });

  it('accepts a valid negative integer', () => {
    expect(validateId(-100, 'chat_id')).toBe(-100);
  });

  it('accepts zero', () => {
    expect(validateId(0, 'user_id')).toBe(0);
  });

  it('throws for non-integer numbers', () => {
    expect(() => validateId(1.5, 'id')).toThrow(ValidationError);
  });

  it('parses a numeric string to integer', () => {
    expect(validateId('456', 'id')).toBe(456);
  });

  it('parses a negative numeric string', () => {
    expect(validateId('-789', 'id')).toBe(-789);
  });

  it('accepts a valid username string (5+ chars)', () => {
    expect(validateId('alice', 'user')).toBe('@alice');
  });

  it('keeps the @ prefix if already present', () => {
    expect(validateId('@alice', 'user')).toBe('@alice');
  });

  it('throws for a string that is too short to be a username', () => {
    expect(() => validateId('ab', 'id')).toThrow(ValidationError);
  });

  it('throws for invalid string (non-numeric, non-username)', () => {
    expect(() => validateId('not valid!', 'id')).toThrow(ValidationError);
  });

  it('throws for null', () => {
    expect(() => validateId(null, 'id')).toThrow(ValidationError);
  });

  it('throws for undefined', () => {
    expect(() => validateId(undefined, 'id')).toThrow(ValidationError);
  });

  it('throws for boolean', () => {
    expect(() => validateId(true, 'id')).toThrow(ValidationError);
  });

  it('throws for object', () => {
    expect(() => validateId({}, 'id')).toThrow(ValidationError);
  });
});

describe('validateIdList', () => {
  it('validates an array of mixed valid ids', () => {
    const result = validateIdList([123, 'alice', '456'], 'ids');
    expect(result).toEqual([123, '@alice', 456]);
  });

  it('throws when input is not an array', () => {
    expect(() => validateIdList('not-array', 'ids')).toThrow(/must be an array/);
  });

  it('throws when an element is invalid', () => {
    expect(() => validateIdList([123, 'xy'], 'ids')).toThrow(ValidationError);
  });

  it('returns empty array for empty input', () => {
    expect(validateIdList([], 'ids')).toEqual([]);
  });
});

describe('validatePositiveInt', () => {
  it('accepts a positive integer', () => {
    expect(validatePositiveInt(5, 'count')).toBe(5);
  });

  it('parses a valid positive string', () => {
    expect(validatePositiveInt('10', 'count')).toBe(10);
  });

  it('throws for zero', () => {
    expect(() => validatePositiveInt(0, 'count')).toThrow(ValidationError);
  });

  it('throws for a negative number', () => {
    expect(() => validatePositiveInt(-1, 'count')).toThrow(ValidationError);
  });

  it('throws for a float', () => {
    expect(() => validatePositiveInt(1.5, 'count')).toThrow(ValidationError);
  });

  it('throws for a non-numeric string', () => {
    expect(() => validatePositiveInt('abc', 'count')).toThrow(ValidationError);
  });

  it('throws for null', () => {
    expect(() => validatePositiveInt(null, 'count')).toThrow(ValidationError);
  });

  it('throws for an object', () => {
    expect(() => validatePositiveInt({}, 'count')).toThrow(ValidationError);
  });

  it('throws for string "0"', () => {
    expect(() => validatePositiveInt('0', 'count')).toThrow(ValidationError);
  });
});

describe('validateOptionalId', () => {
  it('returns undefined when value is undefined', () => {
    expect(validateOptionalId(undefined, 'id')).toBeUndefined();
  });

  it('returns undefined when value is null', () => {
    expect(validateOptionalId(null, 'id')).toBeUndefined();
  });

  it('delegates to validateId for non-null values', () => {
    expect(validateOptionalId(123, 'id')).toBe(123);
    expect(validateOptionalId('alice', 'id')).toBe('@alice');
  });

  it('throws for invalid non-null values', () => {
    expect(() => validateOptionalId('xy', 'id')).toThrow(ValidationError);
  });
});
