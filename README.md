<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c2d9c137-7171-4453-a51d-90ca30a0584a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `VITE_GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Netlify + Backend Deployment

For production, deploy frontend and backend separately:

- Frontend (this Vite app): Netlify
- Backend (`server.ts`): Render/Railway/Fly/Cloud Run

Set frontend env vars on Netlify:

- `VITE_API_BASE_URL=https://your-backend-domain.com`
- `VITE_GEMINI_API_KEY=...` (optional)

Set backend env vars:

- `SESSION_SECRET=...` (long random string)
- `APP_ORIGIN=https://your-netlify-domain.netlify.app`
- `ALLOWED_ORIGINS=https://your-netlify-domain.netlify.app`

Notes:

- Cookies/session auth requires HTTPS in production.
- Do not place server secrets in `VITE_*` variables.
