// License: Apache-2.0
// Copyright Vladimir Sitnikov, 2021
// See https://github.com/vlsi/github-actions-random-matrix

function pairKey(ai, vi, aj, vj) {
  return `${ai}:${vi}|${aj}:${vj}`;
}

class Axis {
  constructor({name, title, values}) {
    this.name = name;
    this.title = title;
    this.values = values;
    // Precompute normalized weights for pair scoring.
    // Each value's weight is normalized so that the axis weights sum to 1.
    const totalWeight = values.reduce((a, b) => a + (b.weight || 1), 0);
    this.normalizedWeights = values.map(v => (v.weight || 1) / totalWeight);
    // Map from value reference to its index for O(1) lookup
    this.valueIndex = new Map(values.map((v, i) => [v, i]));
  }

  static matches(row, filter) {
    if (typeof filter === 'function') {
      return filter(row);
    }
    if (Array.isArray(filter)) {
      // e.g. row={os: 'windows'}; filter=[{os: 'linux'}, {os: 'linux'}]
      return filter.some(v => Axis.matches(row, v));
    }
    if (typeof filter === 'object') {
      // e.g. row={jdk: {name: 'openjdk', version: 8}}; filter={jdk: {version: 8}}
      for (const [key, value] of Object.entries(filter)) {
        if (!row.hasOwnProperty(key) || !Axis.matches(row[key], value)) {
          return false;
        }
      }
      return true;
    }
    return row === filter;
  }

  pickValue(filter, random = Math.random) {
    let values = this.values;
    if (filter) {
      values = values.filter(v => Axis.matches(v, filter));
    }
    if (values.length === 0) {
      const filterStr = typeof filter === 'string' ? filter.toString() : JSON.stringify(filter);
      throw Error(`No values produced for axis '${this.name}' from ${JSON.stringify(this.values)}, filter=${filterStr}`);
    }
    return values[Math.floor(random() * values.length)];
  }
}

class MatrixBuilder {
  /**
   * @param {object} [options]
   * @param {function} [options.random] random number generator returning [0, 1), defaults to Math.random
   */
  constructor({random = Math.random} = {}) {
    this._random = random;
    this.axes = [];
    this.axisByName = {};
    this.rows = [];
    this.duplicates = {};
    this.constraints = [];
    this._failOnUnsatisfiableFilters = false;
    this._pairsInitialized = false;
    this._uncoveredPairs = null;
    this._totalPairs = 0;
    this._totalPairsWeight = 0;
    this._uncoveredPairsWeight = 0;
  }

  /**
   * Adds a constraint on a set of axes.
   * The predicate receives axis values in the same order as axisNames
   * and returns true if the combination is allowed.
   * @param {string[]} axisNames
   * @param {function} predicate
   */
  constrain(axisNames, predicate) {
    this.constraints.push({axisNames, predicate});
  }

  /**
   * Specifies exclude filter (e.g. exclude a forbidden combination).
   * The filter must be an object with keys matching axis names.
   * @param filter object filter (functions are not supported, use constrain() instead)
   */
  exclude(filter) {
    if (typeof filter === 'function') {
      throw new Error('Function excludes are not supported, use constrain() instead');
    }
    const axisNames = Object.keys(filter);
    this.constrain(axisNames, (...values) => {
      const partial = Object.fromEntries(axisNames.map((name, i) => [name, values[i]]));
      return !Axis.matches(partial, filter);
    });
  }

  /**
   * Adds implication like `antecedent -> consequent`.
   * In other words, if `antecedent` holds, then `consequent` must also hold.
   * @param antecedent object filter
   * @param consequent object filter
   */
  imply(antecedent, consequent) {
    const axisNames = [...new Set([
      ...Object.keys(antecedent),
      ...Object.keys(consequent),
    ])];
    this.constrain(axisNames, (...values) => {
      const partial = Object.fromEntries(axisNames.map((name, i) => [name, values[i]]));
      return !Axis.matches(partial, antecedent)
          || Axis.matches(partial, consequent);
    });
  }

  addAxis({name, title, values}) {
    const axis = new Axis({name, title, values});
    this.axes.push(axis);
    this.axisByName[name] = axis;
    return axis;
  }

  setNamePattern(names) {
    this.namePattern = names;
  }

