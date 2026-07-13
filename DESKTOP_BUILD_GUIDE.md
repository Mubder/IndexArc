# IndexArc Desktop Builder & Compilation Guide

This guide details the exact steps to build **IndexArc** into a fully offline, native Windows executable (`.exe`) file, as well as native installers for macOS (`.dmg`) and Linux (`.AppImage`).

The desktop app is powered by **Electron** coupled with a high-performance **Express + SQLite Database Server** running in the background. When the `.exe` starts, Electron boots the Express server as a background daemon, verifies that database connections are active, and renders the high-fidelity UI.

---

## 🚀 Step 1: Exporting Your Codebase
To build native binaries, you must execute the compiler on your physical machine or matching development environment:
1. Open the **Settings Menu** (Gear icon in top-right of AI Studio).
2. Select **Export to GitHub** or **Download ZIP**.
3. Unzip the code and open the directory in your local terminal or IDE (e.g., VS Code).

---

## 🛠️ Step 2: System Prerequisites
Before building, make sure your local machine has standard runtime environments installed:
- **Node.js** (v18.0.0 or higher recommended)
- **NPM** (comes pre-bundled with Node)

---

## 📦 Step 3: Installation & Dev Test
Run these commands in your local project root:

```bash
# 1. Install all base, server, and desktop toolchains
npm install

# 2. Start the app in desktop developer mode to test
npm run desktop
```
This boots the database server on port `3000` locally and opens the **IndexArc Desktop** workspace with Chrome Developer Tools active for inspection.

---

## 🏗️ Step 4: Compiling to a Standalone Executable (.exe)

When you are ready to compile the final release executable, use the integrated `electron-builder` scripts configured inside your `package.json`:

### Option A: Build Portable Executable & Installer (For Windows)
If you are on a Windows machine, run:
```bash
npm run desktop:dist
```
- **What this does**: It runs a production-optimized build of the React client, bundles your Express database server using `esbuild` into a self-contained background script (`dist/server.cjs`), and triggers `electron-builder` to compile.
- **Output Directory**: `dist-desktop/`
- **Generated Files**:
  - `IndexArc Setup 1.0.0.exe` — A lightweight, step-by-step setup installer.
  - `IndexArc-1.0.0-win.zip` — A portable compressed package (no install required, just unzip and run).

### Option B: Fast Package Inspection (Unpackaged Directory)
To verify files and configurations inside the compiled build without packaging them into a single installer:
```bash
npm run desktop:pack
```
This generates a fast-access native binary inside `dist-desktop/win-unpacked/IndexArc.exe` which you can launch immediately.

---

## 🎨 Advanced Target Configurations
If you wish to distribute your app across other operating systems, `electron-builder` supports cross-compilation targets inside the `build` section of `package.json`:

- **macOS Compilation** (Produces `.dmg` and `.zip`):
  - Run `npm run desktop:dist` on a Mac computer.
  - Outputs under `dist-desktop/IndexArc-1.0.0.dmg`.
- **Linux Compilation** (Produces `.AppImage` and `.tar.gz`):
  - Run `npm run desktop:dist` on a Linux machine (or using WSL/Docker).
  - Outputs under `dist-desktop/IndexArc-1.0.0.AppImage`.

---

## 🔍 How the Desktop Architecture Works Under the Hood
1. **Background Daemon Fork**: `electron-main.cjs` forks the Express database server using Node's `child_process.fork()` mechanism.
2. **Port Guard & Polling**: The main window is kept hidden or loading until the server's `/api/status` endpoint returns `200 OK`.
3. **Hard-Kill Protocol**: When the user clicks the exit button or closes the Electron window, a `will-quit` hook is fired, hard-terminating the backend database server process so no orphan background tasks stay running.
