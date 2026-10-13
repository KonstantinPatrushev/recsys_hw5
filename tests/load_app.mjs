// Loads the unmodified data.js and script.js into one Node VM context — the way the page runs
// them as classic <script> tags — with TensorFlow.js 4.22.0 (the version index.html loads from
// the CDN) as the global `tf`. Then does what window.onload does, minus the DOM: load the data
// and split it chronologically.
import vm from 'vm';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function loadApp() {
    const tf = require('@tensorflow/tfjs');
    await tf.setBackend('cpu');
    await tf.ready();
    const context = vm.createContext({
        tf, console, window: {},
        fetch: async (path) => ({ ok: true, text: async () => readFileSync(join(root, path), 'latin1') })
    });
    for (const file of ['data.js', 'script.js']) {
        vm.runInContext(readFileSync(join(root, file), 'utf8'), context, { filename: file });
    }
    await vm.runInContext('loadData()', context);
    vm.runInContext('{ const s = splitByTimestamp(); trainSet = s.train; valSet = s.val; testSet = s.test; }', context);
    return { tf, run: (code) => vm.runInContext(code, context) };
}
