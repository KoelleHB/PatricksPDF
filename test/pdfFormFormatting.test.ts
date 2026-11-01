import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  calculateSupportedForms,
  formatSupportedNumber,
  parseNumber,
  parseSupportedFormFormatting,
  readFormFormatting,
} from '../src/utils/pdfFormFormatting';
import type { FormFieldItem } from '../src/types';

const field = (name: string, sumFields?: string[]): FormFieldItem => ({
  id: name,
  name,
  type: 'text',
  pageNumber: 1,
  xPercent: 0,
  yPercent: 0,
  widthPercent: 10,
  heightPercent: 10,
  sumFields,
});

test('recognizes only the supported complete Acrobat formatting expressions (sepStyle 0..3)', () => {
  assert.deepEqual(
    parseSupportedFormFormatting(
      'AFNumber_Format(2, 0, 0, 0, "", true);',
      'AFSimple_Calculate("SUM", new Array ("calc1", "calc2"));'
    ),
    { numberDecimals: 2, sepStyle: 0, sumFields: ['calc1', 'calc2'] }
  );
  assert.deepEqual(
    parseSupportedFormFormatting(
      'AFNumber_Format(2, 1, 0, 0, "", false);',
      'AFSimple_Calculate("SUM", new Array ("calc1", "calc2"));'
    ),
    { numberDecimals: 2, sepStyle: 1, sumFields: ['calc1', 'calc2'] }
  );
  assert.deepEqual(
    parseSupportedFormFormatting('AFNumber_Format(3, 2, 0, 0, \'\', true)', ''),
    { numberDecimals: 3, sepStyle: 2 }
  );
  assert.deepEqual(
    parseSupportedFormFormatting('AFNumber_Format(0, 3, 0, 0, "", true)', ''),
    { numberDecimals: 0, sepStyle: 3 }
  );
  // Reject sepStyle outside 0..3 or chained/unsupported scripts
  assert.deepEqual(parseSupportedFormFormatting('AFNumber_Format(2, 4, 0, 0, "", true);', ''), {});
  assert.deepEqual(
    parseSupportedFormFormatting(
      'AFNumber_Format(2, 0, 0, 0, "", true); evil()',
      'AFSimple_Calculate("SUM", new Array("x")); evil()'
    ),
    {}
  );
  assert.deepEqual(
    parseSupportedFormFormatting(
      'AFNumber_Format(2, 1, 0, 0, "", true)',
      'AFSimple_Calculate("PRD", new Array("x"))'
    ),
    { numberDecimals: 2, sepStyle: 1 }
  );
});

test('formats all four Acrobat sepStyle codes (0..3) according to specification', () => {
  // Specification table for 1234,56 and 1234.56:
  // sepStyle 0 -> 1,234.56
  // sepStyle 1 -> 1234.56
  // sepStyle 2 -> 1.234,56
  // sepStyle 3 -> 1234,56
  for (const input of ['1234,56', '1234.56']) {
    assert.equal(formatSupportedNumber(input, 2, 0), '1,234.56');
    assert.equal(formatSupportedNumber(input, 2, 1), '1234.56');
    assert.equal(formatSupportedNumber(input, 2, 2), '1.234,56');
    assert.equal(formatSupportedNumber(input, 2, 3), '1234,56');
  }

  // Negative numbers, zero, and varying decimal places (0, 2, 3)
  assert.equal(formatSupportedNumber('-9876543.21', 2, 0), '-9,876,543.21');
  assert.equal(formatSupportedNumber('-9876543.21', 2, 1), '-9876543.21');
  assert.equal(formatSupportedNumber('-9876543,21', 2, 2), '-9.876.543,21');
  assert.equal(formatSupportedNumber('-9876543,21', 2, 3), '-9876543,21');

  assert.equal(formatSupportedNumber('1234.56', 0, 0), '1,235');
  assert.equal(formatSupportedNumber('1234.56', 0, 2), '1.235');
  assert.equal(formatSupportedNumber('1234.5', 3, 2), '1.234,500');
  assert.equal(formatSupportedNumber('-0.0001', 2, 2), '0,00');

  // Empty and invalid values remain untouched
  assert.equal(formatSupportedNumber('', 2, 0), '');
  assert.equal(formatSupportedNumber('   ', 2, 2), '   ');
  assert.equal(formatSupportedNumber('abc', 2, 0), 'abc');
  // Unsupported sepStyle leaves value untouched
  assert.equal(formatSupportedNumber('1234.56', 2, 99), '1234.56');

  // Idempotency: re-formatting an already formatted value must not drift or fail
  for (const sepStyle of [0, 1, 2, 3]) {
    const once = formatSupportedNumber('1234567.89', 2, sepStyle);
    const twice = formatSupportedNumber(once, 2, sepStyle);
    assert.equal(twice, once, `Idempotent formatting failed for sepStyle=${sepStyle}`);
  }
});

