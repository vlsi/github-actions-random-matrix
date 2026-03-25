import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Axis, MatrixBuilder } from '../src/matrix_builder.mjs';

// Deterministic RNG for reproducible tests (simple LCG)
function createTestRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function buildSimpleMatrix(random) {
  const m = new MatrixBuilder({random});
  m.addAxis({name: 'os', values: ['linux', 'windows', 'mac']});
  m.addAxis({name: 'jdk', values: ['8', '11', '17']});
  m.addAxis({name: 'mode', values: ['fast', 'slow']});
  m.setNamePattern(['os', 'jdk']);
  return m;
}

describe('Axis.matches', () => {
  it('matches literal values', () => {
    assert.equal(Axis.matches('linux', 'linux'), true);
    assert.equal(Axis.matches('linux', 'windows'), false);
  });

  it('matches function predicates', () => {
    assert.equal(Axis.matches(8, v => v >= 11), false);
    assert.equal(Axis.matches(11, v => v >= 11), true);
  });

  it('matches arrays (any of)', () => {
    assert.equal(Axis.matches('linux', ['linux', 'mac']), true);
    assert.equal(Axis.matches('windows', ['linux', 'mac']), false);
  });

  it('matches nested objects', () => {
    const row = {os: 'linux', jdk: {name: 'openjdk', version: 11}};
    assert.equal(Axis.matches(row, {jdk: {version: 11}}), true);
    assert.equal(Axis.matches(row, {jdk: {version: 8}}), false);
  });

  it('does not match missing keys', () => {
    assert.equal(Axis.matches({os: 'linux'}, {jdk: '11'}), false);
  });
});

describe('constrain', () => {
  it('filters rows via constrain()', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.constrain(['os', 'jdk'], (os, jdk) => !(os === 'windows' && jdk === '8'));

    for (let i = 0; i < 20; i++) {
      m.generateRow();
    }
    const bad = m.rows.filter(r => r.os === 'windows' && r.jdk === '8');
    assert.equal(bad.length, 0, 'windows + jdk 8 should be excluded');
  });
});

describe('exclude', () => {
  it('excludes matching combinations', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.exclude({os: 'windows', jdk: '8'});

    for (let i = 0; i < 20; i++) {
      m.generateRow();
    }
    const bad = m.rows.filter(r => r.os === 'windows' && r.jdk === '8');
    assert.equal(bad.length, 0);
  });

  it('throws on function filters', () => {
    const m = buildSimpleMatrix(createTestRng());
    assert.throws(() => m.exclude(() => true), /not supported/);
  });

  it('excludes with function value predicates', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'pg', values: [{value: '9'}, {value: '10'}, {value: '14'}]});
    m.addAxis({name: 'ssl', values: [{value: 'yes'}, {value: 'no'}]});
    m.setNamePattern(['pg', 'ssl']);
    m.exclude({ssl: {value: 'yes'}, pg: {value: v => Number(v) < 10}});

    for (let i = 0; i < 20; i++) {
      m.generateRow();
    }
    const bad = m.rows.filter(r => r.ssl.value === 'yes' && Number(r.pg.value) < 10);
    assert.equal(bad.length, 0, 'ssl=yes + pg<10 should be excluded');
  });
});

describe('imply', () => {
  it('enforces implication', () => {
    const m = buildSimpleMatrix(createTestRng());
    // windows => jdk 17
    m.imply({os: 'windows'}, {jdk: '17'});

    for (let i = 0; i < 20; i++) {
      m.generateRow();
    }
    const windowsRows = m.rows.filter(r => r.os === 'windows');
    assert.ok(windowsRows.length > 0, 'should have some windows rows');
    const bad = windowsRows.filter(r => r.jdk !== '17');
    assert.equal(bad.length, 0, 'all windows rows must have jdk 17');
  });

  it('imply with function predicate in consequent', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'dist', values: ['oracle', 'temurin', 'microsoft']});
    m.addAxis({name: 'ver', values: [8, 11, 17, 21]});
    m.setNamePattern(['dist', 'ver']);
    // oracle only ships 21+
    m.imply({dist: 'oracle'}, {ver: v => v >= 21});

    for (let i = 0; i < 20; i++) {
      m.generateRow();
    }
    const oracleRows = m.rows.filter(r => r.dist === 'oracle');
    const bad = oracleRows.filter(r => r.ver < 21);
    assert.equal(bad.length, 0, 'oracle must have ver >= 21');
  });
});

describe('pair coverage', () => {
  it('excludes infeasible pairs from total', () => {
    const m = buildSimpleMatrix(createTestRng());
    const reportBefore = m.pairCoverageReport();

    const m2 = buildSimpleMatrix(createTestRng());
    m2.exclude({os: 'windows', jdk: '8'});
    m2.exclude({os: 'windows', jdk: '11'});
    const reportAfter = m2.pairCoverageReport();

    assert.ok(reportAfter.total < reportBefore.total,
      `constrained total (${reportAfter.total}) should be less than unconstrained (${reportBefore.total})`);
  });

  it('reaches 100% coverage for small matrix', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'a', values: ['a1', 'a2']});
    m.addAxis({name: 'b', values: ['b1', 'b2']});
    m.setNamePattern(['a', 'b']);

    // 2x2 = 4 pairs, should be coverable in few rows
    for (let i = 0; i < 10; i++) {
      m.generateRow();
    }
    const report = m.pairCoverageReport();
    assert.equal(report.percentage, '100.0');
  });

  it('infeasible pairs are not counted as uncovered', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'a', values: ['a1', 'a2']});
    m.addAxis({name: 'b', values: ['b1', 'b2']});
    m.setNamePattern(['a', 'b']);
    // exclude (a1, b1) => 3 feasible pairs
    m.exclude({a: 'a1', b: 'b1'});

    const report = m.pairCoverageReport();
    assert.equal(report.total, 3);
  });
});

