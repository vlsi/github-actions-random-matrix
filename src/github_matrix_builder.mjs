// License: Apache-2.0
// Copyright Vladimir Sitnikov, 2021
// See https://github.com/vlsi/github-actions-random-matrix
import { appendFileSync } from 'fs';
import { EOL } from 'os';
import { randomBytes } from 'crypto';
import { createRequire } from 'module';
import { MatrixBuilder, Axis } from './matrix_builder.mjs';

const require = createRequire(import.meta.url);
const seedrandom = require('./seedrandom.cjs');

export { MatrixBuilder, Axis };

function defaultSeedText() {
  const { RNG_SEED } = process.env;
  if (RNG_SEED) {
    return RNG_SEED;
  }
  const { GITHUB_PR_NUMBER } = process.env;
  if (GITHUB_PR_NUMBER) {
    return 'pr_' + GITHUB_PR_NUMBER;
  }
  return 'seed_' + Date.now() + '_' + randomBytes(16).toString('hex');
}

/**
 * Creates a MatrixBuilder pre-configured with a seedable RNG suitable for GitHub Actions.
 *
 * The seed is determined by (in priority order):
 * 1. The `seed` option passed to this function
 * 2. The RNG_SEED environment variable
 * 3. The GITHUB_PR_NUMBER environment variable (prefixed with 'pr_')
 * 4. A random seed based on current time and crypto random bytes
 *
 * The seed is logged to the GitHub Actions group log and step summary
 * for reproducibility.
 *
 * @param {object} [options]
 * @param {string} [options.seed] explicit seed value
 * @returns {{matrix: MatrixBuilder, random: function}} matrix builder and the random function
 */
export function createGitHubMatrixBuilder({seed} = {}) {
  const seedText = seed || defaultSeedText();
  const rng = new seedrandom(seedText);
  const random = () => rng();

  console.log('::group::RNG Seed');
  console.log('Initialized RNG with RNG_SEED = %s', seedText);
  console.log('::endgroup::');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '# Random Number Generator Seed',
      'To regenerate this matrix in a different build, run it with the following seed:',
      '',
      '    ' + seedText,
      '',
    ].join('\n'));
  }

  return {
    matrix: new MatrixBuilder({random}),
    random,
  };
}

/**
 * Writes a GitHub Actions step output, e.g. the generated matrix for a later job.
 *
 * The value is wrapped in a heredoc with a random delimiter, so a multiline or
 * untrusted value cannot break the file format or inject extra outputs. Objects are
 * JSON-encoded; strings are written verbatim.
 *
 * @param {string} name output name, e.g. 'matrix'
 * @param {*} value string, or any JSON-serializable value
 * @param {object} [options]
 * @param {string} [options.output] target file, defaults to the GITHUB_OUTPUT env var
 * @returns {boolean} true if written, false when no output target is set (e.g. running locally)
 */
export function setGitHubOutput(name, value, {output = process.env.GITHUB_OUTPUT} = {}) {
  if (!output) {
    return false;
  }
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const delimiter = 'ghadelimiter_' + randomBytes(16).toString('hex');
  appendFileSync(output, `${name}<<${delimiter}${EOL}${body}${EOL}${delimiter}${EOL}`, {
    encoding: 'utf8',
  });
  return true;
}
