#!/bin/sh
find . -name 'report-*.json' -exec jq -s 'reduce .[] as $item ({}; . * $item)' {} + > report.json
