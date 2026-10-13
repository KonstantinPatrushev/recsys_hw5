# From Ratings to Recommendations — A05 (LLM4Rec, HSE)

**Live demo:** https://konstantinpatrushev.github.io/recsys_hw5/

Solution of [dryjins/RecSys-LLMs/week5](https://github.com/dryjins/RecSys-LLMs/tree/main/week5):
matrix factorization with 16-dimensional user and movie vectors, trained in the browser with
TensorFlow.js on MovieLens-100k, with a chronological 80/10/10 split per user.

## What was implemented

The six `TODO(hw5)` stubs in `script.js`; `index.html`, `style.css`, `data.js`, `u.data`, `u.item`
are the starter's files unchanged.

| Function | Notes |
|---|---|
| `initializeFactors` | train mean; `tf.variable(tf.randomNormal(..., 0, 0.05, "float32", seed))` for users `[944,16]` and movies `[1683,16]`; disposes the previous model |
| `trainMF` | Adam, shuffled mini-batches, `tf.gather` + row-wise dot product, MSE + L2 on the batch's rows; keeps a copy of the factors at the best validation RMSE and restores it at the end |
| `predictRating` | `mu + p_u · q_i`, clamped to [1, 5]; `mu` for unknown ids |
| `selectBestCheckpoint` | smallest validation RMSE, earliest epoch on ties |
| `recommendTopK` | `matMul` of all movie factors with the user row, mask train/val-rated movies, `tf.topk` |
| `recallAtK` | relevant = test ratings ≥ 4 on movies seen in training; reports unseen ids and users without a relevant candidate |

Self-checks: 4 passed / 0 failed / 7 pending before, **11 / 0 / 0** after (`evidence/tests_*.txt`).

Training needs the **WebGL** backend: on TensorFlow.js's CPU backend the gradient of `tf.gather`
(`UnsortedSegmentSum`) loops over every row of the factor matrix, and one epoch takes more than
10 minutes.

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `data.js`, `script.js`, `u.data`, `u.item` | the app |
| `baseline/` | the original week 5 starter |
| `tests/run_in_browser.html`, `tests/run_browser.sh` | run the page's code headless in Chrome with given hyper-parameters, save the numbers and the trained factors |
| `tests/analysis.mjs` | recomputes RMSE, Recall@10 and every Top-10 list from the saved factors in plain JavaScript, plus the familiar-vs-new analysis |
| `tests/data_stats.mjs` | dataset and split statistics |
| `evidence/` | outputs |

## Reproduce

```bash
cd tests && npm install && cd ..        # TensorFlow.js for tests/load_app.mjs only
python3 -m http.server 8772 &
tests/run_browser.sh evidence/run_main.json 'epochs=20&lr=0.01&reg=0.05&batch=64&full=1&users=all'
node tests/analysis.mjs
node tests/data_stats.mjs
```
