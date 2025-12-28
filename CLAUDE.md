# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UIGen is an AI-powered React component generator with live preview. It uses Claude AI to generate React components dynamically based on user prompts, displaying them in real-time using a virtual file system. The app supports both authenticated users (with project persistence) and anonymous users (session-based).

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4
- **AI Integration**: Anthropic Claude API via Vercel AI SDK with streaming responses
- **Database**: Prisma with SQLite
- **Code Transformation**: Babel Standalone for JSX/TSX compilation
- **Code Editor**: Monaco Editor
- **Testing**: Vitest with React Testing Library

## Development Commands

```bash
# Initial setup (install deps, generate Prisma client, run migrations)
npm run setup

# Development server with Turbopack
npm run dev

# Build for production
npm run build

# Run production server
npm start

# Linting
npm run lint

# Run all tests
npm test

# Reset database (careful!)
npm run db:reset

# Generate Prisma client after schema changes
npx prisma generate

# Create database migration
npx prisma migrate dev --name <migration_name>
```

## Testing

- **Framework**: Vitest with jsdom environment
- **Test Location**: Tests are colocated in `__tests__` directories next to the source files
- **Run tests**: `npm test`
- **Run specific test file**: `npx vitest <path-to-test-file>`
- **Config**: See `vitest.config.mts`

## Code Style

Use comments sparingly. Only comment complex code.

## Architecture

### Virtual File System

The core architecture revolves around a **VirtualFileSystem** class (`src/lib/file-system.ts`) that maintains an in-memory representation of files and directories. No files are written to disk during generation.

- **VirtualFileSystem class**: Manages files/directories with methods like `createFile()`, `updateFile()`, `deleteFile()`, `rename()`
- **Serialization**: Files are serialized to/from JSON for database persistence
- **FileSystemContext** (`src/lib/contexts/file-system-context.tsx`): React context that wraps VirtualFileSystem, provides tool call handlers, and manages file selection state

### AI Chat Integration

The AI chat system streams responses from Claude and handles tool calls to manipulate the virtual file system:

- **Chat API Route** (`src/app/api/chat/route.ts`): Handles streaming responses using `streamText()` from Vercel AI SDK
- **Tools**: Two custom tools are provided to Claude:
  - `str_replace_editor`: View, create, edit files with string replacement or line insertion
  - `file_manager`: Rename or delete files/folders
- **ChatContext** (`src/lib/contexts/chat-context.tsx`): Manages chat state and integrates with FileSystemContext to apply tool calls
- **System Prompt** (`src/lib/prompts/generation.tsx`): Instructs Claude to create React components with Tailwind CSS, always starting with `/App.jsx` as the entry point

### Live Preview System

Components are rendered in real-time using client-side module transformation:

1. **JSX Transformation** (`src/lib/transform/jsx-transformer.ts`):
   - Uses Babel Standalone to compile JSX/TSX to JavaScript
   - Creates ES module import maps with blob URLs for each file
   - Handles `@/` import alias (points to root directory `/`)
   - Resolves third-party packages via esm.sh CDN
   - Extracts and injects CSS files
   - Collects syntax errors for display

2. **Preview Frame** (`src/components/preview/PreviewFrame.tsx`):
   - Generates complete HTML document with import maps
   - Injects Tailwind CSS via CDN
   - Renders React app in iframe with error boundary
   - Displays syntax errors with formatted error messages

3. **Entry Point**: Every project must have `/App.jsx` that exports a default React component

### Authentication & Persistence

- **Auth** (`src/lib/auth.ts`): JWT-based authentication with bcrypt password hashing
- **Middleware** (`src/middleware.ts`): Protects routes and validates sessions
- **Anonymous Users**: Can use the app without signing in; work is tracked in localStorage via `src/lib/anon-work-tracker.ts`
- **Registered Users**: Projects are saved to database with messages and file system state
- **Database Schema** (`prisma/schema.prisma`):
  - `User`: id, email, password (hashed)
  - `Project`: id, name, userId (nullable), messages (JSON), data (JSON - serialized VFS)

### Component Structure

- **Editor** (`src/components/editor/`):
  - `CodeEditor.tsx`: Monaco editor with TypeScript/JavaScript support
  - `FileTree.tsx`: Tree view of virtual file system

- **Chat** (`src/components/chat/`):
  - `ChatInterface.tsx`: Main chat UI container
  - `MessageList.tsx`: Displays messages with tool call indicators
  - `MessageInput.tsx`: Textarea for user input
  - `MarkdownRenderer.tsx`: Renders assistant responses with syntax highlighting

- **Preview** (`src/components/preview/`):
  - `PreviewFrame.tsx`: Iframe-based live preview

### Actions (Server Actions)

- `src/actions/create-project.ts`: Create new project for authenticated users
- `src/actions/get-projects.ts`: List user's projects
- `src/actions/get-project.ts`: Load specific project with messages and file system

## Key Implementation Details

### Import Resolution

The app uses `@/` as an import alias for the root directory. When generating code, Claude creates imports like:

```javascript
import Calculator from '@/components/Calculator'
```

The JSX transformer resolves these to blob URLs at runtime. All file paths in the virtual file system start with `/`.

### AI Tool Integration

Tools are defined using Vercel AI SDK's `tool()` function with Zod schemas. When Claude invokes a tool:

1. The tool executes on the server-side VirtualFileSystem
2. The result is sent to Claude
3. The `onToolCall` callback in ChatContext applies the same change to the client-side VirtualFileSystem
4. React re-renders the editor and preview

### API Key Configuration

- **Optional**: The app can run without an Anthropic API key
- **With API key**: Set `ANTHROPIC_API_KEY` in `.env`
- **Without API key**: A mock provider returns static code instead of using Claude
- **Provider selection**: See `src/lib/provider.ts`

### Prisma Setup

- **Generated client location**: `src/generated/prisma` (non-standard location)
- **Database**: SQLite at `prisma/dev.db`
- **Import**: Always import from `@/lib/prisma` which provides a singleton client

## Common Patterns

### Creating a New Tool

1. Define tool in `src/lib/tools/<tool-name>.ts`
2. Export function that accepts `VirtualFileSystem` and returns tool definition
3. Add tool to `tools` object in `src/app/api/chat/route.ts`
4. Add tool call handler in `FileSystemContext.handleToolCall()` if client-side updates needed

### Adding New File Operations

1. Add method to `VirtualFileSystem` class
2. If exposed to AI, create/update tool definition
3. Add handler in `FileSystemContext` if needed
4. Update serialization if the operation affects how files are stored

### Working with the Preview

The preview automatically refreshes when the file system changes (via `refreshTrigger` in FileSystemContext). Syntax errors are caught during transformation and displayed in the preview frame.
