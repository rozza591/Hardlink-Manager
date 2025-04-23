![hardlink-manager-banner](https://github.com/user-attachments/assets/510986dd-9172-4ab1-b534-8e2764b74ed7)

## Overview

Hardlink Manager is a web-based tool designed to find duplicate files within a specified directory and optionally replace them with hard links or soft links (symbolic links). This helps save disk space by storing only one copy of identical files while maintaining the directory structure. The application provides a user-friendly interface to initiate scans, view results (including file hashes), and perform linking operations safely.

## Features

* **Duplicate File Detection:** Identifies duplicate files based on file size first, followed by xxHash hashing for confirmation.
* **Linking Options:**
    * **Hard Linking:** Replaces duplicate files with hard links pointing to a single original file inode.
    * **Soft Linking (Symbolic Links):** Replaces duplicate files with symbolic links pointing to the path of the original file.
* **Dry Run Mode:** Allows scanning and viewing potential duplicates (with hashes) and space savings without making any changes to the filesystem.
* **Space Savings Calculation:** Reports the potential or actual disk space saved by linking duplicates.
* **Web Interface:** Provides an easy-to-use web UI built with Flask for managing scans and viewing results.
* **Progress Tracking:** Shows the real-time progress of scan and link operations.
* **Result Downloads:** Allows downloading scan results in JSON format.
* **Dark Mode:** Includes a toggle for user interface preference.
* **Background Processing:** Uses Python's `multiprocessing` to run scans and linking operations in the background without blocking the UI.
* **Docker Support:** Includes a `docker-compose.yml` for easy containerized deployment.
* **Verification (Post-Dry Run):** After linking (initiated via the UI post-dry run), it verifies if the links were created successfully.

## Light and Dark mode for WebUI

<img width="1920" alt="Screenshot 2025-04-23 at 11 39 09" src="https://github.com/user-attachments/assets/f3b06f17-0e3e-48c6-bd07-80616eed1ddf" />


<img width="1920" alt="Screenshot 2025-04-23 at 11 39 18" src="https://github.com/user-attachments/assets/add8fbd7-25c9-40a7-bbb0-63a7a06001a8" />



## Setup & Running

### Using Docker (Recommended)

1.  **Prerequisites:** Docker and Docker Compose installed.
2.  **Configure Volume:** Edit the `docker-compose.yml` file. Change the `source` path in the `volumes` section to the directory on your *host* machine that you want the container to access. The `target` should generally remain `/data`, as this is the path you will use within the application's UI.

    ```yaml
    # docker-compose.yml
    version: '3.8'
    services:
      web:
        build: .
        ports:
          - "5000:5000" # Map container port 5000 to host port 5000
        volumes:
          - type: bind
            # --- CHANGE THIS to the directory on your host ---
            source: /path/to/your/data/on/host
            # --- Keep this as the target path inside the container ---
            target: /data
        environment:
          - LOG_LEVEL=INFO # Optional: Change to DEBUG for more logs
    ```

3.  **Build and Run:** Navigate to the project directory in your terminal and run:
    ```bash
    docker-compose up --build -d
    ```
    The `-d` flag runs the container in detached mode.

4.  **Access:** Open your web browser and go to `http://<your-server-ip>:5000` (or `http://localhost:5000` if running locally).

### Manual Setup (Optional)

1.  **Prerequisites:** Python 3.x and pip installed.
2.  **Install Dependencies:** Navigate to the project directory and install the required Python packages from `requirements.txt`:
    ```bash
    pip install -r requirements.txt
    ```
3.  **Run the App:** Execute the Flask application script `app.py`:
    ```bash
    python app.py
    ```
4.  **Access:** Open your web browser and go to `http://localhost:5000`. **Note:** When running manually, the application can only access paths visible to the user running the Python script.

## Usage Guide

1.  **Access the UI:** Navigate to the application's URL (e.g., `http://localhost:5000`).
2.  **Start a Scan:**
    * **Directory Path:** Enter the full path to the directory you want to scan *as seen by the application*. If using Docker with the recommended volume mapping, this will likely start with `/data/`.
    * **Operation:** Choose `Hard-link`, `Soft-link`, or `Dry Run`. **Dry Run is strongly recommended first.**
    * **(Optional) Auto-Save:** Check the box if you want the JSON results automatically saved to the *scanned directory* (requires write permissions for the server process).
    * Click **"Start Scan"**.
3.  **Monitor Progress:** A status bar will appear showing the current phase (Finding Files, Hashing, Linking, Verifying, etc.) and progress percentage.
4.  **Review Results:** Once complete, the results section appears:
    * **Summary Stats:** Shows overall status, sizes, potential/actual savings, duration, etc.
    * **Download:** A "Download JSON" button appears if the scan completed successfully.
    * **Link Actions (Dry Run Only):** If the scan was a Dry Run and linkable duplicates were found, buttons appear allowing you to perform the actual hard or soft linking based on *this specific scan's results*.
    * **Duplicates List:** Displays each set of duplicate files.
        * Each file path is listed.
        * The file's **xxHash** (shortened, full hash on hover) is shown in brackets `[Hash: ...]`.
        * Sets where files are already hard-linked (share the same inode) are marked as "Already Linked".
        * The first file listed in a linkable set is typically kept as the source, and others are replaced by links.
5.  **Perform Linking (After Dry Run):**
    * **Warning:** Linking modifies your files by deleting duplicates and replacing them with links. Use with caution.
    * If satisfied with the Dry Run results, click "Perform Hard Link" or "Perform Soft Link".
    * Confirm the action in the browser prompt.
    * The status UI will show progress for linking and verification.
    * The Summary Stats will update with the final linking/verification results.
6.  **Clear Results:** Click "Clear Results" to remove the results display and clear the backend cache for completed jobs. This does not stop running operations.

## How It Works

1.  **File Discovery:** Recursively scans the target directory, ignoring symbolic links initially.
2.  **Size Grouping:** Groups files by size. Only files with identical, non-zero sizes are considered potential duplicates.
3.  **Hashing:** Calculates the 64-bit xxHash for each file in the potential duplicate size groups using parallel processing. Files with the same size *and* the same hash are considered duplicates.
4.  **Inode Check (Internal):** Although the hash is displayed, the application still checks inodes internally to identify sets that are *already* hardlinked.
5.  **Reporting (Dry Run):** In Dry Run mode, reports the findings (duplicate sets, hashes, already linked status, potential savings) without altering files.
6.  **Linking (Optional):** If linking is requested, selects one file per duplicate set as the 'original' and replaces the other identical files with hard or soft links. It attempts to delete the duplicate file before creating the link.
7.  **Verification (After UI Link):** After linking via the UI, verifies hard links by checking inodes and soft links by resolving targets.

## Dependencies

* Flask
* xxhash
* *(pdfkit was removed)*

*(Note: If running manually, ensure Python 3.x and pip are installed.)*

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for bugs, feature requests, or improvements.

## License

*(Choose a license, e.g., MIT License. Add the license file to your repo.)*

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
