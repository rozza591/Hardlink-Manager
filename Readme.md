![hardlink-manager-banner](https://github.com/user-attachments/assets/510986dd-9172-4ab1-b534-8e2764b74ed7)

## Overview

Hardlink Manager is a powerful, web-based tool designed to optimize disk space by finding duplicate files and replacing them with hard links or symbolic links. Built with performance and safety in mind, it provides a comprehensive interface for managing large-scale file systems, reporting potential savings, and performing linking operations with built-in verification and undo capabilities.

## Features

*   **⚡ Optimized Duplicate Detection:** 
    *   **Size-based Pre-filtering:** Instantly groups files by size.
    *   **Phase-based Hashing:** Uses `xxHash` (64-bit) for high-performance verification.
    *   **Pre-hashing (Phase 1.5):** Performs partial hashing of large files for lightning-fast candidate elimination.
    *   **Inode Awareness:** Automatically detects files that are already hard-linked.
*   **🔗 Flexible Linking Options:**
    *   **Hard Linking:** Replaces duplicates with hard links (pointing to the same inode).
    *   **Soft Linking (Symlinks):** Replaces duplicates with symbolic links.
    *   **Selective Linking:** Manually select specific sets or individual files to link after a dry run.
    *   **Linking Strategies:** Choose between oldest file, newest file, or shortest path to keep as the "original".
*   **🛡️ Safety & Reliability:**
    *   **Dry Run Mode:** Safe simulation showing potential savings and hashes without modifying files.
    *   **Post-Link Verification:** Automatically verifies every link created to ensure filesystem integrity.
    *   **Undo System:** Reverses any linking operation by restoring the original files from internal logs.
    *   **Memory Management:** Monitors system RAM usage and provides warnings or halts during heavy scans to prevent system instability.
*   **⏰ Automation & Scheduling:**
    *   **Built-in Scheduler:** Schedule recurring scans (Daily, Weekly, Monthly, or Custom Cron) to keep your filesystem optimized automatically.
*   **📊 Advanced Web Interface:**
    *   **Real-time Progress:** Adaptive polling with phase indicators, percentage completion, and ETA.
    *   **Hashing Micro-Progress:** Detailed per-file progress tracking during the deep check phase, showing exactly which files are being hashed and their individual percentages.
    *   **Pause/Resume & Cancel:** Full control over long-running scan processes.
    *   **Client-side Pagination & Filtering:** Easily manage thousands of results with path searching and size filtering.
    *   **Visual Analytics:** Bar charts showing space used vs. space saved.
    *   **File Preview:** Integrated text preview for quickly identifying file contents.
    *   **Dark Mode:** Sleek, modern UI with persistent dark/light mode preference.
*   **📋 Reporting:**
    *   **PDF Reports:** Professional scan summaries generated via ReportLab.
    *   **JSON Export:** Download full scan data for external analysis.

## Setup & Running

### Using Docker (Recommended)

1.  **Prerequisites:** Docker and Docker Compose installed.
2.  **Configure Volume:** Edit the `docker-compose.yml` file. 
    *   **UNRAID TIP:** Map direct disk paths (e.g., `/mnt/cache/share`) instead of `/mnt/user/share` to bypass FUSE overhead for significantly faster scans.
    *   Set `PORT` environment variable (default is 5000).

    ```yaml
    # docker-compose.yml
    services:
      web:
        build: .
        ports:
          - "5000:5000"
        volumes:
          - /path/to/your/data/on/host:/data
        environment:
          - LOG_LEVEL=INFO
          - PORT=5000
    ```

3.  **Build and Run:**
    ```bash
    docker-compose up --build -d
    ```

4.  **Access:** Open `http://localhost:5000`.

### Manual Setup

1.  **Prerequisites:** Python 3.8+ installed.
2.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
    *Core dependencies: Flask, xxhash, reportlab, psutil, apscheduler.*
3.  **Run the App:**
    ```bash
    python app.py
    ```
4.  **Access:** Open `http://localhost:5001` (default port when running manually).

## Usage Guide

1.  **Scanning:**
    *   Enter the **Directory Path** (relative to the application root or `/data` in Docker).
    *   Configure **Ignore Settings** (comma-separated directories or extensions to skip).
    *   Set a **Minimum File Size** to ignore small files.
    *   Click **Start Scan**.
2.  **Reviewing:**
    *   Use the **Filters** to drill down into specific subdirectories or larger files.
    *   Use the **Eye Icon (👁️)** to preview text-based files.
    *   Use the **Clipboard Icon (📋)** to copy full file paths.
3.  **Linking:**
    *   After a **Dry Run**, use the checkboxes to select the sets you wish to link.
    *   Choose your **Linking Strategy** (e.g., "Oldest File" to keep the oldest file as the source).
    *   Click **Perform Link**.
4.  **Managing:**
    *   Visit the **Scheduler** modal to set up recurring maintenance tasks.
    *   If a link was made in error, check the **Undo Logs** (available in the internal `undo_logs/` directory and via the UI for recent jobs) to revert changes.

## How It Works

1.  **Discovery:** Recursively walks the filesystem ignoring symlinks and user-defined ignore patterns.
2.  **Group by Size:** Only files with identical sizes (meeting the min-size threshold) are considered.
3.  **Pre-Hashing (Phase 1.5):** Reads only the first few KB of each candidate file. This eliminates 90% of false positives before the heavy work begins.
4.  **Full Hashing (Phase 2):** Calculates the 64-bit `xxHash` digest of remaining candidates using parallel process pooling to maximize CPU utilization. Real-time micro-progress is reported for each file being processed.
5.  **Refinement:** Groups files by size+hash and checks inodes to determine if linking is actually required.
6.  **Action:** Performs atomic `os.remove` followed by `os.link` or `os.symlink`. Each action is logged to an undo file for safety.

## Roadmap

*   [x] Adaptive progress tracking with ETA.
*   [x] Selective linking and strategy selection.
*   [x] Built-in scheduling system.
*   [x] Undo functionality.
*   [x] PDF reporting support.
*   [ ] Duplicate removal (deletion instead of linking).
*   [ ] Multi-path scanning (comparing different roots).
*   [ ] xxh3 hashing upgrade for even faster performance.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for bugs, feature requests, or improvements.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