  /**
   * Returns true if the row satisfies all constraints.
   * @param row input row
   * @returns {boolean}
   */
  matches(row) {
    return this.constraints.every(({axisNames, predicate}) => {
      const values = axisNames.map(name => row[name]);
      return predicate(...values);
    });
  }

  failOnUnsatisfiableFilters(value) {
    this._failOnUnsatisfiableFilters = value;
  }

  /**
   * Returns constraints whose scope is a subset of the given axis names.
   * These constraints can be fully evaluated on a partial row containing only those axes.
   */
  _constraintsForAxes(axisNameSet) {
    return this.constraints.filter(({axisNames}) =>
      axisNames.every(name => axisNameSet.has(name))
    );
  }

  /**
   * Checks if a partial row (subset of axes) satisfies all constraints
   * whose scope is within the given axes.
   */
  _checkPartial(partial, relevantConstraints) {
    return relevantConstraints.every(({axisNames, predicate}) => {
      const values = axisNames.map(name => partial[name]);
      return predicate(...values);
    });
  }

  /**
   * Initializes the set of all feasible value pairs to cover.
   * Pairs that violate constraints are excluded upfront.
   * Called lazily on first generateRow call (after all axes and constraints are configured).
   */
  _initPairs() {
    if (this._pairsInitialized) return;
    this._pairsInitialized = true;
    this._uncoveredPairs = new Set();
    let totalWeight = 0;
    for (let i = 0; i < this.axes.length; i++) {
      for (let j = i + 1; j < this.axes.length; j++) {
        const axisNameSet = new Set([this.axes[i].name, this.axes[j].name]);
        const relevant = this._constraintsForAxes(axisNameSet);
        for (let vi = 0; vi < this.axes[i].values.length; vi++) {
          const wi = this.axes[i].normalizedWeights[vi];
          for (let vj = 0; vj < this.axes[j].values.length; vj++) {
            const partial = {
              [this.axes[i].name]: this.axes[i].values[vi],
              [this.axes[j].name]: this.axes[j].values[vj],
            };
            if (!this._checkPartial(partial, relevant)) continue;
            this._uncoveredPairs.add(pairKey(i, vi, j, vj));
            totalWeight += wi * this.axes[j].normalizedWeights[vj];
          }
        }
      }
    }
    this._totalPairs = this._uncoveredPairs.size;
    this._totalPairsWeight = totalWeight;
    this._uncoveredPairsWeight = totalWeight;
  }

  /**
   * Scores a candidate row by the weighted sum of uncovered pairs it would cover.
   * Each pair's contribution is normalizedWeight_i * normalizedWeight_j,
   * so axes with different weight scales contribute fairly.
   */
  _scoreNewPairs(row) {
    let score = 0;
    for (let i = 0; i < this.axes.length; i++) {
      const axisI = this.axes[i];
      const vi = axisI.valueIndex.get(row[axisI.name]);
      const wi = axisI.normalizedWeights[vi];
      for (let j = i + 1; j < this.axes.length; j++) {
        const axisJ = this.axes[j];
        const vj = axisJ.valueIndex.get(row[axisJ.name]);
        if (this._uncoveredPairs.has(pairKey(i, vi, j, vj))) {
          score += wi * axisJ.normalizedWeights[vj];
        }
      }
    }
    return score;
  }

  /**
   * Marks all pairs in a row as covered.
   */
  _markCovered(row) {
    let weight = 0;
    for (let i = 0; i < this.axes.length; i++) {
      const vi = this.axes[i].valueIndex.get(row[this.axes[i].name]);
      const wi = this.axes[i].normalizedWeights[vi];
      for (let j = i + 1; j < this.axes.length; j++) {
        const vj = this.axes[j].valueIndex.get(row[this.axes[j].name]);
        if (this._uncoveredPairs.delete(pairKey(i, vi, j, vj))) {
          weight += wi * this.axes[j].normalizedWeights[vj];
        }
      }
    }
    this._uncoveredPairsWeight -= weight;
  }

