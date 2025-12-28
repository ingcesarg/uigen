# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

UIGen is an AI-powered React component generator with a live preview. Users describe React components in a chat interface, and the system generates/updates an in-memory virtual project (no files on disk) and renders it in real time. Authenticated users get persistent projects stored in SQLite via Prisma; anonymous users work purely in the browser until they sign in.

Tech stack (from README and CLAUDE rules):
- Next.js 15 App Router, React 19, TypeScript, Tailwind v4
- Vitest + React Testing Library
- Prisma + SQLite (client output at `src/generated/prisma`)
- Anthropic via Vercel AI SDK, with a built-in mock provider when no API key is configured

## Prerequisites & Environment

- Node.js 18+ and `npm`.
- Database: SQLite file at `prisma/dev.db` managed by Prisma.
- Environment:
  - Optional: `ANTHROPIC_API_KEY` in `.env`. If absent or blank, `src/lib/provider.ts` falls back to `MockLanguageModel` and returns static/example components instead of calling Anthropic.
  - Recommended for production: set `JWT_SECRET` to override the default development secret used by `src/lib/auth.ts`.
- Internal import alias: `@/` maps to `./src/*` (see `tsconfig.json`). When adding code, prefer `@/` imports instead of deep relative paths.

## Core Commands

All commands are run from the repo root (`uigen`).

### Setup & Database

- Full setup (install deps, generate Prisma client, run migrations):
  ```bash
  npm run setup
  ```
- Reset database (drops & recreates, **destructive**):
  ```bash
  npm run db:reset
  ```
- After editing `prisma/schema.prisma`, regenerate the client and create a migration:
  ```bash
  npx prisma generate
  npx prisma migrate dev --name <migration_name>
  ```

### Running the App

- Development server (Turbopack):
  ```bash
  npm run dev
  ```
- Development server in the background with logs to `logs.txt`:
  ```bash
  npm run dev:daemon
  ```
- Production build & start:
  ```bash
  npm run build
  npm start
  ```

### Linting

- Next.js/ESLint linting:
  ```bash
  npm run lint
  ```

### Tests (Vitest)

Vitest is configured in `vitest.config.mts` with a `jsdom` environment and React + TS support.

- Run all tests:
  ```bash
  npm test
  ```
- Run a single test file (tests live next to source in `__tests__` directories):
  ```bash
  npx vitest src/components/chat/__tests__/ChatInterface.test.tsx
  ```

### Security Audit Workflow (from `.claude/commands/audit.md`)

There is a documented routine for dependency vulnerability checks:
```bash
npm audit
npm audit fix
npm test
```

## Testing Conventions

From CLAUDE rules and the existing tests:
- Framework: Vitest + React Testing Library (for components) in a `jsdom` environment.
- Location: tests are colocated under `__tests__` directories next to the code they cover.
- Naming: `[filename].test.ts` or `[filename].test.tsx`.
- Use the `@/` alias in tests for imports.

## High-Level Architecture

### Routing & Layout (Next.js App Router)

- Root layout: `src/app/layout.tsx` sets global fonts and wraps all pages.
- Anonymous landing page: `src/app/page.tsx`
  - Calls `getUser()` (server action) to detect the authenticated user.
  - If authenticated, fetches the most recent project via `getProjects()` and redirects to `/{projectId}`.
  - If the user has no projects, creates one via `createProject()` and redirects to it.
  - For anonymous users, renders `<MainContent user={null} />` without a bound project.
- Project page: `src/app/[projectId]/page.tsx`
  - Resolves `projectId` from route params, calls `getUser()` and `getProject(projectId)`.
  - Redirects to `/` if unauthenticated or if the project lookup fails.
  - On success, renders `<MainContent user={user} project={project} />`.

The app’s interactive UI is centralized in `src/app/main-content.tsx` and is used by both the anonymous and project pages.

### Main UI Shell & Providers

