// License: Apache-2.0
// Copyright Vladimir Sitnikov, 2021
// See https://github.com/vlsi/github-actions-random-matrix
import { appendFileSync } from 'fs';
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
