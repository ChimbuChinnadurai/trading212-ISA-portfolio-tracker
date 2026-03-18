#!/bin/bash

# Configuration
REPO="europe-west2-docker.pkg.dev/chimbuc-playground/t212/portfolio"

echo "Fetching tags from Artifact Registry..."

# 1. Get the list of tags, filter for those starting with 'v', 
#    strip the 'v', sort numerically, and pick the highest.
LATEST_VERSION=$(gcloud artifacts docker images list "$REPO" \
    --include-tags --format="value(TAGS)" | tr ',' '\n' | \
    grep -E '^v[0-9]+$' | sed 's/^v//' | sort -n | tail -n 1)

# 2. Check if a version was found; if not, start at 1
if [ -z "$LATEST_VERSION" ]; then
    echo "No existing 'v*' tags found. Starting at v1."
    NEW_VERSION="v1"
else
    NEXT_NUM=$((LATEST_VERSION + 1))
    NEW_VERSION="v$NEXT_NUM"
    echo "New image version: v$NEW_VERSION"
fi


# 3. Build and push the new image   
docker build --platform=linux/amd64 -t "$REPO:$NEW_VERSION" .  
 
docker push "$REPO:$NEW_VERSION"

# 4. Deploy to Cloud Run
gcloud run deploy t212 \
--image=europe-west2-docker.pkg.dev/chimbuc-playground/t212/portfolio:$NEW_VERSION \
--min-instances=0 \
--set-env-vars=PORTFOLIO_NAME_1=Chimbu,PORTFOLIO_NAME_2=Poornima \
--set-secrets=FINNHUB_TOKEN=finhub:latest,TRADING212_API_KEY_1=t212-chimbu:latest,TRADING212_API_KEY_2=t212-poornima:latest,MASSIVE_API_KEY=MASSIVE_API_KEY:latest,DATABASE_URL=t212-database-url:latest \
--no-cpu-boost \
--region=europe-west1 \
--project=chimbuc-playground \
 && gcloud run services update-traffic t212 --region=europe-west1 --to-latest

                 