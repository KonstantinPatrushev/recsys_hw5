// Independent re-computation and analysis, in plain JavaScript (no TF.js).
// Input: evidence/run_main.json, written by tests/run_in_browser.html after the page's own
// trainMF / selectBestCheckpoint / recommendTopK / recallAtK ran in Chrome; it contains the
// factor matrices of the selected checkpoint. The data and the split come from the page's data.js.
//   1. RMSE of the checkpoint on val/test and the mean baseline, recomputed from the factors
//   2. Recall@10 recomputed from scratch, and every user's Top-10 list compared with the page's
//   3. one prediction written out term by term (for the hand check in the report)
//   4. familiar vs. new: popularity, genre overlap, catalogue coverage; the two report users
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

const F = run.factors.rows[0][1];
const P = Float64Array.from(run.factors.user), Q = Float64Array.from(run.factors.item);
const mu = run.factors.globalMean;
const dot = (u, i) => { let s = 0; for (let f = 0; f < F; f++) s += P[u * F + f] * Q[i * F + f]; return s; };
const clamp = x => Math.min(5, Math.max(1, x));
const rmse = (rows, pred) => Math.sqrt(rows.reduce((s, r) => s + (pred(r) - r.rating) ** 2, 0) / rows.length);
const out = {};

// 1. RMSE
const trainMean = train.reduce((s, r) => s + r.rating, 0) / train.length;
out.rmse = {
    val: { recomputed: rmse(val, r => clamp(mu + dot(r.userId, r.movieId))), page: run.valRMSEAtSelected },
    test: { recomputed: rmse(test, r => clamp(mu + dot(r.userId, r.movieId))), page: run.testRMSE },
    baselineTest: { recomputed: rmse(test, () => trainMean), page: run.baselineTestRMSE },
    selectedEpoch: run.best.epoch, trainMean
};

// 2. Recall@10 and Top-10 lists from scratch
const ratedTV = new Map();
for (const r of train.concat(val)) {
    if (!ratedTV.has(r.userId)) ratedTV.set(r.userId, new Set());
    ratedTV.get(r.userId).add(r.movieId);
}
const top10 = (u) => movies.filter(m => !ratedTV.get(u)?.has(m.id))
    .map(m => ({ movieId: m.id, score: mu + dot(u, m.id) }))
    .sort((a, b) => b.score - a.score || a.movieId - b.movieId).slice(0, 10);
const candidates = new Set(train.map(r => r.movieId));
const relevant = new Map();
for (const r of test) if (r.rating >= 4 && candidates.has(r.movieId)) {
    if (!relevant.has(r.userId)) relevant.set(r.userId, new Set());
    relevant.get(r.userId).add(r.movieId);
}
let recallSum = 0, hitUsers = 0, listMismatch = 0, maxScoreDiff = 0;
const lists = new Map();
for (const u of [...ratedTV.keys()].sort((a, b) => a - b)) {
    const mine = top10(u);
    lists.set(u, mine);
    const page = run.topK[u];
    if (mine.map(x => x.movieId).join() !== page.map(x => x.movieId).join()) listMismatch++;
    page.forEach((x, k) => { if (mine[k]) maxScoreDiff = Math.max(maxScoreDiff, Math.abs(x.score - mine[k].score)); });
}
for (const [u, rel] of relevant) {
    const hits = lists.get(u).filter(x => rel.has(x.movieId)).length;
    recallSum += hits / rel.size;
    if (hits) hitUsers++;
}
out.recall = {
    recomputed: recallSum / relevant.size, page: run.recall.overallRecall, users: relevant.size,
    usersWithAtLeastOneHit: hitUsers, totalHits: run.recall.perUser.reduce((s, x) => s + x.hit, 0),
    unseenIds: run.recall.unseenIds, usersWithoutRelevant: run.recall.usersWithoutRelevant,
    top10ListsDifferentFromPage: listMismatch, maxScoreDifference: maxScoreDiff
};

// 3. One prediction written out (first test rating of user 1)
const pair = test.find(r => r.userId === 1);
out.handCheck = {
    userId: pair.userId, movieId: pair.movieId, title: movies.find(m => m.id === pair.movieId).title,
    rating: pair.rating, globalMean: mu,
    p: Array.from(P.slice(pair.userId * F, pair.userId * F + F)).map(x => +x.toFixed(4)),
    q: Array.from(Q.slice(pair.movieId * F, pair.movieId * F + F)).map(x => +x.toFixed(4)),
    dot: dot(pair.userId, pair.movieId), prediction: clamp(mu + dot(pair.userId, pair.movieId)),
};
out.handCheck.squaredError = (out.handCheck.prediction - pair.rating) ** 2;

