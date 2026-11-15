import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ingredientIdentity, parseIngredientQuantity, aggregateIngredients } from './public/ingredient-aggregation.js';
import { encodeBackup, decodeBackup } from './public/storage.js';
const recipe = (ingredients, ingredientQuantities) => ({id:'r',title:'Recipe',servings:4,tags:[],ingredients, ...(ingredientQuantities ? {ingredientQuantities} : {}),steps:[]});
const source = (r, dishId = 'd') => ({recipe:r,dishId,label:dishId});
const aggregate = (names, quantities) => aggregateIngredients([source(recipe(names, quantities))]);
const total = (quantities) => aggregate(quantities.map(() => 'Butter'), quantities)[0].quantity;
for (const name of ['garlic', 'Minced garlic', 'garlic, minced', 'garlic (minced)', '  GARLIC  '])
  assert.equal(ingredientIdentity(name).canonical, 'garlic');
for (const name of ['garlic powder','jarred minced garlic','fresh garlic','red onion','white onion','fresh basil','dried basil','milk','condensed milk','Maple or honey','Salt, to taste','Fresh basil leaves','2 tomatoes'])
  assert.equal(ingredientIdentity(name).canonical, name.toLowerCase());
assert.equal(ingredientIdentity('onion, diced').canonical,'onion');
assert.equal(ingredientIdentity('diced red onion').canonical,'diced red onion');
assert.equal(ingredientIdentity('garlic (minced)').preparation,'minced');
assert.equal(aggregate(['Salt, to taste','salt,  to taste'],[]).length,1);
assert.equal(aggregate(['Garlic','Garlic powder','Jarred minced garlic'],['3 cloves','1 tsp','2 tsp']).length,3);
assert.equal(aggregate(['Milk','condensed milk','fresh basil','dried basil','red onion','white onion'],[]).length,6);
for (const [input, expected] of [
  [['2 tbsp','3 tbsp'],'5 tbsp'], [['1 cup','1 cup'],'2 cups'],
  [['½ cup','1/2 cup'],'1 cup'], [['1 1/2 cups','½ cup'],'2 cups'],
  [['1½ cups','¼ cup','¾ cup'],'2 1/2 cups'], [['0.1 g','0.2 g'],'3/10 g'], [['.5 cups','.5 cups'],'1 cup'],
  [['1 tbsp','3 tsp'],'2 tbsp'], [['1 cup','16 tbsp'],'2 cups'],
  [['500 mL','0.5 L'],'1000 mL'], [['1 kg','500 grams'],'1 1/2 kg'],
  [['1 lb','16 oz'],'2 lb'], [['1','2 items'],'3 items'],
  [['3 cloves','2 teaspoons'],'3 cloves + 2 tsp'],
  [['2 tbsp','1 stick'],'2 tbsp + 1 stick'], [['1 g','1 mL'],'1 g + 1 mL'],
  [['','2 cups'],'2 cups + Quantity unspecified'], [['  ','2 cups'],'2 cups + Quantity unspecified'], [['to taste','a pinch'],'to taste + a pinch'],
  [['0 g','0 grams'],'0 g'], [['1 clove','1 item'],'1 clove + 1 item'],
]) assert.equal(total(input),expected,JSON.stringify(input));
for (const raw of ['', 'a pinch', '1/0 cup', '1-2 cups', 'about 2 g', '-1 g', '2 sticks', '2 cups extra', 'Infinity g'])
  assert.equal(parseIngredientQuantity(raw),null,raw);
const r = recipe(['Garlic','Minced garlic','Garlic'],['3 cloves','2 cloves','1 clove']);
const sources = [source(r,'dish-a'),source(r,'dish-b')];
const before = JSON.stringify(sources);
const rows = aggregateIngredients(sources);
assert.equal(rows.length,1);
assert.equal(rows[0].quantity,'12 cloves');
assert.equal(rows[0].occurrences.length,6);
assert.equal(rows[0].uses.size,2);
assert.deepEqual(rows[0].keys,['garlic','minced garlic']);
assert.equal(rows[0].occurrences.find(o=>o.preparation === 'minced').quantity,'2 cloves');
assert.equal(rows[0].occurrences.find(o=>o.preparation === 'minced').preparation,'minced');
assert.equal(JSON.stringify(sources),before);
assert.deepEqual(rows,aggregateIngredients(sources));
const edits = {omitted:['minced garlic'],groups:[]};
assert.equal(aggregateIngredients(sources,edits).length,2);
assert.equal(aggregateIngredients(sources,edits).filter(r=>r.omitted).length,1);
const manual = {omitted:[],groups:[{id:'group',keys:['garlic','pepper']}]};
const originalEdits = JSON.stringify(manual);
const manualSources = [source(recipe(['Garlic','Pepper','Minced garlic'],['3 cloves','2 cloves','2 cloves']))];
const manualRows = aggregateIngredients(manualSources,manual);
assert.equal(manualRows.length,2);
assert.match(manualRows.find(r=>r.groupId).quantity,/3 cloves Garlic \+ 2 cloves Pepper/);
assert.equal(aggregateIngredients([source(recipe(['Garlic'],['3 cloves']))],manual)[0].groupId,'group');
assert.equal(JSON.stringify(manual),originalEdits);
assert.equal(aggregate(['2 tomatoes'],[])[0].name,'2 tomatoes');
const workspace = {projects:{p:{id:'p',name:'Dinner',guests:4,date:'2026-09-07',courses:[],ingredientEdits:manual}},recipes:{r},drafts:{legacy: {...recipe(['2 tomatoes']),id:'legacy'}}};
const restored = decodeBackup(encodeBackup(workspace));
assert.deepEqual(JSON.parse(JSON.stringify(restored)),workspace);
assert.deepEqual(aggregateIngredients([source(restored.recipes.r)]),aggregateIngredients([source(r)]));
const appJS = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');
assert.match(appJS, /from "\.\/ingredient-aggregation\.js"/);
assert.equal(new URL('./ingredient-aggregation.js', 'https://example.com/mise_studio/app.js').pathname, '/mise_studio/ingredient-aggregation.js');
console.log('PASS: conservative ingredient identity, exact quantities and conversions, incompatible/unknown amounts, repeated contributions, saved edit conflicts, deterministic non-mutating aggregation, legacy names, and version-1 backups.');

// Long conversion fractions are rounded only for display; original amounts survive.
for (const [input, expected] of [
  [['1 cup','100 mL'], '≈ 1.42 cups'],
  [['100 mL','1 cup'], '≈ 336.59 mL'],
  [['1 lb','100 g'], '≈ 1.22 lb'],
  [['100 g','1 lb'], '≈ 553.59 g'],
  [['1/3 cup','1/6 cup'], '1/2 cups'],
  [['1 cup','1 tbsp'], '1 1/16 cups'],
  [['1 lb','8 oz'], '1 1/2 lb'],
  [['1/125 cup'], '0.008 cups'],
  [['1/1000000 cup','1/3000000 cup'], '≈ 0.00000133 cups'],
  // Rounding each contribution first would incorrectly yield 1.84 cups.
  [['1 cup','100 mL','100 mL'], '≈ 1.85 cups'],
]) assert.equal(total(input),expected,JSON.stringify(input));
const mixed = aggregate(['Milk','Milk'],['1 cup','100 mL'])[0];
assert.equal(mixed.quantity,'≈ 1.42 cups');
assert.deepEqual(mixed.occurrences.map(o=>o.quantity),['1 cup','100 mL']);
console.log('PASS: readable mixed-system quantities, approximation markers, exact culinary fractions, tiny amounts, and original measurements.');
