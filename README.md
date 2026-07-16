About
=====

Generate randomized GitHub Actions matrices with pairwise coverage and constraint support.

Install
-------

```sh
npm install @vlsi/github-actions-random-matrix
```

Usage
-----

Create `.github/workflows/matrix.mjs`:

```js
import { createGitHubMatrixBuilder, setGitHubOutput } from '@vlsi/github-actions-random-matrix/github';

const { matrix } = createGitHubMatrixBuilder();

matrix.addAxis({
  name: 'tz',
  values: [
    'America/New_York',
    'Pacific/Chatham',
    'UTC'
  ]
});

matrix.addAxis({
  name: 'os',
  title: x => x.replace('-latest', ''),
  values: [
    'ubuntu-latest',
    'windows-latest',
    'macos-latest'
  ]
});

matrix.addAxis({
  name: 'locale',
  title: x => x.language + '_' + x.country,
  values: [
    {language: 'de', country: 'DE'},
    {language: 'fr', country: 'FR'},
    {language: 'ru', country: 'RU'},
    {language: 'tr', country: 'TR'},
  ]
});

matrix.setNamePattern(['os', 'tz', 'locale']);

matrix.exclude({locale: {language: 'de'}, os: 'macos-latest'});

// Pass the combinations you care about as a batch. generateRows guarantees a row
// for each one, fixes the job count regardless of list order, and fills the rest
// of the budget with pairwise coverage.
const include = matrix.generateRows(Number(process.env.MATRIX_JOBS || 5), {
  require: [
    ...matrix.allAxisValues('os'), // run every OS at least once
    {tz: 'UTC'},
  ],
});
if (include.length === 0) {
  throw new Error('Matrix list is empty');
}

include.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
console.log(include);

// setGitHubOutput writes the matrix to $GITHUB_OUTPUT with a random, multiline-safe
// delimiter, and no-ops outside GitHub Actions.
setGitHubOutput('matrix', {include});
```

A complete, runnable example with weighted axes and derived fields is in [`examples/matrix.mjs`](examples/matrix.mjs). The current `pgjdbc` usage is in [`.github/workflows/matrix.mjs`](https://github.com/pgjdbc/pgjdbc/blob/master/.github/workflows/matrix.mjs).

Workflow example:

```yaml
jobs:
  matrix_prep:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    env:
      MATRIX_JOBS: 7
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - id: set-matrix
        run: node .github/workflows/matrix.mjs

  build:
    needs: matrix_prep
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix: ${{ fromJson(needs.matrix_prep.outputs.matrix) }}
    name: ${{ matrix.name }}
    env:
      TZ: ${{ matrix.tz }}
```

API
---

`import { MatrixBuilder } from '@vlsi/github-actions-random-matrix'`

`import { createGitHubMatrixBuilder } from '@vlsi/github-actions-random-matrix/github'`

Features:

* `generateRows(n, {require})` is the main entry point: it generates the combinations you require as a batch and fits them into a fixed job count, independent of list order
* `allAxisValues(axis)` expands an axis into a `require` list, so every value runs at least once
* Randomized pairwise coverage keeps CI job counts low while exploring more combinations
* `exclude(...)` forbids invalid combinations
* `imply(...)` models rules like `windows -> jdk 17`
* `constrain(...)` supports custom predicates across multiple axes
* `pairCoverageReport()` reports feasible pair coverage; run the example with `--coverage` to print it
* `setGitHubOutput(name, value)` (from `/github`) hands the matrix to a later job via `$GITHUB_OUTPUT`, with a random, multiline-safe delimiter
* `generateRow(...)` and `ensureAllAxisValuesCovered(...)` force individual rows imperatively, for the rare cases in [Forcing individual rows](#forcing-individual-rows)

Batch requirements
------------------

`generateRows(n, {require: [...]})` is the main way to drive the matrix. It guarantees a row for each required combination, then spends the rest of the `n`-row budget on pairwise coverage. The job count is `n`, and the result does not depend on the order of the list.

`requirePacking` controls how requirements share rows. The default, `'when-needed'`, merges two requirements into one row only when the budget is too tight to give each its own row, so required values pair with more varied partners. Set it to `'always'` to pack every compatible requirement as tightly as possible, which frees the most rows for pairwise coverage. Both modes keep the `n`-row budget and the per-requirement guarantee.

A `require` entry is either a filter or a `{filter, tag}` pair. `tag(row)` runs with the row that satisfies the requirement, so you can mark a job without searching the result again. For example, to collect code coverage on a single job pinned to a specific combination:

```js
const include = matrix.generateRows(Number(process.env.MATRIX_JOBS || 5), {
  require: [
    {filter: {os: 'ubuntu-latest', pg_version: '18', ssl: 'yes', scram: 'yes'},
     tag: row => { row.collectCoverage = true; }},
    {query_mode: 'simple'},
    ...matrix.allAxisValues('ssl'),
    ...matrix.allAxisValues('gss'),
  ],
});
```

The option is `require` (not `required`). The second argument accepts only `require` and `fill`; an unknown key such as `required` — or a `fill` filter that keys on something other than an axis name — is a common typo whose requirements would otherwise vanish silently, so `generateRows` warns about it. Call `failOnUnsatisfiableFilters(true)` to turn that (and the warnings below) into an error.

When a requirement cannot fit the budget, or is unsatisfiable, `generateRows` warns. Call `failOnUnsatisfiableFilters(true)` to turn that into an error.

Forcing individual rows
-----------------------

Before batch requirements the matrix was driven one row at a time. These calls remain for the rare cases that still want them:

* `generateRow(filter)` adds a single row and returns it (or an existing match), so you can keep a handle and set fields on it. The `tag` callback above covers most of this; reach for `generateRow` for a one-off you inspect locally.
* `ensureAllAxisValuesCovered(axis)` is the imperative form of spreading `...matrix.allAxisValues(axis)` into a `require` list.

Prefer `generateRows({require})`. A sequence of imperative calls makes both the job count and the coverage depend on call order, because a row generated for an early filter may satisfy a later one by chance.

Sample integrations
-------------------

* [ ] logback: https://github.com/qos-ch/logback/pull/556
* [ ] Spock: https://github.com/spockframework/spock/pull/1415
* [ ] Reload4j: https://github.com/qos-ch/reload4j/pull/16
* [ ] JMeter: https://github.com/apache/jmeter/pull/693
* [ ] kSar: https://github.com/vlsi/ksar/pull/251
* [x] TestNG: https://github.com/cbeust/testng/pull/2584
* [x] pgjdbc: https://github.com/pgjdbc/pgjdbc/pull/2534

License
-------

Apache License 2.0
