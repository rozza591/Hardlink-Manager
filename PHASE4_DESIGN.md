# Phase 4 Design Document: Advanced Features

This document outlines the design for the next iteration of the Hardlink Manager application.

## 1. User Authentication
**Objective**: Secure the application for multi-user or public-facing server environments.
**Plan**:
- Use `Flask-Login` for session management.
- Simple SQLite user database (`users.db`).
- Login page (HTML template).
- Decorate routes with `@login_required`.
- Default: Single "admin" user created via `docker-compose` ENV variables.

## 2. File Content Preview / Safety
**Objective**: Allow users to verify files before linking without leaving the UI.
**Plan**:
- **Preview Endpoint**: `/preview_file/<path_hash>` (Serving by hash prevents arbitrary path traversal attacks).
- **UI Modal**: Shows text content (first 4KB) or image thumbnail.
- **Safety**: Only allow preview of files in the scanned directories.

## 3. Smart Selection Rules
**Objective**: Automate selection of "Best Original" to link against.
**Plan**:
- **Rules Engine**:
  - "Keep Oldest File" (Creation Time)
  - "Keep Newest File"
  - "Keep Shallowest Path" (Shortest directory depth)
  - "Keep file matching regex" (e.g., maintain `Archive/` folder structure)
- **UI**: Dropdown in "Scan Options" or "Results" to "Auto-select Duplicates".

## 4. Historical Analytics
**Objective**: Show long-term savings.
**Plan**:
- **Database**: Migrate from in-memory `scan_results` to SQLite `history.db`.
- **Metrics**: 
  - Total space saved over time.
  - Number of files processed.
  - Chart.js visualization of history.
