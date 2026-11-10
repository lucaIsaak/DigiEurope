# 2. File-based store for the prototype

Status: accepted

The prototype stores applications in a JSON file and uploads in a folder (`apps/api/data/`) instead of PostgreSQL. It runs with `npm run dev` alone, which makes demos and pitch rehearsals easy, and the seed data resets with one command. All access goes through the `Store` class so a PostgreSQL implementation can replace it once the data model settles. Not suitable for real personal data.