describe('generateRow', () => {
  it('generates rows matching filter', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.generateRow({os: 'windows'});
    assert.equal(m.rows[0].os, 'windows');
  });

  it('returns the existing matching row instead of generating a duplicate', () => {
    const m = buildSimpleMatrix(createTestRng());
    const row = m.generateRow({os: 'windows'});
    const sameRow = m.generateRow({os: 'windows'});
    assert.equal(m.rows.length, 1);
    assert.equal(sameRow, row);
  });

  it('respects weights in pair scoring', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'a', values: [
      {value: 'heavy', weight: 100},
      {value: 'light', weight: 1},
    ]});
    m.addAxis({name: 'b', values: ['b1', 'b2']});
    m.setNamePattern(['a', 'b']);

    const report = m.pairCoverageReport();
    assert.equal(report.total, 4);
  });
});

describe('ensureAllAxisValuesCovered', () => {
  it('generates at least one row per axis value', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.ensureAllAxisValuesCovered('os');
    const coveredOs = new Set(m.rows.map(r => r.os));
    assert.deepEqual(coveredOs, new Set(['linux', 'windows', 'mac']));
  });
});

describe('generateRows', () => {
  it('respects maxRows limit', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.generateRows(5);
    assert.ok(m.rows.length <= 5);
  });

  it('stops once all unique rows are exhausted', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'a', values: ['x', 'y']});
    m.addAxis({name: 'b', values: ['1']});
    m.setNamePattern(['a', 'b']);

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      m.generateRows(10);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(m.rows.length, 2);
    assert.deepEqual(warnings, []);
  });
});

describe('summary', () => {
  it('counts good and bad combinations', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.exclude({os: 'windows', jdk: '8'});
    const s = m.summary();
    assert.equal(s.good + s.bad, 18);
    assert.equal(s.bad, 2);
    assert.equal(s.good, 16);
  });

  it('returns zeroes for an empty matrix', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    assert.deepEqual(m.summary(), {good: 0, bad: 0});
  });
});

describe('matches', () => {
  it('accepts valid row', () => {
    const m = buildSimpleMatrix(createTestRng());
    assert.equal(m.matches({os: 'linux', jdk: '11', mode: 'fast'}), true);
  });

  it('rejects excluded row', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.exclude({os: 'windows', jdk: '8'});
    assert.equal(m.matches({os: 'windows', jdk: '8', mode: 'fast'}), false);
    assert.equal(m.matches({os: 'windows', jdk: '11', mode: 'fast'}), true);
  });
});

describe('failOnUnsatisfiableFilters', () => {
  it('throws when enabled and a filtered row cannot be generated', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.exclude({os: 'windows'});
    m.failOnUnsatisfiableFilters(true);

    assert.throws(() => m.generateRow({os: 'windows'}), /Unable to generate row/);
  });
});

describe('deterministic output', () => {
  it('produces same rows with same RNG seed', () => {
    const m1 = buildSimpleMatrix(createTestRng(123));
    m1.generateRows(5);

    const m2 = buildSimpleMatrix(createTestRng(123));
    m2.generateRows(5);

    for (let i = 0; i < m1.rows.length; i++) {
      assert.equal(m1.rows[i].os, m2.rows[i].os);
      assert.equal(m1.rows[i].jdk, m2.rows[i].jdk);
      assert.equal(m1.rows[i].mode, m2.rows[i].mode);
    }
  });

  it('produces different rows with different RNG seed', () => {
    const m1 = buildSimpleMatrix(createTestRng(1));
    m1.generateRows(10);

    const m2 = buildSimpleMatrix(createTestRng(999));
    m2.generateRows(10);

    const same = m1.rows.every((r, i) =>
      r.os === m2.rows[i].os && r.jdk === m2.rows[i].jdk && r.mode === m2.rows[i].mode
    );
    assert.equal(same, false, 'different seeds should produce different matrices');
  });
});

describe('constraint scope filtering', () => {
  it('3-axis constraint does not affect pair filtering', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'a', values: ['a1', 'a2']});
    m.addAxis({name: 'b', values: ['b1', 'b2']});
    m.addAxis({name: 'c', values: ['c1', 'c2']});
    m.setNamePattern(['a', 'b', 'c']);
    // 3-axis constraint: scope is {a,b,c}, won't match any pair scope {a,b}, {a,c}, {b,c}
    m.constrain(['a', 'b', 'c'], (a, b, c) => !(a === 'a1' && b === 'b1' && c === 'c1'));

    const report = m.pairCoverageReport();
    // All 2-way pairs should be present: C(3,2) * 2*2 = 3*4 = 12
    assert.equal(report.total, 12,
      '3-axis constraint should not filter any pairs');
  });

  it('2-axis constraint does filter pairs', () => {
    const m = new MatrixBuilder({random: createTestRng()});
    m.addAxis({name: 'a', values: ['a1', 'a2']});
    m.addAxis({name: 'b', values: ['b1', 'b2']});
    m.addAxis({name: 'c', values: ['c1', 'c2']});
    m.setNamePattern(['a', 'b', 'c']);
    m.constrain(['a', 'b'], (a, b) => !(a === 'a1' && b === 'b1'));

    const report = m.pairCoverageReport();
    // Pairs: a-b has 3 (not 4), a-c has 4, b-c has 4 => 11
    assert.equal(report.total, 11);
  });
});
