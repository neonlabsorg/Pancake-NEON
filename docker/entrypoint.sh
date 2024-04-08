#!/bin/sh
# Change to the correct directory
cd /usr/src/app;
# Run Pancake tests
/bin/bash ./docker/run.sh;
# Aggregate the result reports
. ./docker/report.sh;