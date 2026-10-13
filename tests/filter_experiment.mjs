// One-variable experiment on the saved checkpoint (no retraining): Recall@10 when the Top-10 may
// only contain movies with at least `minRatings` training ratings, next to a most-popular list.
// Same definitions as recallAtK: relevant = test ratings >= 4 on movies seen in training;
// movies rated in train or validation are excluded from a user's list.
import vm from 'vm';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = JSON.parse(readFileSync(join(root, 'evidence', 'run_main.json'), 'utf8'));
const ctx = vm.createContext({ console, fetch: async (p) => ({ ok: true, text: async () => readFileSync(join(root, p), 'latin1') }) });
vm.runInContext(readFileSync(join(root, 'data.js'), 'utf8'), ctx);
await vm.runInContext('loadData()', ctx);
const { movies, split } = vm.runInContext('({ movies, split: splitByTimestamp() })', ctx);
const { train, val, test } = split;
const F = run.factors.rows[0][1], P = run.factors.user, Q = run.factors.item, mu = run.factors.globalMean;
const score = (u, i) => { let s = mu; for (let f = 0; f < F; f++) s += P[u * F + f] * Q[i * F + f]; return s; };

const count = new Map();
for (const r of train) count.set(r.movieId, (count.get(r.movieId) || 0) + 1);
const rated = new Map();
for (const r of train.concat(val)) { if (!rated.has(r.userId)) rated.set(r.userId, new Set()); rated.get(r.userId).add(r.movieId); }
const relevant = new Map();
for (const r of test) if (r.rating >= 4 && count.has(r.movieId)) {
    if (!relevant.has(r.userId)) relevant.set(r.userId, new Set());
    relevant.get(r.userId).add(r.movieId);
}

function evaluate(name, rank) {
    let sum = 0, rare = 0, n = 0;
    const distinct = new Set();
    for (const [u, rel] of relevant) {
        const list = rank(u);
        sum += list.filter(id => rel.has(id)).length / rel.size;
        for (const id of list) { distinct.add(id); n++; if ((count.get(id) || 0) < 20) rare++; }
    }
    return { variant: name, recallAt10: +(sum / relevant.size).toFixed(4), distinctMovies: distinct.size, shareUnder20Ratings: +(rare / n).toFixed(3) };
}
const mfRank = (min) => (u) => movies.filter(m => !rated.get(u).has(m.id) && (count.get(m.id) || 0) >= min)
    .map(m => [score(u, m.id), m.id]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 10).map(x => x[1]);
const byPopularity = movies.map(m => m.id).sort((a, b) => (count.get(b) || 0) - (count.get(a) || 0) || a - b);
const popRank = (u) => byPopularity.filter(id => !rated.get(u).has(id)).slice(0, 10);

const rows = [1, 5, 20, 50].map(min => evaluate(min === 1 ? 'MF, all training movies (page)' : `MF, movies with >= ${min} training ratings`, mfRank(min)));
rows.push(evaluate('most popular in training (not MF)', popRank));
writeFileSync(join(root, 'evidence', 'filter_experiment.json'), JSON.stringify({ users: relevant.size, rows }, null, 1));
console.table(rows);
