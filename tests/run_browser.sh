#!/usr/bin/env bash
# Runs tests/run_in_browser.html in headless Chrome and saves its JSON result.
# Needs a static server on :8772 serving hw5/ (python3 -m http.server 8772).
# usage: tests/run_browser.sh <output.json> '<query string>'
out="$1"; query="$2"
start=$(date +%s)
google-chrome --headless=new --no-sandbox --enable-unsafe-swiftshader --virtual-time-budget=3600000 \
  --dump-dom "http://localhost:8772/tests/run_in_browser.html?${query}" 2>/dev/null \
  | python3 -c 'import sys,re,html; print(html.unescape(re.search(r"<pre id=\"result\">(.*?)</pre>", sys.stdin.read(), re.S).group(1)))' > "$out"
echo "{\"wallSeconds\": $(( $(date +%s) - start )), \"query\": \"${query}\"}" > "${out%.json}.time.json"