`src/app/main-content.tsx` defines the core split-pane UI and wraps everything in the primary client-side providers:
- `FileSystemProvider` (`src/lib/contexts/file-system-context.tsx`)
- `ChatProvider` (`src/lib/contexts/chat-context.tsx`)

The layout:
- Left panel: chat side (`<ChatInterface />`) where users describe components.
- Right panel: either
  - **Preview** (`<PreviewFrame />`) – live render of the generated app, or
  - **Code** view – a nested horizontal split with `<FileTree />` and `<CodeEditor />` over the virtual file system.
- Top-right actions: `<HeaderActions />` (auth controls, project switcher, “New Design” button).

When working on UX or wiring up new features, this is the main composition point.

### Virtual File System & File Management

Core type & implementation: `src/lib/file-system.ts`.

Key aspects:
- `VirtualFileSystem` maintains an in-memory tree of `FileNode` objects (files and directories) keyed by normalized paths (`/`-prefixed, no trailing slash for non-root).
- No writes to disk: all operations (`createFile`, `createDirectory`, `updateFile`, `deleteFile`, `rename`, etc.) are purely in-memory.
- Serialization:
  - `serialize()` produces a simple `Record<string, FileNode>`-like structure for persistence.
  - `deserializeFromNodes()` and `deserialize()` rebuild the internal maps from stored project data.
- Text editor helpers for LLM tools:
  - `viewFile`, `createFileWithParents`, `replaceInFile`, `insertInFile` return user-readable strings describing actions/results.
  - `reset()` clears the VFS back to a clean root.

`src/lib/contexts/file-system-context.tsx` bridges this VFS into React:
- Owns a single `VirtualFileSystem` instance for the session and optional `initialData` from a persisted project.
- Tracks `selectedFile` and exposes a `refreshTrigger` integer to force re-renders when the VFS changes.
- Auto-selects `/App.jsx` as the initial file if present, otherwise the first root-level file.
- Exposes imperative helpers (`createFile`, `updateFile`, `deleteFile`, `renameFile`, `getFileContent`, `getAllFiles`, `reset`) plus `useFileSystem()` hook for consumers.
- Implements `handleToolCall(toolCall)` to mirror AI tool actions into the client VFS:
  - `str_replace_editor` commands: `create`, `str_replace`, `insert` → call into `VirtualFileSystem` helpers and update React state.
  - `file_manager` commands: `rename`, `delete` → delegate to `renameFile` / `deleteFile` with selection management.

When adding new file operations, they generally belong in `VirtualFileSystem` first, then are surfaced via this context and any new tools.

### AI Chat, Tools, and Project Persistence

**Client chat context** – `src/lib/contexts/chat-context.tsx`:
- Uses `useChat` from `@ai-sdk/react` to talk to `/api/chat`.
- Before each request, augments the body with:
  - `files: fileSystem.serialize()` – the current in-memory project.
  - `projectId` (when bound to a saved project).
- Handles `onToolCall` by delegating to `handleToolCall` from `FileSystemContext`, so tool invocations update the client-side VFS in lockstep with the server.
- Tracks the text input and submit handlers used by `ChatInterface`.
- For anonymous sessions (no `projectId`), stores messages + serialized VFS in `sessionStorage` via `setHasAnonWork` (`src/lib/anon-work-tracker.ts`). This data is later picked up after sign-in.

**Server chat endpoint** – `src/app/api/chat/route.ts`:
- Accepts `messages`, serialized `files` (as `Record<string, FileNode>`), and optional `projectId`.
- Prepends a system message containing `generationPrompt` from `src/lib/prompts/generation.tsx`, which encodes important generation rules (always create `/App.jsx` first, Tailwind-only styling, `@/` imports for internal modules, etc.).
- Reconstructs a new `VirtualFileSystem` from the serialized nodes and passes it into two tool builders:
  - `buildStrReplaceTool(fileSystem)` (`src/lib/tools/str-replace.ts`) – text editor-like tool with commands `view`, `create`, `str_replace`, `insert`, `undo_edit` (the last returns an explicit error message).
  - `buildFileManagerTool(fileSystem)` (`src/lib/tools/file-manager.ts`) – higher-level rename/delete operations built on top of the VFS.
