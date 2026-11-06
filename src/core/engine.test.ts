import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_RULE_CONFIG, RULES, evaluateShipments, type ExceptionCase, type Shipment } from './index';
import { NOW, doc, event, iso, shipment, shuffled, windowEnding } from './testkit';

/** A small portfolio that triggers several rules at once. */
function portfolio(): Shipment[] {
  return [
    shipment({ id: 'a', reference: 'A-1', pickupWindow: windowEnding(300) }), // LATE-PU high
    shipment({
      id: 'b',
      reference: 'B-1',
      deliveryWindow: windowEnding(60),
      agreedRate: { amount: 1000, currency: 'USD' },
      events: [event('picked_up', 3000), event('in_transit', 800), event('arrived', 400, { stop: 'pickup' }), event('departed', 100, { stop: 'pickup' })],
      documents: [doc('invoice', 50, { amount: { amount: 1030, currency: 'USD' } })],
    }), // LATE-DEL med, NO-UPDATE (bumped), DETENTION pickup, RATE low
    shipment({ id: 'c', reference: 'C-1', events: [event('picked_up', 4000), event('delivered', 3000)] }), // NO-POD med
    shipment({ id: 'd', reference: 'D-1' }), // nothing
  ];
}

test('RULES lists the six rules with descriptions and severity logic', () => {
  assert.deepEqual(
    RULES.map((r) => r.id),
    ['LATE-PU', 'LATE-DEL', 'NO-POD', 'NO-UPDATE', 'DETENTION', 'RATE-MISMATCH'],
  );
  for (const r of RULES) {
    assert.ok(r.description.length > 10, r.id);
    assert.ok(r.severityLogic.length > 10, r.id);
    assert.equal(typeof r.evaluate, 'function');
  }
});

test('re-exports DEFAULT_RULE_CONFIG unchanged', () => {
  assert.equal(DEFAULT_RULE_CONFIG.noPodHours, 24);
});

test('evaluateShipments: ids, status, detectedAt and sort order (severity, then id)', () => {
  const cases = evaluateShipments(portfolio(), NOW);
  assert.ok(cases.length >= 5);
  const rank = { high: 0, med: 1, low: 2 } as const;
  for (let i = 1; i < cases.length; i++) {
    const p = cases[i - 1] as ExceptionCase;
    const c = cases[i] as ExceptionCase;
    assert.ok(
      rank[p.severity] < rank[c.severity] || (rank[p.severity] === rank[c.severity] && p.id < c.id),
      `${p.id} before ${c.id}`,
    );
  }
  for (const c of cases) {
    assert.equal(c.status, 'open');
    assert.equal(c.detectedAt, NOW.toISOString());
    assert.ok(c.id.startsWith(`${c.shipmentId}:${c.ruleId}`));
  }
  assert.ok(cases.some((c) => c.id === 'b:DETENTION:pickup'));
  assert.deepEqual(
    cases.map((c) => c.id),
    [...cases].map((c) => c.id).filter((id, i, a) => a.indexOf(id) === i),
    'ids are unique',
  );
});

test('evaluateShipments is deterministic and independent of input order', () => {
  const base = portfolio();
  const first = evaluateShipments(base, NOW);
  assert.deepEqual(evaluateShipments(base, NOW), first);
  for (let seed = 1; seed <= 6; seed++) {
    const scrambled = shuffled(base, seed).map((s) => ({
      ...s,
      events: shuffled(s.events, seed + 10),
      documents: shuffled(s.documents, seed + 20),
    }));
    assert.deepEqual(evaluateShipments(scrambled, NOW), first, `seed ${seed}`);
  }
});

test('evaluateShipments does not mutate its input', () => {
  const base = portfolio();
  const before = JSON.stringify(base);
  evaluateShipments(base, NOW);
  assert.equal(JSON.stringify(base), before);
});

test('duplicate and unsorted events produce the same cases as a clean list', () => {
  const clean = shipment({ id: 'x', events: [event('picked_up', 900), event('arrived', 800, { stop: 'delivery' })], deliveryWindow: windowEnding(100) });
  const messy = {
    ...clean,
    events: [...clean.events].reverse().concat(clean.events.map((e) => ({ ...e }))),
  };
  assert.deepEqual(evaluateShipments([messy], NOW), evaluateShipments([clean], NOW));
});

