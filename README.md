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

// Run with --coverage to preview pair coverage without emitting a matrix.
if (process.argv.includes('--coverage')) {
  const coverage = matrix.pairCoverageReport();
  console.log(`Pair coverage: ${coverage.covered}/${coverage.total} (${coverage.percentage}%)`);
} else {
  console.log(include);
  // setGitHubOutput writes the matrix to $GITHUB_OUTPUT with a random, multiline-safe
  // delimiter, and no-ops outside GitHub Actions.
  setGitHubOutput('matrix', {include});
}
```

A complete, runnable example with weighted axes and derived fields is in [`examples/matrix.mjs`](examples/matrix.mjs). The current `pgjdbc` usage is in [`.github/workflows/matrix.mjs`](https://github.com/pgjdbc/pgjdbc/blob/master/.github/workflows/matrix.mjs).

Workflow example:

```yaml
on:
  pull_request:
  push:
    branches: [main]
  # Replay the matrix of an earlier run by pasting its seed here.
  workflow_dispatch:
    inputs:
      matrix_rng_seed:
        description: RNG seed
        required: false

jobs:
  matrix_prep:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    env:
      MATRIX_JOBS: 7
      # Seed the RNG from the pull request number, so every push to the same pull
      # request draws the same rows. See "Reproducibility" below.
      GITHUB_PR_NUMBER: ${{ github.event.number }}
      RNG_SEED: ${{ github.event.inputs.matrix_rng_seed }}
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

Reproducibility
---------------

`createGitHubMatrixBuilder()` takes its seed from `RNG_SEED`, then from `GITHUB_PR_NUMBER` (as `pr_<number>`), and falls back to the clock plus random bytes. It prints the seed to the job log and appends it to `$GITHUB_STEP_SUMMARY`, so every run records how to reproduce itself.

Wire both variables, as the workflow above does. Without them every run draws a fresh seed, and that costs more than reproducibility alone:

* A failure that lands on an exotic row disappears on the next push to the same pull request, because the next run draws different rows. Nobody can tell whether the fix worked or the combination simply did not come up again.
* Re-running only the failed jobs keeps the rows, since the matrix job already succeeded and GitHub reuses its output. Re-running all jobs draws a new matrix unless the seed is pinned.
* With the seed from the step summary, `RNG_SEED=pr_1234 node .github/workflows/matrix.mjs` prints the same rows locally, so an exotic combination can be debugged outside CI.

A randomized matrix also turns each failure into a one-shot event, so keep the evidence: upload test reports and logs with `if: failure()`. GitHub rejects `":<>|*?\/` in artifact names, so strip them from `matrix.name` before using it as one.

Choosing axes
-------------

An axis earns its place when varying it can change the outcome of the code under test. Start from the failures you already had: a bug that turned out to depend on the environment, on a configuration option, or on the order the runtime happened to pick is a bug an axis keeps testing for forever.

Four groups cover most projects:

* **The environment.** Operating system, runtime version, runtime vendor, locale, timezone, file encoding. Turkish is the locale that finds a case conversion written without an explicit locale, because `I` lowercases to a dotless `ı`.
* **Runtime flags that expose hidden assumptions.** On the JVM, `-XX:+UnlockExperimentalVMOptions -XX:hashCode=2` makes every identity hash code the constant 1, so a `HashMap` keyed on objects that inherit `Object.hashCode` degenerates to insertion order and code that relied on the old order gives a different answer. `-ea` turns on the assertions in your code and in the libraries you compile against, and it costs only the jobs that carry it. `-XX:ActiveProcessorCount=1` shrinks every pool the runtime sizes from the CPU count. Other runtimes have their own knobs: `GOMAXPROCS`, `PYTHONHASHSEED`, a debug allocator.
* **Your own configuration.** Every option your users can set is a dimension you ship and rarely test in combination: feature flags, compilation and optimization modes, protocol versions, cache modes, timeouts, storage backends. pgjdbc puts a dozen connection properties on axes for this reason: query mode, autosave, SSL, SCRAM, batch rewriting, fetch behavior. Each one is a supported configuration that somebody runs in production.
* **The versions of what you talk to.** The database, the broker, the browser, or the compiler you are a plugin for.

Two rules keep the axes honest.