- Calls `streamText` from the `ai` SDK with:
  - `model` from `getLanguageModel()` (`src/lib/provider.ts`).
  - `tools` exposing the above to the LLM.
  - `onFinish` callback that, for authenticated users and when `projectId` is present:
    - Combines original non-system messages with `response.messages` to form `allMessages`.
    - Persists `allMessages` and the latest serialized VFS into `prisma.project.data`.

**AI provider selection** – `src/lib/provider.ts`:
- If `ANTHROPIC_API_KEY` is not set or blank:
  - Logs a message and uses `MockLanguageModel` with deterministic, multi-step tool call behavior:
    - Creates `/components/<Component>.jsx` and `/App.jsx` files with reasonable demo content.
    - Uses `str_replace_editor` to “enhance” components in subsequent turns.
- If `ANTHROPIC_API_KEY` is present:
  - Returns `anthropic(MODEL)` with a concrete Anthropic model ID.

When modifying tool behavior or adding new tools, keep the client/server symmetry in mind: server tools operate over `VirtualFileSystem`, and the corresponding client handler in `FileSystemContext` should mirror the effect.

### Live Preview Pipeline

Preview logic is split between the transformer utilities and the iframe component.

**Transformation & import map** – `src/lib/transform/jsx-transformer.ts`:
- `transformJSX(code, filename, existingFiles)`:
  - Uses `@babel/standalone` with React + optional TypeScript presets to transpile `.js/.jsx/.ts/.tsx` files.
  - Strips out CSS imports from code, tracks them separately.
  - Collects imported specifiers (distinguishing CSS vs. JS) and returns `missingImports` and `cssImports` sets per file.
- `createImportMap(files: Map<string, string>)`:
  - Iterates over all virtual files, transforms JS/TSX files into blob URLs via `createBlobURL`, and builds a browser import map.
  - Seeds the map with core React / ReactDOM / JSX runtime imports pointing at `esm.sh`.
  - For third-party packages, adds `https://esm.sh/<pkg>` entries.
  - For local modules, creates multiple aliases per file (with/without leading `/`, with/without extension, and `@/` variants) so typical import styles resolve.
  - Collects all referenced `.css` files and inlines their content into a `<style>` tag; missing CSS imports are annotated in comments.
  - Creates placeholder modules for missing local imports (e.g., component imported but not yet created) using `createPlaceholderModule` to avoid hard failures.
  - Returns `{ importMap, styles, errors }`, where `errors` contains per-file transform errors.
- `createPreviewHTML(entryPoint, importMap, styles, errors)`:
  - Produces a full HTML document used as `iframe.srcdoc` by `PreviewFrame`.
  - Injects Tailwind via CDN, the synthesized import map, and any collected styles.
  - If there are transform errors, renders a styled “Syntax Errors” panel listing each file + message.
  - If there are no transform errors, renders a small `ErrorBoundary` React app and dynamically imports the entry module from the import map.

**Preview iframe component** – `src/components/preview/PreviewFrame.tsx`:
- Uses `useFileSystem()` to watch the current in-memory files via `getAllFiles()` and `refreshTrigger`.
- Keeps track of a preferred `entryPoint`, defaulting to `/App.jsx`, but falls back through:
  - `/App.tsx`, `/index.jsx`, `/index.tsx`, `/src/App.jsx`, `/src/App.tsx`.
  - Otherwise, the first `.jsx`/`.tsx` file in the VFS.
- On each update:
  - If no files exist yet, shows a first-load onboarding panel encouraging the user to ask AI for a component.
  - If there are files but no suitable entry point, shows a “No Preview Available” message suggesting creating `App.jsx`.
  - Otherwise, builds the import map + preview HTML and writes it into `iframe.srcdoc` with an appropriate `sandbox` attribute.

When changing how components are loaded or adding new file types, keep this virtualized bundling flow in mind.

### Persistence, Auth, and Anonymous Migration

