#!/bin/bash

# --- CONFIGURATION ---
PROJECT_ID="chimbuc-playground"
LOCATION="europe-west2"
REPOSITORY="t212"
IMAGE_NAME="portfolio"
KEEP_COUNT=5

echo "Starting cleanup for $IMAGE_NAME in $REPOSITORY..."

# 1. Fetch versions, sorted by creation time (descending)
# 2. Skip the most recent 5
# 3. Get the names (IDs) of the rest
VERSIONS_TO_DELETE=$(gcloud artifacts versions list \
    --project="$PROJECT_ID" \
    --location="$LOCATION" \
    --repository="$REPOSITORY" \
    --package="$IMAGE_NAME" \
    --sort-by="~CREATE_TIME" \
    --format="value(name)" | sed "1,${KEEP_COUNT}d")

if [ -z "$VERSIONS_TO_DELETE" ]; then
    echo "Nothing to delete. You have $KEEP_COUNT or fewer versions."
    exit 0
fi

echo "The following versions will be deleted:"
echo "$VERSIONS_TO_DELETE"
echo "--------------------------------------"

# Loop through and delete
for VERSION in $VERSIONS_TO_DELETE; do
    echo "Deleting version: $VERSION"
    gcloud artifacts versions delete "$VERSION" \
        --project="$PROJECT_ID" \
        --location="$LOCATION" \
        --repository="$REPOSITORY" \
        --package="$IMAGE_NAME" \
        --delete-tags \
        --quiet
done

echo "Cleanup complete. Only the last $KEEP_COUNT versions remain."