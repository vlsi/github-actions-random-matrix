// License: CC-0 (public domain)
// Copy this file into your repository as .github/workflows/matrix.mjs and adjust the
// axes to fit your build. See the README for the matching workflow YAML.
//
// A project that consumes this generator: https://github.com/cbeust/testng/pull/2584

// createGitHubMatrixBuilder seeds the RNG so a run is reproducible: it derives the seed
// from the PR number (or RNG_SEED) and logs it to the job log and the step summary.
import { createGitHubMatrixBuilder, setGitHubOutput } from '@vlsi/github-actions-random-matrix/github';

const { matrix } = createGitHubMatrixBuilder();

// generateRows warns when a required combination is unsatisfiable or does not fit the
// budget, then drops it. Uncomment the next line to fail the run instead, which catches
// impossible filters when you add or change axes.
// matrix.failOnUnsatisfiableFilters(true);

matrix.addAxis({
  name: 'java_distribution',
  values: [
    'zulu',
    'temurin',
    'liberica',
    'microsoft',
  ]
});

// TODO: support different JITs (see https://github.com/actions/setup-java/issues/279)
matrix.addAxis({name: 'jit', title: '', values: ['hotspot']});

matrix.addAxis({
  name: 'java_version',
  title: x => 'Java ' + x,
  // Strings allow versions like 18-ea
  values: [
    '8',
    '11',
    '17',
  ]
});

// Timezone is trivial to add, and it might uncover funny bugs, so let's add it.
matrix.addAxis({
  name: 'tz',
  values: [
    'America/New_York',
    // Chatham is UTC+12:45 vs UTC+13:45, so it might break quite a few assumptions :)
    'Pacific/Chatham',
    'UTC'
  ]
});

matrix.addAxis({
  name: 'os',
  // Drop the -latest suffix from the job name.
  title: x => (x.value || x).replace('-latest', ''),
  values: [
    // The require list below runs every OS at least once; these weights lean the
    // remaining rows toward ubuntu, by roughly the shift a ratio of 4 buys. Windows and
    // macOS minutes are billed at 2x and 10x of Linux on private repositories, and both
    // are slower per job. See "Job count and cost" in the README for what the lean is
    // worth, and drop a value from the axis where a lean is not enough.
    {value: 'ubuntu-latest', weight: 4},
    {value: 'windows-latest', weight: 1},
    {value: 'macos-latest', weight: 1}
  ]
});

// Run some jobs with assertions on. -ea enables the asserts in your own code and in the
// libraries you compile against, and it costs only the jobs that carry it.
matrix.addAxis({
  name: 'assertions',
  title: x => x.value === 'yes' ? 'assertions' : '',
  values: [
    {value: 'yes', weight: 3},
    {value: 'no', weight: 10}
  ]
});

// Your own configuration belongs on axes too. Every option your users can set — feature
// flags, compilation modes, protocol versions, cache modes, timeouts — is a dimension you
// ship and rarely test in combination. See "Choosing axes" in the README.

// Test Java code when Object#hashCode returns the same value for different objects.
// This can uncover hidden assumptions such as "object.toString is usually unique".
matrix.addAxis({
  name: 'hash',
  values: [
    // The regular case is the common one, so give it the larger weight. Weight leans the
    // fill toward a value rather than fixing a rate, and most of the lean arrives by a
    // ratio of about 4; on these axes 42 buys a few points more. An empty title keeps the
    // usual case out of the job name.
    {value: 'regular', title: '', weight: 42},
    // The same-hashcode case is rare. Its title marks the job so a failure is easier to
    // spot; the require list below, not the weight, is what guarantees it appears.
    {value: 'same', title: 'same hashcode', weight: 1}
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

// Order the axis titles in the job name. Individual titles join with a comma.
matrix.setNamePattern(['java_version', 'java_distribution', 'hash', 'assertions', 'os', 'tz', 'locale']);

// Microsoft Java has no distribution for 8.
matrix.exclude({java_distribution: 'microsoft', java_version: '8'});

const javaValues = matrix.axisByName.java_version.values;

// generateRows is the single entry point. It guarantees a row for every required
// combination, packs them into as few rows as possible, and spends the rest of the
// budget on pairwise coverage. The job count is MATRIX_JOBS, regardless of list order.
const include = matrix.generateRows(Number(process.env.MATRIX_JOBS || 5), {
  require: [
    // Keep at least one same-hashcode job.
    {hash: {value: 'same'}},
    // Keep at least one job with assertions on.
    {assertions: {value: 'yes'}},
    // Run every OS at least once.
    ...matrix.allAxisValues('os'),
    // Cover the oldest and newest supported Java.
    {java_version: javaValues[0]},
    {java_version: javaValues[javaValues.length - 1]},
  ],
});
if (include.length === 0) {
  throw new Error('Matrix list is empty');
}

// Sort by name, treating numeric parts naturally so "windows 8" comes before "windows 11".
include.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));

// Derive extra fields from the chosen axes. Here we build the JVM args for each job.
include.forEach(v => {
  const jvmArgs = [];
  if (v.hash.value === 'same') {
    jvmArgs.push('-XX:+UnlockExperimentalVMOptions', '-XX:hashCode=2');
  }
  if (v.assertions.value === 'yes') {
    jvmArgs.push('-ea');
  }
  // Gradle does not work in the tr_TR locale, so pass the locale to the tests only:
  // https://github.com/gradle/gradle/issues/17361
  jvmArgs.push(`-Duser.country=${v.locale.country}`);
  jvmArgs.push(`-Duser.language=${v.locale.language}`);
  v.testExtraJvmArgs = jvmArgs.join(' ');
  // runs-on takes the plain string, and the axis objects have served their purpose.
  v.os = v.os.value;
  delete v.hash;
  delete v.assertions;
});

// Run with --coverage to preview pair coverage and tune MATRIX_JOBS without emitting
// the matrix:  node .github/workflows/matrix.mjs --coverage
if (process.argv.includes('--coverage')) {
  const coverage = matrix.pairCoverageReport();
  console.log(`Pair coverage: ${coverage.covered}/${coverage.total} (${coverage.percentage}%), weighted ${coverage.weightPercentage}%`);
} else {
  // Print the matrix to the job log for debugging.
  console.log(include);
  // Hand the matrix to the next job. setGitHubOutput writes $GITHUB_OUTPUT with a random,
  // multiline-safe delimiter, and no-ops when the variable is unset (e.g. running locally).
  setGitHubOutput('matrix', {include});
}
