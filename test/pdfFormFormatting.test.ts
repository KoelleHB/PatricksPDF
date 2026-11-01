import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSupportedForms, formatSupportedNumber, parseSupportedFormFormatting } from '../src/utils/pdfFormFormatting';
import type { FormFieldItem } from '../src/types';

const field = (name: string, sumFields?: string[]): FormFieldItem => ({ id: name, name, type: 'text', pageNumber: 1, xPercent: 0, yPercent: 0, widthPercent: 10, heightPercent: 10, sumFields });

test('recognizes only the supported complete Acrobat formatting expressions', () => {
  assert.deepEqual(parseSupportedFormFormatting('AFNumber_Format(2, 0, 0, 0, "", true);', 'AFSimple_Calculate("SUM", new Array ("calc1", "calc2"));'), { numberDecimals: 2, sumFields: ['calc1', 'calc2'] });
  assert.deepEqual(parseSupportedFormFormatting('AFNumber_Format(2, 0, 0, 0, "", true); evil()', 'AFSimple_Calculate("SUM", new Array("x")); evil()'), {});
  assert.deepEqual(parseSupportedFormFormatting('AFNumber_Format(2, 1, 0, 0, "", true)', 'AFSimple_Calculate("PRD", new Array("x"))'), {});
});

test('formats valid numbers and calculates dependent sums without running scripts', () => {
  assert.equal(formatSupportedNumber('1234.5', 2), '1,234.50');
  assert.equal(formatSupportedNumber('abc', 2), 'abc');
  const result = calculateSupportedForms({ a: '1,234.50', b: '6.25', sum: '0' }, [field('sum', ['a', 'b'])]);
  assert.equal(result.sum, '1240.75');
  assert.equal(calculateSupportedForms({ a: 'broken', b: '6', sum: 'old' }, [field('sum', ['a', 'b'])]).sum, 'old');
  assert.deepEqual(calculateSupportedForms({ a: '1', b: '2' }, [field('a', ['b']), field('b', ['a'])]), { a: '1', b: '2' });
});
