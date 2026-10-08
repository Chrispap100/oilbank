# Validation — 8 October 2026

Validated on Windows with Node.js v24.19.0, SQLite built into Node, Express 5.1.0.

`node --test --test-concurrency=1`: **21 passed, 0 failed** (20 subtests and their enclosing integration test).

Coverage: first-run admin setup and repeat setup; schema creation/idempotence; foreign keys; login; user creation, duplicates, pending approval, disable/reactivate, reset and vault; vehicle ownership; fuel/odometer/boolean handling; expenses; obligations; original PDF bytes on disk and authenticated download; confirmation rollback and duplicate protection; audit JSON; seven UTF-8 CSV exports and formula escaping; full SQLite/document backup; corrupt/incomplete/legacy backup rejection; restore of deleted records and a missing PDF; vault/password recovery and invalidated old sessions; concurrent requests; private-file denial; maintenance process lock and persistent data read from another process.

Headless Microsoft Edge smoke test passed: login, settings and CSV button, creation of a vehicle, manual PDF upload and confirmation. Desktop (1440×1000) and mobile (390×844) screenshots were visually inspected. No JavaScript page errors were reported. This uncovered and fixed pre-existing mismatches between the HTML fuel table/dashboard and script selectors, and asynchronous form-reset errors.

No production database was accessed or migrated. No live OpenAI call was made. Optional AI is retained but requires separate credentials and an online check. The Windows batch file was inspected; its Node setup path was exercised automatically, while browser auto-opening through a user's double-click was not exercised end-to-end.
