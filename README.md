# Sign Language System

A full-stack sign-language application with a React/Vite frontend, an Express API, and Prisma with SQLite.

## Run locally

Requirements: Node.js 22 and npm.

1. Copy `.env.example` to `.env` and `sign-language-server/.env.example` to `sign-language-server/.env`.
2. Install both packages:

   ```sh
   npm ci
   npm ci --prefix sign-language-server
   ```

3. In `sign-language-server/.env`, set `DATABASE_URL=file:./dev.db` and a private `JWT_SECRET`.
4. Create/update the local SQLite schema and generate Prisma Client:

   ```sh
   npm run prisma:generate --prefix sign-language-server
   npm run db:push --prefix sign-language-server
   ```

5. Start the frontend and API:

   ```sh
   npm run dev
   ```

The Vite development server runs on port 5173 and proxies API calls to the Express API on port 3001.

## Deploy on Railway

The repository is configured as one Railway service: the Dockerfile builds the frontend and API, and the API serves both. SQLite and uploaded files are stored on a Railway volume.

1. Create a Railway project from this GitHub repository. Railway uses the root `railway.json` and `Dockerfile`.
2. Add a volume to the service, mounted at `/data`.
3. Set these service variables:

   ```env
   DATABASE_URL=file:/data/sign-language.db
   UPLOAD_DIR=/data/public
   JWT_SECRET=<a-long-random-secret>
   CORS_ORIGIN=https://<your-railway-domain>
   ```

   `DATABASE_URL` and `UPLOAD_DIR` must stay under the mounted volume. Leave `VITE_API_ROOT` unset so the frontend calls the API on the same origin. Set `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` if Google sign-in is enabled; `GROQ_API_KEY` is optional for AI features.

The service applies the Prisma schema to the SQLite database when it starts and exposes `/health` for Railway health checks. The checked-in migration history is PostgreSQL-based, so this SQLite deployment uses `prisma db push` rather than `prisma migrate deploy`. A new Railway volume starts with an empty database; local database contents are not uploaded.

Uploaded media also uses `/data`, so it persists across deploys. Without the volume, both the SQLite database and locally stored uploads would be ephemeral.

## Environment files

Use the two `.env.example` files as templates. Never commit actual `.env` files or database contents. The seed script requires `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `TEACHER_EMAIL`, and `TEACHER_PASSWORD`.