**Database & Prisma**:
- Schema: `prisma/schema.prisma` defines `User` and `Project` models:
  - `User` has many `Project`s.
  - `Project` stores `messages` and `data` as serialized JSON strings, plus standard timestamps.
- Client: Prisma client is generated into `src/generated/prisma`, and `src/lib/prisma.ts` exports a singleton `prisma` with a dev-time global cache.

**Auth & sessions**:
- JWT-based session management lives in `src/lib/auth.ts`:
  - `createSession`, `getSession`, `deleteSession`, `verifySession` operate over an `auth-token` cookie.
  - Tokens embed `userId`, `email`, and an `expiresAt` date; expiration is also enforced by `jose` verification.
- Server actions for auth in `src/actions/index.ts`:
  - `signUp(email, password)` – creates users with bcrypt-hashed passwords and starts a session.
  - `signIn(email, password)` – verifies credentials and creates a session.
  - `signOut()` – clears the cookie and redirects to `/`.
  - `getUser()` – looks up the current user based on the session.

**Project lifecycle**:
- `createProject` (`src/actions/create-project.ts`) – creates a new project for the authenticated user with serialized `messages` and `data` from the virtual file system.
- `getProject` (`src/actions/get-project.ts`) – fetches & parses a single project, verifying that it belongs to the current user.
- `getProjects` (`src/actions/get-projects.ts`) – returns the user’s projects ordered by `updatedAt DESC` for UI lists and redirects.

**Anonymous work migration**:
- `src/lib/anon-work-tracker.ts`:
  - Stores a flag (`uigen_has_anon_work`) and a payload (`uigen_anon_data`) in `sessionStorage` while an anonymous user interacts with the chat + VFS.
- `src/hooks/use-auth.ts`:
  - After a successful sign-in/up, checks for anonymous work; if present, creates a new `Project` with that data, clears the anon storage, and routes to the new project.
  - If no anon work exists, routes to the most recent project or creates a new one.

### UI Components & Composition

Component directories are organized by concern under `src/components`:
- `chat/` – `ChatInterface`, `MessageList`, `MessageInput`, `MarkdownRenderer` (renders assistant content using `react-markdown`). These are driven exclusively by `ChatContext`.
- `editor/` – `CodeEditor`, `FileTree` backed by `FileSystemContext`.
- `preview/` – `PreviewFrame` (live iframe preview described above).
- `auth/` – authentication dialogs and forms built on top of the `useAuth` hook.
- `ui/` – shared primitives (buttons, dialogs, tabs, resizable panels, scroll-area, etc.), mostly Radix-based wrappers.

When adding new UI capabilities, prefer integrating with existing contexts (`useChat`, `useFileSystem`, `useAuth`) rather than reaching into lower-level modules directly.

### Middleware & API Protection

`src/middleware.ts` applies authentication on selected API paths:
- For now, `protectedPaths` includes `/api/projects` and `/api/filesystem` (JSON 401 if unauthenticated).
- The `matcher` excludes Next internal assets and static files but otherwise runs for most routes.

If you add new API routes that should be auth-protected, either:
- Update `protectedPaths` to include them, or
- Handle auth at the route level using `getSession`.

## When Extending the System

A few project-specific patterns extracted from CLAUDE rules and the existing code:
- **New tools for the AI**: implement tool logic in `src/lib/tools`, operating on `VirtualFileSystem`; wire them into `/api/chat`; then add corresponding client-side handling (if needed) in `FileSystemContext.handleToolCall`.
- **New file operations**: add primitives to `VirtualFileSystem` first, then surface them through `FileSystemContext` and any tools/UI that need them.
- **Preview behavior**: any new file types you want visible in the preview should be wired through `createImportMap` / `createPreviewHTML` and consumed by `PreviewFrame` using the same blob/import-map approach.
- **Persistence**: store only serialized VFS data and chat messages on the `Project` model; if you need additional per-project metadata, extend the Prisma schema and make sure server actions and `/api/chat`’s `onFinish` update it consistently.
