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

## Shared sign entries

Gesture recordings and uploaded sign assets share a canonical `Gesture` entry. Uploaded files are stored as `SignAsset` rows linked to that entry, so the same label, aliases, and translations are available to webcam recognition, speech lookup, and translation. Admins and teachers can enter translations as a JSON object keyed by language (for example `{"Tagalog":"pula","Cebuano":"pula"}`) and comma-separated spoken aliases when uploading a sign. Speech-to-sign labels use the selected language's registered translation (so “pula” can display as “red” when English is selected). Admins and teachers can replace an image asset from the Sign Library by taking a new camera photo; this updates the existing asset and keeps its label and translations. Browser caches keep the sign library and recent translations available for repeat lookups and temporary offline use.

Image uploads are resized to at most 512×512 and encoded as WebP or JPEG before upload. Speech lookup checks the registered label, aliases, and translations, including fuzzy single-word matches. Webcam gesture output requires at least 80% confidence and a stable 500 ms detection; repeated translated speech is cooled down for 2.5 seconds while changed gestures can speak immediately.

## Browser landmark recognition and dataset imports

The browser uses the free `@mediapipe/tasks-vision` HandLandmarker to extract hand landmarks locally. The first run downloads the MediaPipe WASM/model assets from their public hosting; inference does not send camera frames to the API. Local matching becomes available after landmark templates have been imported. Templates are normalized for translation and scale and are accepted at 82% similarity; the existing recognition pipeline remains as a fallback.

`sign-language-server/prisma/migrations/6_gesture_landmark_templates` adds optional landmark templates to the canonical `Gesture` registry. Apply migrations before importing. From the `sign-language-server` directory, `npx prisma db seed` reads `scripts/premade-gestures.json`; the same operation is available from the repository root as `npm run db:seed --prefix sign-language-server`.

The seed file documents its entry shape and starts with an empty `gestures` array. Populate it only with dataset entries you are licensed to use and follow each dataset's attribution and redistribution terms. Each JSON entry has `gestureLabel`, `englishWord`, `tagalogWord`, `cebuanoWord`, `landmarks` (exactly 21 `{x,y,z}` objects), and optional public `imageUrl`. The Admin Signs page accepts `.json` or `.csv` bulk imports (up to 1,000 entries and 5 MB per file); CSV uses those field names as headers, with `landmarks` encoded as a JSON array. Imported labels, translations, templates, and optional image URLs are attached to the shared registry.

Speech-to-sign also includes a typed sentence player. It advances through matching registered assets and uses registered A–Z assets for fingerspelling when a word is missing; if a letter asset has not been imported, the player shows the letter as a visible fallback instead.

## Deploy to Vercel with Neon

The API is exposed as a Vercel Function at `api/[...path].ts`. Neon supplies Postgres and the S3-compatible buckets used for public sign assets and private hand crops.

1. Import the repository into Vercel with the repository root as the project root. `vercel.json` configures installation, build, and the SPA rewrite.
2. Set the Vercel environment variables from the linked Neon project: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BUCKET`, and `STORAGE_PRIVATE_BUCKET`. Also set the app's `JWT_SECRET`, `CORS_ORIGIN`, and any optional Google/AI provider variables you use.
3. Set `VITE_GOOGLE_CLIENT_ID` if Google sign-in is enabled and authorize the Vercel domain in the Google OAuth client. Set `VITE_API_ROOT` only if the API is hosted on a different origin; otherwise leave it unset. Let Vercel set `NODE_ENV` and `PORT`; do not override `NODE_ENV` to `development`.
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
