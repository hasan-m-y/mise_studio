// Derived shopping data only. Persisted edits always use original normalized keys.
export function ingredientIdentity(name) {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  // Deliberately closed vocabulary: product forms, varieties and alternatives stay intact.
  const match = /^(?:(minced|chopped|crushed) garlic|garlic(?:, (minced|chopped|crushed)| \((minced|chopped|crushed)\)))$/.exec(key);
  const onion = /^(?:(diced|chopped|sliced) onion|onion(?:, (diced|chopped|sliced)| \((diced|chopped|sliced)\)))$/.exec(key);
  const preparation = (match || onion)?.slice(1).find(Boolean) || "";
  return { key, canonical: match ? "garlic" : onion ? "onion" : key, preparation };
}
function rational(n, d = 1n) {
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  const g = gcd(n, d);
  return [n / g, d / g];
}
function add(a, b) { return rational(a[0] * b[1] + b[0] * a[1], a[1] * b[1]); }
function multiply(a, b) { return rational(a[0] * b[0], a[1] * b[1]); }
function number(text) {
  if (/^\d+\/\d+$/.test(text)) {
    const [n, d] = text.split('/').map(BigInt);
    return d ? rational(n, d) : null;
  }
  if (/^\d+ \d+\/\d+$/.test(text)) {
    const [whole, fraction] = text.split(' '), part = number(fraction);
    return part && add([BigInt(whole), 1n], part);
  }
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const [whole, decimal = ''] = text.split('.');
  return rational(BigInt(whole + decimal), 10n ** BigInt(decimal.length));
}
const units = new Map();
function unit(names, family, factor, singular, plural = singular) {
  const definition = { family, factor: number(factor), singular, plural };
  for (const name of names.split('|')) units.set(name, definition);
}
unit('clove|cloves', 'clove', '1', 'clove', 'cloves');
unit('|whole|item|items|count', 'item', '1', 'item', 'items');
// Culinary volume abbreviations use US customary measures (not Imperial cups).
unit('tsp|tsp.|teaspoon|teaspoons', 'volume', '4.92892159375', 'tsp');
unit('tbsp|tbsp.|tablespoon|tablespoons', 'volume', '14.78676478125', 'tbsp');
unit('cup|cups', 'volume', '236.5882365', 'cup', 'cups');
unit('ml|milliliter|milliliters|millilitre|millilitres', 'volume', '1', 'mL');
unit('l|liter|liters|litre|litres', 'volume', '1000', 'L');
unit('g|gram|grams', 'weight', '1', 'g');
unit('kg|kilogram|kilograms', 'weight', '1000', 'kg');
unit('oz|ounce|ounces', 'weight', '28.349523125', 'oz');
unit('lb|lbs|pound|pounds', 'weight', '453.59237', 'lb');
export function parseIngredientQuantity(raw) {
  const text = raw.trim().replace(/(\d)?([½¼¾⅓⅔⅛⅜⅝⅞])/g, (_, whole, f) =>
    (whole ? whole + ' ' : '') + ({'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8'}[f]));
  const match = /^(\d+ \d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*([a-z.]*)$/i.exec(text);
  if (!match) return null;
  const amount = number(match[1]), definition = units.get(match[2].toLowerCase());
  return amount && definition ? { amount, unit: definition } : null;
}
function format([n, d]) {
  if (d === 1n) return String(n);
  const whole = n / d, remainder = n % d;
  if (d <= 100n)
    return (whole ? whole + ' ' : '') + remainder + '/' + d;
  // Presentation only: keep all aggregation arithmetic exact. Round long fractions
  // to two decimal places, retaining three significant digits for small amounts.
  let scale = 100n, places = 2;
  while (n * scale < 100n * d) { scale *= 10n; places++; }
  const rounded = (n * scale * 2n + d) / (2n * d);
  const digits = String(rounded % scale).padStart(places, '0').replace(/0+$/, '');
  const decimal = String(rounded / scale) + (digits ? '.' + digits : '');
  return (rounded * d === n * scale ? '' : '≈ ') + decimal;
}
export function summarizeQuantities(occurrences) {
  const buckets = new Map(), unknown = [];
  for (const occurrence of occurrences) {
    const parsed = parseIngredientQuantity(occurrence.quantity);
    if (!parsed) { unknown.push(occurrence.quantity.trim() ? occurrence.quantity : 'Quantity unspecified'); continue; }
    const { amount, unit } = parsed;
    const bucket = buckets.get(unit.family) || { unit, total: [0n, 1n] };
    bucket.total = add(bucket.total, multiply(amount, unit.factor));
    buckets.set(unit.family, bucket);
  }
  return [...buckets.values()].map(({unit, total}) => {
    const amount = multiply(total, [unit.factor[1], unit.factor[0]]);
    return format(amount) + ' ' + (amount[0] === amount[1] ? unit.singular : unit.plural);
  }).concat(unknown).join(' + ');
}
export function aggregateIngredients(sources, edits = { omitted: [], groups: [] }) {
  const originals = new Map(), omitted = new Set(edits.omitted), grouped = new Set();
  for (const { recipe, dishId, label } of sources) {
    recipe.ingredients.forEach((name, index) => {
      const identity = ingredientIdentity(name);
      if (!identity.key) return;
      const occurrence = { ...identity, name, quantity: recipe.ingredientQuantities?.[index] || '', recipeId: recipe.id, recipeTitle: recipe.title, dishId, label };
      if (!originals.has(identity.key)) originals.set(identity.key, []);
      originals.get(identity.key).push(occurrence);
    });
  }
  function row(id, keys, groupId = null) {
    const occurrences = keys.flatMap(key => originals.get(key));
    const canonical = new Set(occurrences.map(o => o.canonical));
    const names = keys.map(key => originals.get(key)[0].name.trim());
    return { id, keys, groupId, occurrences,
      name: !groupId && keys.length > 1 ? occurrences[0].canonical : names.join(', '),
      // Manual combinations of different groceries must never sum their quantities.
      quantity: canonical.size === 1 ? summarizeQuantities(occurrences) : occurrences.map(o => `${o.quantity.trim() ? o.quantity : 'Quantity unspecified'} ${o.name}`).join(' + '),
      uses: new Map(occurrences.map(o => [o.dishId, o])), omitted: keys.every(key => omitted.has(key)) };
  }
  const rows = [];
  for (const group of edits.groups) {
    const keys = group.keys.filter(key => originals.has(key) && !grouped.has(key));
    keys.forEach(key => grouped.add(key));
    if (keys.length) rows.push(row(group.id, keys, group.id));
  }
  const automatic = new Map();
  for (const [key, occurrences] of originals) {
    if (grouped.has(key)) continue;
    // Conflicting saved omission decisions remain separate and independently editable.
    const identity = JSON.stringify([occurrences[0].canonical, omitted.has(key)]);
    if (!automatic.has(identity)) automatic.set(identity, []);
    automatic.get(identity).push(key);
  }
  for (const keys of automatic.values()) rows.push(row(keys[0], keys));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
