// License: CC-0 (public domain)
// Feel free to adjust as you see fit

// Here's the PR that uses the matrix: https://github.com/cbeust/testng/pull/2584
// Bonus point: it includes bugfixes identified with the improved matrix

// Here we create the matrix builder:
let {MatrixBuilder} = require('./matrix_builder');
const matrix = new MatrixBuilder();

// jdk axis defines Java distribution to use in the CI
matrix.addAxis({
  name: 'jdk',
  // job name should be coincise, and this function produces the name part that describes jdk value
  title: x => x.version + ', ' + x.group,
  // The values are just an array. They can be written as literals or computed on the fly
  values: [
    // Zulu
    {group: 'Zulu', version: '8', distribution: 'zulu'},
    {group: 'Zulu', version: '11', distribution: 'zulu'},
    {group: 'Zulu', version: '16', distribution: 'zulu'},

    // Adopt
    {group: 'Adopt Hotspot', version: '8', distribution: 'adopt-hotspot'},
    {group: 'Adopt Hotspot', version: '11', distribution: 'adopt-hotspot'},

    // Adopt OpenJ9
    // TODO: Replace these hard coded versions with something that dynamically picks the most recent
    {group: 'Adopt OpenJ9', version: '8', distribution: 'adopt-openj9'},
    {group: 'Adopt OpenJ9', version: '11', distribution: 'adopt-openj9'},

    // Amazon Corretto
    {
      group: 'Corretto',
      version: '8',
      distribution: 'jdkfile',
      url: 'https://corretto.aws/downloads/latest/amazon-corretto-8-x64-linux-jdk.tar.gz'
    },
    {
      group: 'Corretto',
      version: '11',
      distribution: 'jdkfile',
      url: 'https://corretto.aws/downloads/latest/amazon-corretto-11-x64-linux-jdk.tar.gz'
    },
  ]
});
// Timezone is trival to add, and it might uncover funny bugs. Let's add it
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
  // Let's remove -latest part from the job name
  title: x => x.replace('-latest', ''),
  values: [
    'ubuntu-latest',
    'windows-latest',
    'macos-latest'
  ]
});
// This is to verify Java code behavior when Object#hashCode returns the same values
// It might uncover hidden assumptions like "object.toString is usually unique"
matrix.addAxis({
  name: 'hash',
  values: [
    // In most of the cases we want regular behavior, thus weight=42
    // Title is empty since the case is usual, and we don't want to clutter CI job name with "regular hashcode"
    {value: 'regular', title: '', weight: 42},
    // On rare occasions we want to test with "same hashcode", so weight is significantly less here
    // This is unusual case, and we want to mark CI job with "same hashcode", so the failures are easier to analyze
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

// This specifices the order of axes in CI job name (individual titles would be joined with a comma)
matrix.setNamePattern(['jdk', 'hash', 'os', 'tz', 'locale']);

// TODO: figure out how "same hashcode" could be configured in OpenJ9
// -XX:hashCode=2 does not work for openj9, so we make sure matrix builder would never generate that combination
matrix.exclude({hash: {value: 'same'}, jdk: {distribution: 'adopt-openj9'}});
// For now, jdkfile distributions are for linux only, so we exclude jdkfile+windows and jdkfile+macos combinations
matrix.exclude({jdk: {distribution: 'jdkfile'}, os: ['windows-latest', 'macos-latest']});
// Ensure at least one job with "same" hashcode exists
matrix.generateRow({hash: {value: 'same'}});
// Ensure at least one windows and at least one linux job is present (macos is almost the same as linux)
matrix.generateRow({os: 'windows-latest'});
matrix.generateRow({os: 'ubuntu-latest'});
// Ensure there will be at least one job with Java 8
matrix.generateRow({jdk: {version: 8}});
const include = matrix.generateRows(process.env.MATRIX_JOBS || 5);
if (include.length === 0) {
  throw new Error('Matrix list is empty');
}
// Sort jobs by name, however, numeric parts are sorted approrpiately
// For instance, 'windows 8' would come before 'windows 11'
include.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
// Compute some of the resulting fields. For instance, here we generate "extra jvmargs" based on hash and locale axes
include.forEach(v => {
  let jvmArgs = [];
  if (v.hash.value === 'same') {
    jvmArgs.push('-XX:+UnlockExperimentalVMOptions', '-XX:hashCode=2');
  }
  // Gradle does not work in tr_TR locale, so pass locale to test only: https://github.com/gradle/gradle/issues/17361
  jvmArgs.push(`-Duser.country=${v.locale.country}`);
  jvmArgs.push(`-Duser.language=${v.locale.language}`);
  v.testExtraJvmArgs = jvmArgs.join(' ');
  delete v.hash;
});

console.log(include);
console.log('::set-output name=matrix::' + JSON.stringify({include}));
