Run the full release pipeline: commit staged changes, build and deploy to Cloud Run, then push the branch to origin.

## Steps

1. Run the release script from the repo root:
   ```
   ./scripts/release.sh
   ```
   This handles: git commit (auto-message), Docker build, image push to Artifact Registry, Cloud Run deploy, cleanup of old revisions/images.

2. After the script completes successfully, push to origin:
   ```
   git push
   ```

## Notes

- If only docs/config files changed, the script skips the Docker build automatically. Use `./scripts/release.sh --force-deploy` to override.
- Pass extra flags via arguments to this command, e.g. `/release --no-commit` or `/release --dry-run`.
- The script must be run from inside the `tracker/` directory (it resolves the repo root via `git rev-parse`).
- Do not run `git push` if the release script fails.

## Usage with flags

If the user provides arguments (e.g. `$ARGUMENTS`), append them to the script invocation:
```
./scripts/release.sh $ARGUMENTS
```
