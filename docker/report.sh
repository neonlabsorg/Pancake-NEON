#!/bin/sh
find . -name 'report_*.json' -exec jq -s '.' {} + > report.json