  /**
   * Generates a single valid candidate row matching the optional filter.
   * Returns null if no valid candidate can be produced after several attempts.
   */
  _generateCandidate(filter) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const row = this.axes.reduce(
        (prev, next) =>
          Object.assign(prev, {
            [next.name]: next.pickValue(filter ? filter[next.name] : undefined, this._random)
          }),
        {}
      );
      if (this.matches(row)) {
        return row;
      }
    }
    return null;
  }

  /**
   * Computes the display name for a row based on the name pattern.
   */
  _computeName(row) {
    return this.namePattern.map(axisName => {
      let value = row[axisName];
      const title = value.title;
      if (typeof title != 'undefined') {
        return title;
      }
      const computeTitle = this.axisByName[axisName].title;
      if (computeTitle) {
        return computeTitle(value);
      }
      if (typeof value === 'object' && value.hasOwnProperty('value')) {
        return value.value;
      }
      return value;
    }).filter(Boolean).join(", ");
  }

  /**
   * Adds a row that matches the given filter to the resulting matrix.
   * Among many random candidates satisfying the filter, picks the one
   * that covers the most previously-uncovered parameter pairs.
   *
   * filter values could be
   *  - literal values: filter={os: 'windows-latest'}
   *  - arrays: filter={os: ['windows-latest', 'linux-latest']}
   *  - functions: filter={os: x => x!='windows-latest'}
   * @param filter object with keys matching axes names
   * @returns {*}
   */
  generateRow(filter, {warnOnFailure = true} = {}) {
    this._initPairs();
    if (filter) {
      // If matching row already exists, no need to generate more
      const existing = this.rows.find(v => Axis.matches(v, filter));
      if (existing) {
        return existing;
      }
    }

    const numCandidates = 1000;
    let bestRow = null;
    let bestScore = -1;

    for (let n = 0; n < numCandidates; n++) {
      const candidate = this._generateCandidate(filter);
      if (!candidate) {
        continue;
      }

      const key = JSON.stringify(candidate);
      if (this.duplicates.hasOwnProperty(key)) continue;

      const score = this._scoreNewPairs(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestRow = candidate;
      }
    }

    if (bestRow) {
      const key = JSON.stringify(bestRow);
      this.duplicates[key] = true;
      bestRow.name = this._computeName(bestRow);
      this._markCovered(bestRow);
      this.rows.push(bestRow);
      return bestRow;
    }

    const filterStr = typeof filter === 'string' ? filter.toString() : JSON.stringify(filter);
    const msg = `Unable to generate row for ${filterStr}. Please check include and exclude filters`;
    if (this._failOnUnsatisfiableFilters) {
      throw Error(msg);
    } else if (warnOnFailure) {
      console.warn(msg);
    }
  }

  ensureAllAxisValuesCovered(axisName) {
    for (let value of this.axisByName[axisName].values) {
      this.generateRow({[axisName]: value});
    }
  }

  generateRows(maxRows, filter) {
    this._initPairs();
    for (let i = 0; this.rows.length < maxRows && i < maxRows; i++) {
      const row = this.generateRow(filter, {warnOnFailure: false});
      if (!row) {
        break;
      }
    }
    return this.rows;
  }

  /**
   * Returns pair coverage statistics for the generated rows.
   * @returns {{covered: number, total: number, percentage: string, weightPercentage: string}}
   */
  pairCoverageReport() {
    this._initPairs();
    const covered = this._totalPairs - this._uncoveredPairs.size;
    const coveredWeight = this._totalPairsWeight - this._uncoveredPairsWeight;
    return {
      covered,
      total: this._totalPairs,
      percentage: (covered / this._totalPairs * 100).toFixed(1),
      weightPercentage: (coveredWeight / this._totalPairsWeight * 100).toFixed(1)
    };
  }

  /**
   * Computes the number of all the possible combinations.
   * @returns {{bad: number, good: number}}
   */
  summary() {
    if (this.axes.length === 0) {
      return {good: 0, bad: 0};
    }

    const row = {};
    let good = 0;
    let bad = 0;

    const visit = axisIndex => {
      if (axisIndex === this.axes.length) {
        if (this.matches(row)) {
          good++;
        } else {
          bad++;
        }
        return;
      }

      const axis = this.axes[axisIndex];
      for (const value of axis.values) {
        row[axis.name] = value;
        visit(axisIndex + 1);
      }
    };

    visit(0);
    return {good, bad};
  }
}

export { Axis, MatrixBuilder };
