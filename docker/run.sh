#!/bin/bash

subprojects=($(lerna la -p --json | jq -r '.[].name'))
error_occurred=0

for subproject in "${subprojects[@]}"
do
  project_dir="projects/$subproject"
  if test -f "$project_dir/hardhat.config.ts"; then
    echo "Running subproject: $subproject"
    npx hardhat test --config "$project_dir/hardhat.config.ts"
  fi

  exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "Subproject $subproject failed with exit code $exit_code"
    error_occurred=1
  fi
done

if [ $error_occurred -ne 0 ]; then
  echo "One or more subprojects failed."
  exit 1
fi

echo "All subprojects completed successfully."
exit 0