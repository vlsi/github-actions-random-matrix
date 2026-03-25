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
import { createGitHubMatrixBuilder } from '@vlsi/github-actions-random-matrix/github';

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
matrix.generateRow({os: 'windows-latest'});
matrix.generateRow({os: 'ubuntu-latest'});

const include = matrix.generateRows(Number(process.env.MATRIX_JOBS || 5));
if (include.length === 0) {
  throw new Error('Matrix list is empty');
}

include.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
console.log(JSON.stringify({include}));
```

The current `pgjdbc` usage is in [`.github/workflows/matrix.mjs`](https://github.com/pgjdbc/pgjdbc/blob/master/.github/workflows/matrix.mjs).

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
        shell: bash
        run: |
          matrix_json="$(node .github/workflows/matrix.mjs)"
          echo "matrix=$matrix_json" >> "$GITHUB_OUTPUT"

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

* Randomized pairwise coverage keeps CI job counts low while exploring more combinations
* `exclude(...)` forbids invalid combinations
* `imply(...)` models rules like `windows -> jdk 17`
* `constrain(...)` supports custom predicates across multiple axes
* `generateRow(...)` forces important rows to appear
* `ensureAllAxisValuesCovered(...)` guarantees each value of an axis appears at least once
* `pairCoverageReport()` reports feasible pair coverage

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