**An axis has to reach the code under test.** An axis that changes the environment of the build tool but not of the tests buys nothing, and it fails silently: the job names list four runtime vendors, and all four ran the same bytes. Check where the value lands: the process that runs the tests, not the process that launches it. On the JVM this is the usual trap, because a toolchain pins the test JVM independently of `JAVA_HOME`.

**Weight the value your users run.** `weight` is the importance of an uncovered pair, so it leans the coverage fill toward a value rather than fixing how often that value appears. Give the common value the larger weight and the exotic one a small one, as the `hash` axis in the example does, and read [Job count and cost](#job-count-and-cost) for how far that goes. The requirement list, not the weight, is what guarantees the rare value appears at all.

Ruling out combinations that do not exist
-----------------------------------------

Axes multiply, and some of the products are not jobs. SCRAM authentication needs PostgreSQL 10, so a row pairing `scram=yes` with `pg_version=9.1` is not a test that fails — it is a job that cannot start, and it costs a row out of the budget either way.

State the rule the way you know it. `imply(antecedent, consequent)` reads in the order you would say it out loud:

```js
// SCRAM needs PostgreSQL 10 or later.
matrix.imply({scram: 'yes'}, {pg_version: v => Number(v) >= 10});
// Microsoft publishes Java 11 and up.
matrix.imply({java_distribution: 'microsoft'}, {java_version: v => Number(v) >= 11});
```

`exclude(filter)` says the same thing inside out: every row matching this filter is forbidden. Reach for it when what you know really is a prohibition with no positive form, such as a limit of the action that provisions the service.

```js
// The action that installs PostgreSQL on Windows and macOS supports 14 and later.
matrix.exclude({os: ['windows-latest', 'macos-latest'], pg_version: v => Number(v) < 14});
```

Both compile to a predicate over the axes they name, so most rules can be written either way, and `imply` is the one to reach for first: a requirement stated as a requirement survives being read a year later. `constrain(axisNames, predicate)` covers what neither reaches, because an object filter matches each axis on its own — a rule that compares two axes to each other has to be a predicate.

Two things to know before you write one.

**A filter matches the axis value as declared.** An axis whose values are objects needs `{scram: {value: 'yes'}}`, not `{scram: 'yes'}` — the string form matches nothing, and a rule that matches nothing constrains nothing. Nothing reports that, and what happens next depends on where the filter sits. An `exclude()` filter, or an `imply()` antecedent, that matches nothing compiles to a predicate that never rejects a row, so the rule is a no-op. An `imply()` consequent that matches nothing rejects every row its antecedent admits, so `imply({os: 'linux'}, {scram: 'yes'})` against an object-valued `scram` axis takes Linux out of the matrix. `failOnUnsatisfiableFilters(true)` sees neither, since it reports requirements that cannot be met rather than rules that misfire. Generate the rows and check both directions: the combination you forbade is absent, and the values you still expect are present.

**Keep a rule down to the two axes it needs.** A constraint naming two axes also drops those pairs from the pairwise targets, so `pairCoverageReport()` counts only pairs a row could carry. One naming three or more does not, and the report then measures coverage of pairs that no row can reach.

Job count and cost
------------------

`MATRIX_JOBS` is the budget for the rows `generateRows` creates: it adds none beyond that count, whatever the requirement list asks for. Rows pinned earlier with `generateRow()` count against the budget and are not removed by it, so a script that pins more of them by hand than the budget allows gets all of them back. Requirements come first, and only the rows left over go to pairwise coverage. When the budget is tight, `generateRows` packs several requirements into one row rather than dropping them, which pins the required values to each other; when even that does not fit, it reports what it dropped. Preview both numbers before you push:

```bash
MATRIX_JOBS=7 node .github/workflows/matrix.mjs
```

```bash
MATRIX_JOBS=7 node .github/workflows/matrix.mjs --coverage
```

Cost is not uniform across a row. On private repositories GitHub bills Windows minutes at twice the Linux rate and macOS at ten times, and both are slower per job on top of that. `...matrix.allAxisValues('os')` guarantees one job per operating system, and `weight` leans the remaining rows toward the cheap one.

`weight` saturates, so budget for a lean rather than a ratio. Count the rows one value takes across sixty seeds of the shipped example:

```bash
for s in $(seq 1 60); do RNG_SEED=$s MATRIX_JOBS=5 node examples/matrix.mjs; done | grep -c "os: 'ubuntu-latest'"
```

At the example's `weight: 4` that prints 175 of the 300 rows. Set the weight to `1` and it prints 97; to `40`, 180; to `1000`, 180 again. Most of the shift arrives by a ratio of about `4`, and none of it approaches the ratio itself, because the value is the importance of an uncovered pair and not a sampling rate. Windows and macOS keep about 40% of the rows either way, and your own axes will give their own figures. Where a lean is not enough, take the value off the axis, as pgjdbc does with macOS, or confine it with `imply()`.

Caching
-------

A randomized matrix changes the cache key of any action that hashes the matrix into it, so a cache that worked under a fixed matrix quietly stops hitting.

`gradle/actions/setup-gradle` is the clearest case. Its Gradle User Home key is `${cache-protocol}-gradle|${runner-os}|${job-id}[${hash-of-job-matrix-and-workflow-name}]-${git-sha}`, and its restore keys try that same matrix hash first, then fall back to a match on the operating system and the job alone. With random rows the matrix-level entry never matches, so every job restores an entry saved for some other combination, and every run writes a new entry into the repository's 10 GB cache budget and evicts older ones.

Give the cache a key you choose rather than one derived from the whole row. Key it on the one or two axes that change what the cache holds, usually the runtime version, so the entries collapse into a handful of stable buckets. pgjdbc does this with `job-id: jdk${{ matrix.java_version }}` on `burrunan/gradle-cache-action`; with `actions/cache` the same job belongs to `key` and `restore-keys`. Writing the cache only from the default branch is the other half of the fix.

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

Since 2.5.0, a tagged requirement is fatal when it cannot be satisfied: `generateRows` throws for it whether or not `failOnUnsatisfiableFilters(true)` is set. The tag marks a row that a later job keys on, so dropping it would leave a matrix that looks complete while the job it marks never runs. The budget reserves a row for each open tagged requirement, so a budget too tight for everything drops an untagged requirement rather than one of these. Give it at least one row per tagged requirement: below that the tagged ones have to share, and rows are packed greedily, so a tight budget can strand one even where a packing exists. An untagged requirement still warns by default.

Pin everything on the tagged row that moves the number it produces. A coverage job whose locale or feature flags are left to the random fill reports a different figure on every run, and that noise lands on the coverage baseline rather than on the pull request that caused it.

The option is `require` (not `required`). The second argument accepts only `require` and `fill`; an unknown key such as `required` — or a `fill` filter that keys on something other than an axis name — is a common typo whose requirements would otherwise vanish silently, so `generateRows` warns about it. Call `failOnUnsatisfiableFilters(true)` to turn that (and the warnings below) into an error.

When an untagged requirement cannot fit the budget, or is unsatisfiable, `generateRows` warns. Call `failOnUnsatisfiableFilters(true)` to turn that into an error. A tagged one throws either way, as above.

Forcing individual rows
-----------------------

Before batch requirements the matrix was driven one row at a time. These calls remain for the rare cases that still want them:

* `generateRow(filter)` adds a single row and returns it (or an existing match), so you can keep a handle and set fields on it. The `tag` callback above covers most of this; reach for `generateRow` for a one-off you inspect locally.
* `ensureAllAxisValuesCovered(axis)` is the imperative form of spreading `...matrix.allAxisValues(axis)` into a `require` list.

Prefer `generateRows({require})`. A sequence of imperative calls makes both the job count and the coverage depend on call order, because a row generated for an early filter may satisfy a later one by chance.

Integration checklist
---------------------

* `GITHUB_PR_NUMBER` and `RNG_SEED` reach the matrix job, and the workflow takes a seed through `workflow_dispatch`.
* `MATRIX_JOBS` is set, and `--coverage` says the budget buys the coverage you expected.
* Weights match what each value costs and how many of your users run it.
* `exclude()` and `imply()` rule out combinations that do not exist, such as a runtime version a vendor never published for that operating system.
* Every axis reaches the process under test, not only the process that launches it.
* The cache key is one you control, not one derived from the random row.
* `strategy.fail-fast` is `false`, so one exotic failure does not cancel the rest of the evidence.
* Each metric-producing `tag` sits on exactly one row, and everything that moves the metric is pinned on that row.
* Failing jobs upload their reports, under an artifact name stripped of the characters GitHub rejects.
* `failOnUnsatisfiableFilters(true)` is on, unless you comment axis values out to run a subset locally.

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
