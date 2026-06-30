import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitHubMatrixBuilder, setGitHubOutput, MatrixBuilder, Axis } from '../src/github_matrix_builder.mjs';

describe('createGitHubMatrixBuilder', () => {
  it('returns matrix and random', () => {
    const { matrix, random } = createGitHubMatrixBuilder({seed: 'test-seed'});
    assert.ok(matrix instanceof MatrixBuilder);
    assert.equal(typeof random, 'function');
    const val = random();
    assert.ok(val >= 0 && val < 1);
  });

  it('produces deterministic output with same seed', () => {
    const { matrix: m1 } = createGitHubMatrixBuilder({seed: 'fixed'});
    m1.addAxis({name: 'a', values: ['x', 'y', 'z']});
    m1.addAxis({name: 'b', values: ['1', '2', '3']});
    m1.setNamePattern(['a', 'b']);
    m1.generateRows(5);

    const { matrix: m2 } = createGitHubMatrixBuilder({seed: 'fixed'});
    m2.addAxis({name: 'a', values: ['x', 'y', 'z']});
    m2.addAxis({name: 'b', values: ['1', '2', '3']});
    m2.setNamePattern(['a', 'b']);
    m2.generateRows(5);

    for (let i = 0; i < m1.rows.length; i++) {
      assert.equal(m1.rows[i].a, m2.rows[i].a);
      assert.equal(m1.rows[i].b, m2.rows[i].b);
    }
  });

  it('re-exports Axis and MatrixBuilder', () => {
    assert.equal(typeof Axis.matches, 'function');
    assert.equal(typeof MatrixBuilder, 'function');
  });
});

describe('setGitHubOutput', () => {
  it('writes a heredoc block with a random delimiter for an object value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-out-'));
    try {
      const file = join(dir, 'output');
      const ok = setGitHubOutput('matrix', {include: [{a: 1}]}, {output: file});
      assert.equal(ok, true);
      const content = readFileSync(file, 'utf8');
      const match = content.match(/^matrix<<(ghadelimiter_[0-9a-f]+)\r?\n([\s\S]*?)\r?\n\1\r?\n$/);
      assert.ok(match, `unexpected output: ${content}`);
      assert.deepEqual(JSON.parse(match[2]), {include: [{a: 1}]});
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('writes string values verbatim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-out-'));
    try {
      const file = join(dir, 'output');
      setGitHubOutput('greeting', 'hello', {output: file});
      const content = readFileSync(file, 'utf8');
      const match = content.match(/^greeting<<(ghadelimiter_[0-9a-f]+)\r?\nhello\r?\n\1\r?\n$/);
      assert.ok(match, `unexpected output: ${content}`);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('returns false when no output target is set', () => {
    assert.equal(setGitHubOutput('matrix', {include: []}, {output: ''}), false);
  });
});
