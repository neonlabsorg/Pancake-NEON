#!/bin/bash

# Run tests for each package with a pause
for PACKAGE in $(lerna la -p --json | jq -r '.[].name'); do
  echo "Running command for $PACKAGE"
  lerna run test --scope="$PACKAGE" --stream

  sleep 1
done