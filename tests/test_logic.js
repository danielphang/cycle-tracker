const test = require('node:test');
const assert = require('node:assert');
const logic = require('../logic.js');

test('calcHormones should return values within 0-100', (t) => {
  for (let d = 0; d <= 28; d++) {
    const h = logic.calcHormones(d, 28);
    assert.ok(h.estrogen >= 0 && h.estrogen <= 100);
    assert.ok(h.progesterone >= 0 && h.progesterone <= 100);
    assert.ok(h.lh >= 0 && h.lh <= 100);
    assert.ok(h.fsh >= 0 && h.fsh <= 100);
  }
});

test('getPhase should identify phases correctly', (t) => {
  assert.strictEqual(logic.getPhase(2, 28, 5).name, 'Menstruation');
  assert.strictEqual(logic.getPhase(10, 28, 5).name, 'Follicular');
  assert.strictEqual(logic.getPhase(14, 28, 5).name, 'Ovulation');
  assert.strictEqual(logic.getPhase(20, 28, 5).name, 'Luteal');
});

test('fitScore should return high score for perfect alignment', (t) => {
  // Ovulation (avg 2.0), score 2 should be high
  const s = logic.fitScore(2, 'Ovulation', 0.5, 5/28);
  assert.ok(s >= 0.8, `Expected high fit score for aligned mood, got ${s}`);
});

test('fitScore should return low score for misalignment', (t) => {
  // Ovulation (avg 2.0), score -2 should be low
  const s = logic.fitScore(-2, 'Ovulation', 0.5, 5/28);
  assert.ok(s < 0.4, `Expected low fit score for misaligned mood, got ${s}`);
});

test('extractDate should parse relative dates', (t) => {
  const ext = logic.extractDate('yesterday mood was bad');
  const yesterday = new Date();
  yesterday.setHours(0,0,0,0);
  yesterday.setDate(yesterday.getDate() - 1);
  const expected = yesterday.toISOString().split('T')[0];
  assert.strictEqual(ext.date, expected);
});

test('classifyMood should find keywords', (t) => {
  const m = logic.classifyMood('she was feeling very frustrated');
  assert.strictEqual(m.score, -2);
  assert.strictEqual(m.word, 'frustrated');
});

test('parseInput should detect period entry', (t) => {
  const res = logic.parseInput('period started today');
  assert.strictEqual(res.type, 'period');
});

test('parseInput should detect mood entry', (t) => {
  const res = logic.parseInput('happy');
  assert.strictEqual(res.type, 'mood');
  assert.strictEqual(res.score, 2);
});

test('fmtDate should format ISO string', (t) => {
  assert.strictEqual(logic.fmtDate('2026-03-20'), 'Mar 20');
});
