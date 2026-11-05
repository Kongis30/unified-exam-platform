import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialDisplayLines } from '../src/examTypes/shsat/utils/textMaterial.js';

const options = { category: 'Reading Passage' };
const longLine = '1 Along with the wagon had come the fresh horses, one of them being Peroxide Jim, a supple,';

test('reflows long prose lines while retaining paragraphs and source text', () => {
  const body = `${longLine}\npowerful horse.\n\n2 The next paragraph begins here.`;
  const introduction = 'In this excerpt, the author describes a long journey across the open countryside,\nwhere the story begins.';
  const display = buildMaterialDisplayLines({ introduction, body }, options);
  assert.equal(display.introduction, 'In this excerpt, the author describes a long journey across the open countryside, where the story begins.');
  assert.deepEqual(display.bodyItems.map((item) => item.text), [
    `${longLine} powerful horse.`, '', '2 The next paragraph begins here.',
  ]);
  assert.equal(display.body, body);
});

test('preserves poetry, lists, formula blocks and image offsets', () => {
  const poem = `${longLine}\na deliberately separate verse`;
  assert.equal(buildMaterialDisplayLines({ body: poem, passageTitle: 'A Poem' }, options).bodyItems.length, 2);
  assert.equal(buildMaterialDisplayLines({ body: poem }, { category: 'Poetry' }).bodyItems.length, 2);
  const body = `- ${'A'.repeat(75)}\nnext list line\n$$\nx + y\n$$\n[[MATERIAL_IMAGE:/image.png]]`;
  const items = buildMaterialDisplayLines({ body }, options).bodyItems;
  assert.equal(items[1].text, 'next list line');
  assert.equal(items[2].text, '$$\nx + y\n$$');
  const image = items.find((item) => item.type === 'image');
  assert.equal(body.slice(image.sourceStart, image.sourceEnd), '[[MATERIAL_IMAGE:/image.png]]');
});
