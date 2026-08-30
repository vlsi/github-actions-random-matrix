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

describe('generateRows with batch requirements', () => {
  it('satisfies every required combination within the budget', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.generateRows(6, {
      require: [
        {os: 'windows'},
        {os: 'mac'},
        {jdk: '8'},
        {jdk: '17'},
        {mode: 'slow'},
      ],
    });
    assert.ok(m.rows.length <= 6);
    assert.ok(m.rows.some(r => r.os === 'windows'));
    assert.ok(m.rows.some(r => r.os === 'mac'));
    assert.ok(m.rows.some(r => r.jdk === '8'));
    assert.ok(m.rows.some(r => r.jdk === '17'));
    assert.ok(m.rows.some(r => r.mode === 'slow'));
  });

  it('is independent of requirement order', () => {
    const reqs = [
      {os: 'windows'}, {os: 'mac'}, {os: 'linux'},
      {jdk: '8'}, {jdk: '11'}, {jdk: '17'},
      {mode: 'fast'}, {mode: 'slow'},
    ];
    const covered = m => ({
      os: new Set(m.rows.map(r => r.os)),
      jdk: new Set(m.rows.map(r => r.jdk)),
      mode: new Set(m.rows.map(r => r.mode)),
    });

    const a = buildSimpleMatrix(createTestRng(7));
    a.generateRows(8, {require: reqs});
    const b = buildSimpleMatrix(createTestRng(7));
    b.generateRows(8, {require: reqs.slice().reverse()});

    // Both orders must cover all the required values (order does not drop any).
    for (const m of [a, b]) {
      const c = covered(m);
      assert.deepEqual(c.os, new Set(['linux', 'windows', 'mac']));
      assert.deepEqual(c.jdk, new Set(['8', '11', '17']));
      assert.deepEqual(c.mode, new Set(['fast', 'slow']));
    }
  });

  it('packs broad requirements into the floor number of rows', () => {
    // os and jdk each have 3 values, mode has 2. A single row cannot hold two
    // values of the same axis, so the floor is 3 rows: they can still carry
    // os={linux,windows,mac}, jdk={8,11,17} and mode={fast,slow} together.
    // With maxRows == floor there is no leftover budget for a coverage fill,
    // so this asserts the packing alone fits everything.
    const m = buildSimpleMatrix(createTestRng());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      m.generateRows(3, {
        require: [...m.allAxisValues('os'), ...m.allAxisValues('jdk'), ...m.allAxisValues('mode')],
      });
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(warnings, [], `requirements should fit into 3 rows: ${warnings}`);
    assert.equal(m.rows.length, 3);
    assert.deepEqual(new Set(m.rows.map(r => r.os)), new Set(['linux', 'windows', 'mac']));
    assert.deepEqual(new Set(m.rows.map(r => r.jdk)), new Set(['8', '11', '17']));
    assert.deepEqual(new Set(m.rows.map(r => r.mode)), new Set(['fast', 'slow']));
  });

  it('spreads requirements instead of pairing them when the budget has slack', () => {
    // Requirements {a:1},{a:4},{b:a},{b:b} pack into a floor of 2 rows, which
    // forces the required values to share rows (1 with a, 4 with b). With a
    // looser budget the packing bonus stays off, so each requirement can anchor
    // its own row and pick a random partner on the other axis. Verify that the
    // rows satisfying the a-requirements then carry non-required b-values too
    // (issue #11). The b-value is read off the tagged row that satisfied each
    // a-requirement, not off the whole matrix: pairwise-fill rows also combine
    // a:1/a:4 with free b-values under the old always-paired behavior, so only
    // the requirement-satisfying rows tell the two implementations apart.
    const buildAB = random => {
      const m = new MatrixBuilder({random});
      m.addAxis({name: 'a', values: [1, 2, 3, 4]});
      m.addAxis({name: 'b', values: ['a', 'b', 'c', 'd', 'e', 'f']});
      m.setNamePattern(['a', 'b']);
      return m;
    };
    const anchorPartners = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const m = buildAB(createTestRng(seed));
      let rowA1, rowA4;
      m.generateRows(5, {
        require: [
          {filter: {a: 1}, tag: r => { rowA1 = r; }},
          {filter: {a: 4}, tag: r => { rowA4 = r; }},
          {b: 'a'},
          {b: 'b'},
        ],
      });
      // The requirements are still guaranteed within the budget.
      for (const v of ['a', 'b']) assert.ok(m.rows.some(r => r.b === v));
      assert.ok(rowA1 && rowA1.a === 1);
      assert.ok(rowA4 && rowA4.a === 4);
      anchorPartners.add(rowA1.b);
      anchorPartners.add(rowA4.b);
    }
    // Across seeds, a row satisfying an a-requirement carries a non-required
    // b-value at least once. The old behavior always packed a required b-value
    // onto those rows, so it never reaches c/d/e/f here.
    assert.ok(['c', 'd', 'e', 'f'].some(v => anchorPartners.has(v)),
      `a-requirements only ever paired with required b-values: ${[...anchorPartners]}`);
  });

  it("requirePacking 'always' packs requirements tightly even with budget to spare", () => {
    // Same setup as the spread test, but 'always' forces the original packing:
    // every row that satisfies an a-requirement carries a required b-value, so
    // the anchor rows never reach c/d/e/f no matter the seed.
    const buildAB = random => {
      const m = new MatrixBuilder({random});
      m.addAxis({name: 'a', values: [1, 2, 3, 4]});
      m.addAxis({name: 'b', values: ['a', 'b', 'c', 'd', 'e', 'f']});
      m.setNamePattern(['a', 'b']);
      return m;
    };
    for (let seed = 1; seed <= 12; seed++) {
      const m = buildAB(createTestRng(seed));
      let rowA1, rowA4;
      m.generateRows(5, {
        requirePacking: 'always',
        require: [
          {filter: {a: 1}, tag: r => { rowA1 = r; }},
          {filter: {a: 4}, tag: r => { rowA4 = r; }},
          {b: 'a'},
          {b: 'b'},
        ],
      });
      assert.ok(['a', 'b'].includes(rowA1.b), `a:1 packed with ${rowA1.b}`);
      assert.ok(['a', 'b'].includes(rowA4.b), `a:4 packed with ${rowA4.b}`);
    }
  });

  it('varies which requirement is packed when the budget forces pairing', () => {
    // 4 requirements into 3 rows: two of them must share a row (pigeonhole), so
    // the packing bonus turns on. A shared row always holds one a-requirement
    // and one b-requirement, which leaves the other a-requirement a free row and
    // a random partner. Declaration order alone used to decide who lost the free
    // row, so {a:1} always anchored row 0 and never reached b=c..f while {a:4}
    // always did (issue #11). Phase 1 shuffles per seed now, so the roles swap.
    const buildAB = random => {
      const m = new MatrixBuilder({random});
      m.addAxis({name: 'a', values: [1, 2, 3, 4]});
      m.addAxis({name: 'b', values: ['a', 'b', 'c', 'd', 'e', 'f']});
      m.setNamePattern(['a', 'b']);
      return m;
    };
    const partners = {1: new Set(), 4: new Set()};
    const firstRowA = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      // Spread the seeds. createTestRng is an LCG seeded by its own state, so consecutive
      // small seeds differ by 1664525/2^31 on the first draw and share the first swap of
      // Phase 1's Fisher-Yates shuffle, which is the draw this test is about.
      const m = buildAB(createTestRng(seed * 7919));
      let rowA1, rowA4;
      m.generateRows(3, {
        require: [
          {filter: {a: 1}, tag: r => { rowA1 = r; }},
          {filter: {a: 4}, tag: r => { rowA4 = r; }},
          {b: 'a'},
          {b: 'b'},
        ],
      });
      // A tighter budget must not cost coverage: every requirement still lands.
      assert.equal(m.rows.length, 3);
      assert.ok(rowA1 && rowA1.a === 1);
      assert.ok(rowA4 && rowA4.a === 4);
      for (const v of ['a', 'b']) assert.ok(m.rows.some(r => r.b === v));
      partners[1].add(rowA1.b);
      partners[4].add(rowA4.b);
      firstRowA.add(m.rows[0].a);
    }
    // Neither a-requirement is the one that always loses its free row.
    for (const a of [1, 4]) {
      assert.ok(['c', 'd', 'e', 'f'].some(v => partners[a].has(v)),
        `a:${a} only ever paired with required b-values: ${[...partners[a]]}`);
    }
    // Row 0 is no longer pinned to the first declared requirement.
    assert.ok(firstRowA.size > 1, `row 0 always had a:${[...firstRowA]}`);
  });

  it('rejects an unknown requirePacking value', () => {
    const m = buildSimpleMatrix(createTestRng());
    assert.throws(
      () => m.generateRows(5, {require: [{os: 'linux'}], requirePacking: 'sometimes'}),
      /Invalid requirePacking/);
  });

  it('fires tag(row) on the row that satisfies a requirement', () => {
    const m = buildSimpleMatrix(createTestRng());
    let tagged = null;
    m.generateRows(6, {
      require: [
        {filter: {os: 'windows', jdk: '17', mode: 'slow'}, tag: r => { tagged = r; }},
        {os: 'linux'},
      ],
    });
    assert.ok(tagged, 'tag should have fired');
    assert.equal(tagged.os, 'windows');
    assert.equal(tagged.jdk, '17');
    assert.equal(tagged.mode, 'slow');
    assert.ok(m.rows.includes(tagged), 'tagged row must be part of the matrix');
  });

  it('counts a pinned generateRow() toward the budget and requirements', () => {
    const m = buildSimpleMatrix(createTestRng());
    const pinned = m.generateRow({os: 'windows', jdk: '17', mode: 'slow'});
    pinned.collectCoverage = true;
    m.generateRows(6, {require: [{os: 'windows'}, {mode: 'slow'}]});

    // The pin already satisfies {os: windows} and {mode: slow}, so no extra row
    // is spent on them, and the pin keeps its custom field.
    const flagged = m.rows.filter(r => r.collectCoverage);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0], pinned);
  });

  it('warns when requirements do not fit the budget', () => {
    const m = buildSimpleMatrix(createTestRng());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      // os needs 3 distinct rows, but only 2 are allowed.
      m.generateRows(2, {require: m.allAxisValues('os')});
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(m.rows.length, 2);
    assert.ok(warnings.some(w => /did not fit/.test(w)), `unexpected warnings: ${warnings}`);
  });

  it('throws on unsatisfiable requirements when failOnUnsatisfiableFilters is set', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.exclude({os: 'windows'});
    m.failOnUnsatisfiableFilters(true);
    assert.throws(() => m.generateRows(5, {require: [{os: 'windows'}]}), /unsatisfiable/);
  });

  it('warns when the require option is misspelled (e.g. required)', () => {
    const m = buildSimpleMatrix(createTestRng());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      // `required` is not a valid option; it must not be silently dropped.
      m.generateRows(5, {required: [{os: 'windows'}, {jdk: '17'}]});
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(
      warnings.some(w => /required/.test(w) && /require/.test(w)),
      `expected a warning hinting at 'require', got: ${warnings}`);
  });

  it('warns on a legacy fill filter key that is not an axis name', () => {
    const m = buildSimpleMatrix(createTestRng());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      m.generateRows(3, {oss: 'windows'});
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(
      warnings.some(w => /oss/.test(w) && /axis/.test(w)),
      `expected a warning about the unknown axis key, got: ${warnings}`);
  });

  it('does not warn on a valid legacy fill filter', () => {
    const m = buildSimpleMatrix(createTestRng());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      m.generateRows(3, {os: 'linux'});
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(warnings, [], `unexpected warnings: ${warnings}`);
    assert.ok(m.rows.every(r => r.os === 'linux'));
  });

  it('throws on a misspelled option when failOnUnsatisfiableFilters is set', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.failOnUnsatisfiableFilters(true);
    assert.throws(() => m.generateRows(5, {require: [{os: 'linux'}], fil: {}}),
      /unknown option/);
  });

  it('throws on an unsatisfiable tagged requirement even when other failures only warn', () => {
    const m = buildSimpleMatrix(createTestRng());
    m.exclude({os: 'windows'});
    // failOnUnsatisfiableFilters is left off: the tag alone makes this fatal.
    assert.throws(
      () => m.generateRows(5, {require: [{filter: {os: 'windows'}, tag: r => { r.tagged = true; }}]}),
      /tagged requirement/);
  });

  it('throws when a tagged requirement does not fit the row budget', () => {
    const m = buildSimpleMatrix(createTestRng());
    assert.throws(
      () => m.generateRows(1, {
        // One row cannot carry two values of the same axis, so whichever of these anchors
        // it, the other is dropped — and both are tagged.
        require: [
          {filter: {os: 'linux'}, tag: r => { r.taggedLinux = true; }},
          {filter: {os: 'windows'}, tag: r => { r.taggedWindows = true; }},
        ],
      }),
      /tagged requirement/);
  });

  it('anchors a tagged requirement ahead of the untagged ones that may be dropped', () => {
    // Three one-axis requirements into two rows: one is dropped. The anchor used to be
    // chosen on specificity alone, with ties broken by Phase 1's seeded shuffle, so the
    // tagged requirement lost the budget race on some seeds and generateRows threw on
    // those seeds alone — the same script failing on one pull request number and passing
    // on the next. Before the fix this threw on 15 of these 40 seeds.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    let dropped = 0;
    try {
      for (let seed = 1; seed <= 40; seed++) {
        const m = buildSimpleMatrix(createTestRng(seed * 7919));
        let tagged = null;
        const before = warnings.length;
        m.generateRows(2, {
          require: [
            {os: 'linux'},
            {os: 'windows'},
            {filter: {os: 'mac'}, tag: r => { tagged = r; }},
          ],
        });
        assert.ok(tagged, `seed ${seed}: the tagged requirement went unsatisfied`);
        assert.equal(tagged.os, 'mac');
        if (warnings.length > before) {
          dropped++;
        }
      }
    } finally {
      console.warn = originalWarn;
    }
    // Two rows hold two of the three requirements, so an untagged one is dropped on every
    // seed. Without that the loop would never reach the race this test is about.
    assert.equal(dropped, 40, `expected every seed to drop an untagged requirement, got ${dropped}`);
  });

  it('keeps a tagged requirement a row could still carry, over untagged competitors', () => {
    // One row; two tagged requirements that a single row can satisfy together ({a:1,c:1}
    // and {b:1}); three untagged ones that pull the other way. Scoring every requirement
    // the same made the packer take the row covering three untagged requirements and drop
    // the feasible tagged one, so every seed threw.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      for (let seed = 1; seed <= 40; seed++) {
        const m = new MatrixBuilder({random: createTestRng(seed * 7919)});
        m.addAxis({name: 'a', values: [0, 1]});
        m.addAxis({name: 'b', values: [0, 1]});
        m.addAxis({name: 'c', values: [0, 1]});
        m.addAxis({name: 'd', values: [0, 1]});
        m.setNamePattern(['a', 'b', 'c', 'd']);
        let first = null;
        let second = null;
        m.generateRows(1, {
          require: [
            {filter: {a: 1, c: 1}, tag: r => { first = r; }},
            {filter: {b: 1}, tag: r => { second = r; }},
            {b: 0},
            {b: 0, c: 1},
            {b: 0, d: 0},
          ],
        });
        assert.ok(first && second, `seed ${seed}: a tagged requirement was dropped`);
        assert.equal(m.rows.length, 1);
      }
    } finally {
      console.warn = originalWarn;
    }
    // The three untagged requirements cannot fit that one row, so every seed drops some.
    // Without that the packer never feels the pressure this test is about.
    assert.equal(warnings.length, 40,
      `expected one dropped-requirement warning per seed, got ${warnings.length}`);
  });

  it('reports a fill filter that admits no value', () => {
    // Phase 2 asks for its rows with warnings off, so a fill value the axis does not have
    // stopped the coverage fill on its first attempt and returned a short matrix in silence.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    const m = buildSimpleMatrix(createTestRng());
    try {
      m.generateRows(6, {require: [{os: 'mac'}], fill: {os: 'lnux'}});
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some(w => /fill filter admits no value of axis 'os'/.test(w)),
      `expected a fill-filter warning, got: ${warnings}`);
  });

  it('names a require entry that carries a tag and no filter', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    const m = buildSimpleMatrix(createTestRng());
    try {
      // Nothing matches an absent filter, so the entry is fatal on the tagged path. Both
      // the warning and the error have to name it; the error used to list it as nothing.
      assert.throws(() => m.generateRows(3, {require: [{tag: r => { r.tagged = true; }}]}),
        /\(no filter\)/);
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some(w => /a tag needs a filter/.test(w)),
      `expected a config warning, got: ${warnings}`);
  });

  it('names the budget the failure needs, counting rows pinned before the call', () => {
    // The number is what turns this failure into an action. Phase 1 works from the rows
    // left rather than from maxRows, so a matrix with rows pinned by hand reaches the same
    // failure at a larger maxRows — and guarding the advice on maxRows alone dropped the
    // number exactly there, where maxRows already looks big enough.
    const requirements = [
      {filter: {a: 1, d: 0}, tag: () => {}},
      {filter: {a: 1, d: 1}, tag: () => {}},
      {filter: {a: 1, c: 0, d: 0}, tag: () => {}},
      {filter: {a: 1, b: 0, c: 1}, tag: () => {}},
    ];
    const build = () => {
      const m = new MatrixBuilder({random: createTestRng(7919)});
      for (const name of ['a', 'b', 'c', 'd']) {
        m.addAxis({name, values: [0, 1]});
      }
      m.setNamePattern(['a', 'b', 'c', 'd']);
      return m;
    };
    assert.throws(() => build().generateRows(2, {require: requirements}),
      /raise the row budget to 4 /);

    const pinned = build();
    // Neither pinned row carries a:1, so neither satisfies a requirement; they only spend
    // budget, which is the case the advice has to account for.
    pinned.generateRow({a: 0, b: 0});
    pinned.generateRow({a: 0, b: 1});
    assert.throws(() => pinned.generateRows(4, {require: requirements}),
      /raise the row budget to 6 .*plus the 2 pinned before this call/);
  });

  it('holds every tagged requirement when the budget is one row each', () => {
    // Tagged requirements that must share rows are packed greedily, so a budget below one
    // row each can strand one even where a packing exists. At one row each the reserve
    // makes that unreachable, which is the guarantee the README states.
    const requirements = [
      {filter: {d: 0}, tag: () => {}},
      {filter: {d: 1}, tag: () => {}},
      {filter: {c: 0, d: 0}, tag: () => {}},
      {filter: {b: 0, c: 1}, tag: () => {}},
    ];
    const build = seed => {
      const m = new MatrixBuilder({random: createTestRng(seed * 7919)});
      for (const name of ['b', 'c', 'd']) {
        m.addAxis({name, values: [0, 1]});
      }
      m.setNamePattern(['b', 'c', 'd']);
      return m;
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    let tight = 0;
    try {
      for (let seed = 1; seed <= 40; seed++) {
        try {
          build(seed).generateRows(2, {require: requirements});
        } catch (e) {
          tight++;
        }
        // One row per tagged requirement: this must not throw on any seed.
        build(seed).generateRows(requirements.length, {require: requirements});
      }
    } finally {
      console.warn = originalWarn;
    }
    // Without a seed that fails at two rows, the loop would pass on a packer that never
    // packs at all, and the guarantee would be untested.
    assert.ok(tight > 0, 'no seed exercised the tight budget');
  });

  it('reports a filter that admits no value through generateRows', () => {
    // A filter admitting no value of an axis — a misspelling, a falsy pin, or a predicate
    // matching none — escaped as `No values produced for axis ...` thrown out of pickValue,
    // past the caller that knows which requirement it belongs to: no rows, no warning, and
    // no flag that changed it.
    for (const filter of [{os: 0}, {os: 'lnux'}, {jdk: v => Number(v) >= 99}]) {
      const shape = JSON.stringify(filter);
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = message => warnings.push(message);
      const m = buildSimpleMatrix(createTestRng());
      try {
        m.generateRows(4, {require: [filter]});
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(m.rows.length, 4, `${shape}: the coverage fill stopped`);
      assert.ok(warnings.some(w => /unsatisfiable/.test(w)),
        `${shape}: expected an unsatisfiable warning, got: ${warnings}`);
    }
  });

  it('names a predicate filter in the diagnostic', () => {
    // JSON.stringify drops a function, so a filter written entirely as predicates printed
    // as {} — and a version bound is exactly the case the README writes that way.
    const m = buildSimpleMatrix(createTestRng());
    m.failOnUnsatisfiableFilters(true);
    assert.throws(
      () => m.generateRows(4, {require: [{jdk: v => Number(v) >= 99}]}),
      /Number\(v\) >= 99/);
  });

  it('honors a filter that pins a falsy value', () => {
    // pickValue tested its filter for truth, so a pin on 0, false or '' was dropped and the
    // axis was drawn at random. The requirement then held only when the draw agreed, which
    // for a tagged one is a throw on some seeds and not on others, at any row budget.
    for (let seed = 1; seed <= 40; seed++) {
      const m = new MatrixBuilder({random: createTestRng(seed * 7919)});
      m.addAxis({name: 'x', values: [0, 1, 2, 3]});
      m.addAxis({name: 'flag', values: [false, true]});
      m.addAxis({name: 'label', values: ['', 'a', 'b']});
      m.setNamePattern(['x']);
      let tagged = null;
      m.generateRows(5, {
        require: [{filter: {x: 0, flag: false, label: ''}, tag: r => { tagged = r; }}],
      });
      assert.ok(tagged, `seed ${seed}: the falsy pin was dropped`);
      assert.equal(tagged.x, 0);
      assert.equal(tagged.flag, false);
      assert.equal(tagged.label, '');
    }
  });

  it('does not aim forced packing at the tagged row', () => {
    // Four requirements into three rows, one of them tagged, so the pigeonhole forces a
    // pairing. The anchor is the row that carries the packing bonus, so anchoring tagged
    // requirements first aimed that pairing at the tagged row on every one of these seeds.
    // Reserving a row for it instead leaves it free to draw a varied partner.
    let free = 0;
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      for (let seed = 1; seed <= 120; seed++) {
        const m = new MatrixBuilder({random: createTestRng(seed * 7919)});
        m.addAxis({name: 'a', values: [1, 2, 3, 4]});
        m.addAxis({name: 'b', values: ['a', 'b', 'c', 'd', 'e', 'f']});
        m.setNamePattern(['a', 'b']);
        let tagged = null;
        m.generateRows(3, {
          require: [
            {filter: {a: 1}, tag: r => { tagged = r; }},
            {a: 4},
            {b: 'a'},
            {b: 'b'},
          ],
        });
        assert.ok(tagged, `seed ${seed}: the tagged requirement went unsatisfied`);
        if (!['a', 'b'].includes(tagged.b)) {
          free++;
        }
      }
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(free >= 24,
      `the tagged row carried a required partner on ${120 - free} of 120 seeds`);
  });

  it('keeps warning for an untagged requirement that does not fit the budget', () => {
    const m = buildSimpleMatrix(createTestRng());
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
      m.generateRows(1, {require: [{os: 'linux', jdk: '17'}, {os: 'windows'}]});
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(
      warnings.some(w => /did not fit/.test(w)),
      `expected a warning about the dropped requirement, got: ${warnings}`);
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
