# Sign Language System

A sign-language application with a React/Vite frontend, an Express API, Prisma, Neon Postgres, and Neon Object Storage.

## Local development

Requirements: Node.js 22 and npm.

1. Copy `.env.example` to `.env` and `sign-language-server/.env.example` to `sign-language-server/.env`. Use your own secrets and never commit real environment files.
2. Install dependencies:

   ```sh
   npm ci
   npm ci --prefix sign-language-server
   ```

3. Configure `DATABASE_URL` with the pooled Postgres connection string, `DATABASE_URL_UNPOOLED` with the direct connection string, and set a private `JWT_SECRET`.
4. Apply migrations and start the frontend/API:

   ```sh
   npm run db:migrate:deploy --prefix sign-language-server
   npm run dev
   ```

The Vite development server runs on port 5173 and proxies API calls to the Express API on port 3001. Local file storage is used when S3-compatible storage variables are not configured.

## Deploy to Vercel with Neon

The API is exposed as a Vercel Function at `api/[...path].ts`. Neon supplies Postgres and the S3-compatible buckets used for public sign assets and private hand crops.

1. Import the repository into Vercel with the repository root as the project root. `vercel.json` configures installation, build, and the SPA rewrite.
2. Set the Vercel environment variables from the linked Neon project: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BUCKET`, and `STORAGE_PRIVATE_BUCKET`. Also set the app's `JWT_SECRET`, `CORS_ORIGIN`, and any optional Google/AI provider variables you use.
3. Set `VITE_GOOGLE_CLIENT_ID` if Google sign-in is enabled and authorize the Vercel domain in the Google OAuth client. Set `VITE_API_ROOT` only if the API is hosted on a different origin; otherwise leave it unset.
4. Apply production migrations using the direct Neon URL:

   ```sh
   npm run db:migrate:deploy --prefix sign-language-server
   ```

5. Redeploy after setting or changing environment variables. Uploads use 3 MB chunks so they stay below Vercel Function request limits.

For local commands with the linked Neon environment, run them through `neon-env run -- <command>` so the CLI injects the configured branch variables.

## Deploy the API with Docker/Railway

The Dockerfile also runs the Express API as a Node service. Configure `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `JWT_SECRET`, and `CORS_ORIGIN` in the hosting provider. Configure the Neon Object Storage variables above for persistent uploads; without them, local uploads use the container filesystem and are not persistent. The container applies Prisma migrations before starting.

## Admin credentials

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` as deployment environment variables, using a strong unique password. Never commit credentials or put them in a tracked example file.