test('prevents silent misinterpretation of ambiguous or malformed numbers in parseNumber', () => {
  // Without sepStyle, "1.234" and "1,234" are ambiguous (1234 vs 1.234)
  assert.equal(parseNumber('1.234'), null);
  assert.equal(parseNumber('1,234'), null);

  // With sepStyle, 3-digit group vs 3-decimal-place number is deterministically resolved
  assert.equal(parseNumber('1,234', 0), 1234);
  assert.equal(parseNumber('1.234', 0), 1.234);
  assert.equal(parseNumber('1.234', 1), 1.234);
  assert.equal(parseNumber('1,234', 1), null); // sepStyle 1 forbids comma thousands and uses dot decimal
  assert.equal(parseNumber('1.234', 2), 1234);
  assert.equal(parseNumber('1,234', 2), 1.234);
  assert.equal(parseNumber('1,234', 3), 1.234);
  assert.equal(parseNumber('1.234', 3), null); // sepStyle 3 forbids dot thousands and uses comma decimal

  // Malformed grouping or contradictory separators are rejected
  assert.equal(parseNumber('1,23.45', 0), null);
  assert.equal(parseNumber('1.23,45', 2), null);
  assert.equal(parseNumber('1.234.56', 2), null);
  assert.equal(parseNumber('1,234,56', 0), null);
  assert.equal(parseNumber('1,234.56', 2), null);
  assert.equal(parseNumber('1.234,56', 0), null);
  assert.equal(parseNumber('1,234.56', 1), null);
  assert.equal(parseNumber('1.234,56', 3), null);
  assert.equal(parseNumber('12 345,67', 2), null);
});

test('calculates dependent sums across mixed sepStyle formats and avoids chained rounding errors', () => {
  const mixedFields: FormFieldItem[] = [
    { ...field('usGrouped'), sepStyle: 0, numberDecimals: 2 },
    { ...field('usPlain'), sepStyle: 1, numberDecimals: 2 },
    { ...field('euGrouped'), sepStyle: 2, numberDecimals: 2 },
    { ...field('euPlain'), sepStyle: 3, numberDecimals: 2 },
    {
      ...field('totalEu', ['usGrouped', 'usPlain', 'euGrouped', 'euPlain']),
      sepStyle: 2,
      numberDecimals: 2,
    },
    {
      ...field('totalUs', ['usGrouped', 'usPlain', 'euGrouped', 'euPlain']),
      sepStyle: 0,
      numberDecimals: 2,
    },
  ];

  const mixedResult = calculateSupportedForms(
    {
      usGrouped: '1,234.50',
      usPlain: '100.25',
      euGrouped: '2.000,75',
      euPlain: '50,50',
      totalEu: '0',
      totalUs: '0',
    },
    mixedFields
  );
  assert.equal(mixedResult.totalEu, '3.386,00');
  assert.equal(mixedResult.totalUs, '3,386.00');

  // Chained sums: subtotal = a + b (0.334 + 0.334 = 0.668 -> formatted 0.67),
  // total = subtotal + c (0.668 + 0.334 = 1.002 -> formatted 1.00, NOT 0.67 + 0.334 = 1.004)
  const chainedFields: FormFieldItem[] = [
    { ...field('a'), sepStyle: 0, numberDecimals: 3 },
    { ...field('b'), sepStyle: 0, numberDecimals: 3 },
    { ...field('c'), sepStyle: 0, numberDecimals: 3 },
    { ...field('subtotal', ['a', 'b']), sepStyle: 0, numberDecimals: 2 },
    { ...field('total', ['subtotal', 'c']), sepStyle: 0, numberDecimals: 2 },
  ];
  const chainedResult = calculateSupportedForms(
    { a: '0.334', b: '0.334', c: '0.334', subtotal: '0', total: '0' },
    chainedFields
  );
  assert.equal(chainedResult.subtotal, '0.67');
  assert.equal(chainedResult.total, '1.00');

  // Broken or cyclic dependencies leave existing sum untouched
  assert.equal(
    calculateSupportedForms({ a: 'broken', b: '6', sum: 'old' }, [field('sum', ['a', 'b'])]).sum,
    'old'
  );
  assert.deepEqual(
    calculateSupportedForms({ a: '1', b: '2' }, [field('a', ['b']), field('b', ['a'])]),
    { a: '1', b: '2' }
  );
});

test('readFormFormatting extracts formatting and calculation scripts from parent field hierarchies', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const tf = form.createTextField('invoice.items.net');
  tf.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });

  // Attach /AA /F and /C on the parent field dictionary rather than directly on the widget
  const widget = tf.acroField.getWidgets()[0];
  const parentDict = doc.context.obj({
    T: PDFString.of('invoice.items.net'),
    AA: doc.context.obj({
      F: doc.context.obj({
        S: 'JavaScript',
        JS: PDFString.of('AFNumber_Format(2, 2, 0, 0, "", true);'),
      }),
      C: doc.context.obj({
        S: 'JavaScript',
        JS: PDFString.of('AFSimple_Calculate("SUM", new Array("pos.a", "pos.b"));'),
      }),
    }),
  });
  const parentRef = doc.context.register(parentDict);
  widget.dict.delete(PDFName.of('T'));
  widget.dict.set(PDFName.of('Parent'), parentRef);

  const bytes = await doc.save();
  const formatting = await readFormFormatting(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );

  assert.deepEqual(formatting.get('name:invoice.items.net'), {
    numberDecimals: 2,
    sepStyle: 2,
    sumFields: ['pos.a', 'pos.b'],
  });
});