// 4. Familiar vs. new
const count = new Map();
for (const r of train) count.set(r.movieId, (count.get(r.movieId) || 0) + 1);
const popularityRank = new Map([...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id], k) => [id, k + 1]));
const genresOf = new Map(movies.map(m => [m.id, m.genres]));
const titleOf = new Map(movies.map(m => [m.id, m.title]));
const allRecs = [...lists.values()].flat();
const timesRecommended = new Map();
for (const x of allRecs) timesRecommended.set(x.movieId, (timesRecommended.get(x.movieId) || 0) + 1);
out.global = {
    users: lists.size, distinctMoviesRecommended: timesRecommended.size,
    shareInTop100Popular: allRecs.filter(x => (popularityRank.get(x.movieId) || 1e9) <= 100).length / allRecs.length,
    medianTrainRatingsOfRecommended: allRecs.map(x => count.get(x.movieId) || 0).sort((a, b) => a - b)[Math.floor(allRecs.length / 2)],
    recommendedNotInTrain: allRecs.filter(x => !count.has(x.movieId)).length,
    mostRecommended: [...timesRecommended].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([id, n]) => ({ title: titleOf.get(id), users: n, trainRatings: count.get(id) || 0 }))
};

// Genre familiarity: share of a user's Top-10 that shares a genre with the user's 3 most-liked genres
function profile(u) {
    const liked = train.filter(r => r.userId === u && r.rating >= 4);
    const g = new Map();
    for (const r of liked) for (const x of genresOf.get(r.movieId)) g.set(x, (g.get(x) || 0) + 1);
    return { liked: liked.length, topGenres: [...g].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => x),
             genreCounts: Object.fromEntries([...g].sort((a, b) => b[1] - a[1])) };
}
let familiar = 0;
for (const [u, list] of lists) {
    const top = new Set(profile(u).topGenres);
    familiar += list.filter(x => genresOf.get(x.movieId).some(g => top.has(g))).length;
}
out.global.shareSharingAUsersTop3Genre = familiar / allRecs.length;

// The two report users: the evaluable users with the most and the fewest training ratings
const trainCount = new Map();
for (const r of train) trainCount.set(r.userId, (trainCount.get(r.userId) || 0) + 1);
const evaluable = [...relevant.keys()].sort((a, b) => trainCount.get(b) - trainCount.get(a) || a - b);
const chosen = [evaluable[0], evaluable[evaluable.length - 1]];
out.users = chosen.map(u => {
    const pr = profile(u);
    const fives = train.filter(r => r.userId === u && r.rating === 5).map(r => titleOf.get(r.movieId));
    const rel = relevant.get(u);
    return {
        userId: u, trainRatings: trainCount.get(u), likedInTrain: pr.liked, topGenres: pr.topGenres, genreCounts: pr.genreCounts,
        fiveStarExamples: fives.slice(0, 8), relevantTest: [...rel].map(id => titleOf.get(id)),
        top10: lists.get(u).map(x => ({ title: titleOf.get(x.movieId), score: +x.score.toFixed(4), genres: genresOf.get(x.movieId),
            trainRatings: count.get(x.movieId) || 0, popularityRank: popularityRank.get(x.movieId) || null,
            sharesTopGenre: genresOf.get(x.movieId).some(g => pr.topGenres.includes(g)), relevantInTest: rel.has(x.movieId) }))
    };
});

writeFileSync(join(root, 'evidence', 'analysis.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ rmse: out.rmse, recall: { ...out.recall, unseenIds: out.recall.unseenIds }, handCheck: out.handCheck, global: out.global }, null, 1));
for (const u of out.users) {
    console.log(`\nUSER ${u.userId}: train ${u.trainRatings}, liked ${u.likedInTrain}, top genres ${u.topGenres}`);
    console.log('  5-star:', u.fiveStarExamples.join(' | '));
    console.log('  relevant test:', u.relevantTest.join(' | '));
    u.top10.forEach((x, k) => console.log(`  ${k + 1}. ${x.title} ${x.score} [${x.genres}] pop#${x.popularityRank} n=${x.trainRatings}${x.sharesTopGenre ? '' : ' NEW-GENRE'}${x.relevantInTest ? ' HIT' : ''}`));
}
