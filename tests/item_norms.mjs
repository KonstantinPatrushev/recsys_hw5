// Why do rarely rated movies top so many lists? Item-factor norm and training mean rating
// by number of training ratings, for the checkpoint saved in evidence/run_main.json.
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
const F = run.factors.rows[1][1], Q = run.factors.item;
const norm = id => Math.sqrt(Array.from({ length: F }, (_, f) => Q[id * F + f] ** 2).reduce((a, b) => a + b, 0));
const stats = new Map();
for (const r of split.train) {
    const s = stats.get(r.movieId) || { n: 0, sum: 0 };
    s.n++; s.sum += r.rating; stats.set(r.movieId, s);
}
const buckets = [[1, 5], [6, 20], [21, 100], [101, 1e9]];
const out = { byTrainRatings: buckets.map(([lo, hi]) => {
    const ids = movies.map(m => m.id).filter(id => { const n = stats.get(id)?.n || 0; return n >= lo && n <= hi; });
    const norms = ids.map(norm).sort((a, b) => a - b);
    return { trainRatings: hi > 1e8 ? `${lo}+` : `${lo}-${hi}`, movies: ids.length,
             medianNorm: +norms[Math.floor(norms.length / 2)].toFixed(3), meanNorm: +(norms.reduce((a, b) => a + b, 0) / norms.length).toFixed(3) };
}) };
out.neverInTrainMedianNorm = +movies.filter(m => !stats.has(m.id)).map(m => norm(m.id)).sort((a, b) => a - b)[35].toFixed(3);
out.recommendedExamples = ['Pather Panchali (1955)', 'Perfect Candidate, A (1996)', 'Maya Lin: A Strong Clear Vision (1994)', 'Aparajito (1956)', 'Kazaam (1996)', 'Gold Diggers: The Secret of Bear Mountain (1995)', 'Star Wars (1977)']
    .map(t => { const m = movies.find(x => x.title === t); const s = stats.get(m.id);
        return { title: t, trainRatings: s.n, trainMean: +(s.sum / s.n).toFixed(2), factorNorm: +norm(m.id).toFixed(3) }; });
writeFileSync(join(root, 'evidence', 'item_norms.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
