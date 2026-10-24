import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

/**
 * Guard the actual DOM hit target, rather than just testing PDF.js annotation
 * extraction. This catches the regression where links were present but had
 * pointer-events:none while a separate pointer capture handler was expected
 * to activate them.
 *
 * This verifies the component's JSX contract. A real WebView tap still needs
 * manual/device testing.
 */
test('PDF link annotations are rendered as directly clickable anchors, as in main', () => {
  const path = new URL('../src/components/PdfPageView.tsx', import.meta.url);
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile('PdfPageView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let anchors = 0;
  let pointerEnabled = false;
  let clickHandler = false;
  let internalJump = false;
  let externalOpening = false;

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'a') {
      anchors++;
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const classAttr = attrs.find(attr => attr.name.getText(ast) === 'className');
      const clickAttr = attrs.find(attr => attr.name.getText(ast) === 'onClick');
      pointerEnabled ||= Boolean(classAttr?.getText(ast).includes('pointer-events-auto'));
      clickHandler ||= Boolean(clickAttr);
      internalJump ||= Boolean(clickAttr?.getText(ast).includes('onNavigateToPage'));
      externalOpening ||= Boolean(clickAttr?.getText(ast).includes('openPdfExternalLink'));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);

  assert.ok(anchors > 0, 'the PDF page must render real anchor elements');
  assert.equal(pointerEnabled, true, 'link anchors must be pointer-interactive');
  assert.equal(clickHandler, true, 'link anchors need a direct click handler');
  assert.equal(internalJump, true, 'internal PDF destinations must be navigable');
  assert.equal(externalOpening, true, 'external HTTPS links must open via the native-safe bridge');
  assert.equal(source.includes('onPagePointerUpCapture'), false,
    'do not replace working link clicks with independent pointer interception');
  assert.equal(source.includes('pointerEvents: \'none\''), false,
    'do not disable interaction on the clickable link itself');
});
