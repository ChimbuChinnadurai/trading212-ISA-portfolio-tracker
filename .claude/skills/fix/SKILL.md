## Bug Fix Workflow
1. Read the user's bug description carefully
2. Grep the entire codebase for related functions, callers, and references
3. Fix the root cause in backend (app.py) AND frontend (JS/HTML/CSS) if applicable
4. Search for ALL other callers of any modified/removed functions
5. Verify no CSS regressions by checking container heights and flex layouts
6. Summarize all files changed and what was fixed