test('config is merged over the defaults; partial and invalid values are handled', () => {
  const s = [shipment({ pickupWindow: windowEnding(300) })];
  assert.equal(evaluateShipments(s, NOW).length, 1);
  assert.equal(evaluateShipments(s, NOW, { latePickupGraceHours: 6 }).length, 0);
  assert.equal(evaluateShipments(s, NOW, { noPodHours: 1 }).length, 1, 'unrelated override keeps other defaults');
  assert.equal(evaluateShipments(s, NOW, { latePickupGraceHours: undefined }).length, 1, 'undefined keeps the default');
  assert.equal(evaluateShipments(s, NOW, { latePickupGraceHours: Number.NaN }).length, 1);
  assert.equal(evaluateShipments(s, NOW, null as never).length, 1);
});

test('hostile / malformed input never throws', () => {
  const nasty = [
    null,
    undefined,
    42,
    'string',
    {},
    { id: 5 },
    { id: 'n1', reference: 'N-1', events: null, documents: 'nope' },
    { id: 'n2', reference: 'N-2', events: [null, 7, {}, { type: 5 }, { id: 'e', type: 'delivered', at: {} }], documents: [null, {}, { kind: 'pod' }, { kind: 'invoice', amount: 'x' }] },
    { id: 'n3', reference: 'N-3', pickupWindow: 'soon', deliveryWindow: [], agreedRate: 'cheap', freeTimeMinutes: 'a lot' },
  ] as unknown as Shipment[];
  assert.doesNotThrow(() => evaluateShipments(nasty, NOW));
  assert.doesNotThrow(() => evaluateShipments(null as never, NOW));
  assert.deepEqual(evaluateShipments(portfolio(), new Date('invalid')), []);
  assert.deepEqual(evaluateShipments(portfolio(), 'now' as never), []);
});

test('a shipment with the same id twice yields one case per case id', () => {
  const a = shipment({ id: 'dup', pickupWindow: windowEnding(300) });
  const b = shipment({ id: 'dup', pickupWindow: windowEnding(400) });
  const out = evaluateShipments([a, b], NOW);
  assert.equal(out.length, 1);
  assert.deepEqual(evaluateShipments([b, a], NOW), out, 'order independent even for duplicates');
});

test('every case is complete, JSON-serialisable and only uses facts of the allowed shapes', () => {
  for (const c of evaluateShipments(portfolio(), NOW)) {
    assert.ok(c.title.length > 0 && c.summary.length > 0 && c.suggestedNextStep.length > 0, c.id);
    assert.ok(c.evidence.length >= 1, c.id);
    for (const e of c.evidence) {
      assert.ok(['email', 'csv', 'event', 'document'].includes(e.source));
      assert.ok(e.ref.length > 0 && e.excerpt.length > 0 && e.excerpt.length <= 240);
    }
    assert.equal(typeof c.facts.reference, 'string');
    assert.equal(typeof c.facts.asOf, 'string');
    for (const [k, v] of Object.entries(c.facts)) {
      assert.ok(typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)), `${c.id}.${k}`);
      if (typeof v === 'string') assert.ok(v.length > 0, `${c.id}.${k} empty`);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
  }
});

test('facts omit unknown names instead of inventing them', () => {
  const [c] = evaluateShipments([{ id: 'z', reference: 'Z-1', events: [], documents: [], pickupWindow: windowEnding(300) }], NOW);
  assert.ok(c);
  assert.equal('carrier' in c.facts, false);
  assert.equal('customer' in c.facts, false);
  assert.ok(!c.summary.includes('undefined'));
  assert.ok(c.summary.startsWith('Load Z-1 '));
});

test('timezone: the same instants written in different offsets give completely identical cases (display is always UTC)', () => {
  const build = (off: number): Shipment[] => [
    shipment({
      id: 'tz',
      pickupWindow: windowEnding(300, 120, off),
      deliveryWindow: windowEnding(-240, 120, off),
      events: [event('eta_update', 20, { eta: iso(-300, off), offset: off }), event('delivered', 1500, { offset: off })],
    }),
  ];
  const strip = (cs: ExceptionCase[]) => cs; // facts, evidence and summaries are UTC, so everything is identical
  const base = strip(evaluateShipments(build(0), NOW));
  assert.ok(base.length > 0);
  for (const off of [330, -480, 60, -300]) assert.deepEqual(strip(evaluateShipments(build(off), NOW)), base, `offset ${off}`);
});

test('core and fixtures source has no wall clock or randomness', () => {
  const root = join(import.meta.dirname, '..');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('testkit.ts')) files.push(p);
    }
  };
  walk(join(root, 'core'));
  walk(join(root, 'fixtures'));
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/Date\.now\s*\(/.test(text), `${f} uses Date.now`);
    assert.ok(!/Math\.random\s*\(/.test(text), `${f} uses Math.random`);
    assert.ok(!/new Date\(\s*\)/.test(text), `${f} uses new Date()`);
  }
});
