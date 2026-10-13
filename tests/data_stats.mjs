// Dataset and split statistics for the report, computed with the page's own data.js
// (loadData + splitByTimestamp) — no TF.js needed.
import vm from 'vm';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console, fetch: async (p) => ({ ok: true, text: async () => readFileSync(join(root, p), 'latin1') }) });
vm.runInContext(readFileSync(join(root, 'data.js'), 'utf8'), ctx);
await vm.runInContext('loadData()', ctx);
const { movies, ratings, numUsers, split, excluded } = vm.runInContext(
    '({ movies, ratings, numUsers, split: splitByTimestamp(), excluded: SPLIT_EXCLUSIONS })', ctx);

const users = new Set(ratings.map(r => r.userId));
const pairs = new Set(ratings.map(r => r.userId + ':' + r.movieId));
const trainMovies = new Set(split.train.map(r => r.movieId));
const trainUsers = new Set(split.train.map(r => r.userId));
const notInTrain = (set) => set.filter(r => !trainMovies.has(r.movieId));
const relevantTest = split.test.filter(r => r.rating >= 4);
const stats = {
    users: users.size, movies: movies.length, ratings: ratings.length, maxUserId: numUsers,
    uniqueUserMoviePairs: pairs.size,
    density: +(ratings.length / (users.size * movies.length)).toFixed(6),
    sparsity: +(1 - ratings.length / (users.size * movies.length)).toFixed(6),
    split: { train: split.train.length, val: split.val.length, test: split.test.length, usersSkipped: excluded.length },
    usersAbsentFromTrain: [...users].filter(u => !trainUsers.has(u)).length,
    moviesInTrain: trainMovies.size,
    moviesNeverInTrain: movies.filter(m => !trainMovies.has(m.id)).length,
    valRatingsOnMoviesNotInTrain: notInTrain(split.val).length,
    testRatingsOnMoviesNotInTrain: notInTrain(split.test).length,
    relevantTestRatings: relevantTest.length,
    relevantTestRatingsNotInTrain: notInTrain(relevantTest).length,
    relevantTestMoviesNotInTrain: new Set(notInTrain(relevantTest).map(r => r.movieId)).size,
    usersWithRelevantTestCandidate: new Set(relevantTest.filter(r => trainMovies.has(r.movieId)).map(r => r.userId)).size,
    trainMean: +(split.train.reduce((s, r) => s + r.rating, 0) / split.train.length).toFixed(6)
};
writeFileSync(join(root, 'evidence', 'data_stats.json'), JSON.stringify(stats, null, 1));
console.log(JSON.stringify(stats, null, 1));
