# Repository Guidelines

## Project Structure & Module Organization
- `mobile/` is the React Native/Expo app (UI, chat, PDFs).
- `agent-ia/` is the Node.js/TypeScript backend for Gemini + Supabase.
- `server-sse/` is the SSE server (Redis-backed).
- `supabase/` contains Edge Functions, migrations, and template docs.
- `docker-compose*.yml` and deploy scripts are for deployment.

## Build, Test, and Development Commands
- `cd agent-ia && npm install && npm run dev` runs the backend via `ts-node`.
- `cd agent-ia && npm run build && npm start` builds/runs the compiled server.
- `cd server-sse && npm install && npm run dev` starts the SSE server in watch mode.
- `cd server-sse && npm run build && npm run start:prod` builds/runs production SSE.
- `cd mobile && npm install && npm start` starts the Expo dev server.
- `cd mobile && npm run web` runs the web target; `npm run build:web` exports static assets.
- `cd mobile && npm run lint`, `npm run format`, `npm run type-check` are the main quality gates.
- `docker-compose.yml` targets Docker Swarm and expects external `network_public` + secrets; use for deploys, not local dev.

## Coding Style & Naming Conventions
- TypeScript is used across `mobile/`, `agent-ia/`, and `server-sse/`; follow existing patterns.
- Mobile code is formatted with ESLint + Prettier; run `npm run lint` and `npm run format` before PRs.
- Keep naming consistent: components in `mobile/src/components` are PascalCase, hooks in `mobile/src/hooks` use `useX`, routes live under `mobile/src/app`.

## Testing Guidelines
- No repo-wide test runner is configured yet.
- For new automated tests, prefer Playwright for end-to-end flows. Write test names/steps that explain the expected behavior so the tests double as documentation.
- If you add tests, include a script in the relevant `package.json` (for example `npx playwright test`) and document how to run it in your PR.
- Rely on `mobile` linting and type-checking as checks until tests are in place.

## Commit & Pull Request Guidelines
- Recent commits use Conventional Commit prefixes (e.g., `feat:`); follow that pattern.
- PRs should include a short summary, test commands run, and screenshots for UI changes.
- If you touch Supabase schema/functions, reference the updated files in `supabase/` and call out required migrations or secrets.

## Security & Configuration Tips
- Never commit secrets. Use environment variables and Docker secrets for `SUPABASE_*`, `GEMINI_API_KEY`, and auth tokens.
- Required environment values are documented in `README.md` and referenced in `docker-compose.yml`.
