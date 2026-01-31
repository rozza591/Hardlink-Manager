import os
import logging
import uuid
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_from_directory, Response
import multiprocessing
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import atexit

# Import logic from the new core module
# Import logic from the new core module
from core import run_manual_scan_and_link, link_process_worker, undo_link_operation
from report_generator import generate_pdf_report

# --- Flask App Setup ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', os.urandom(24)) # Secret key for session management

# --- Logging Configuration ---
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=log_level, format='%(asctime)s - %(levelname)s - %(processName)s - %(message)s')

# --- Shared State Placeholders ---
# These specific variables will be initialized with multiprocessing.Manager objects 
# inside the __main__ block to ensure safe processing on macOS/Window (spawn method).
manager = None
progress_info = {} 
scan_results = {}
link_progress = {}
link_results = {}


# --- Flask Routes ---

@app.route("/run_scan", methods=["POST"])
def run_scan():
    """
    API endpoint to start a new scan/link process based on form data.
    It queues the job to run in a separate process using multiprocessing.
    """
    # Log received form data for debugging
    logging.info(f"Received form data: {request.form.to_dict()}")

    # Extract parameters from the form
    path1 = request.form.get("path1"); # Target directory
    dry_run = "dryrun" in request.form # Is it a dry run?
    use_hardlinks = "hardlink" in request.form; use_softlinks = "softlink" in request.form # Link type selection
    save_auto = "save_auto" in request.form
    
    # Parse ignore lists
    ignore_dirs_str = request.form.get("ignore_dirs", "")
    ignore_dirs = [d.strip() for d in ignore_dirs_str.split(",") if d.strip()]
    
    ignore_exts_str = request.form.get("ignore_exts", "")
    ignore_exts = [e.strip() for e in ignore_exts_str.split(",") if e.strip()]

    # Parse minimum file size
    min_file_size = 0
    try:
        min_size_val = int(request.form.get("min_file_size", 0))
        min_size_unit = request.form.get("min_file_size_unit", "MB")
        unit_multipliers = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3}
        min_file_size = min_size_val * unit_multipliers.get(min_size_unit, 1024**2)
    except (ValueError, TypeError):
        min_file_size = 0

    # Determine link type (None if dry_run or no link type selected)
    link_type = None;
    if use_hardlinks: link_type = 'hard'
    elif use_softlinks: link_type = 'soft'

    # Basic validation
    if not path1:
        logging.error(f"Validation failed: path1 is missing or empty in received data.")
        return jsonify({"error": "Directory path required."}), 400 # Bad request

    # Generate a unique ID for this scan
    scan_id = str(uuid.uuid4())
    # Initialize progress and result entries in the shared dictionaries
    progress_info[scan_id] = {"status":"queued","phase":"queued","total_items":0,"processed_items":0, "percentage": 0}
    scan_results[scan_id] = None # Placeholder for results

    logging.info(f"Queuing scan {scan_id} for path: {path1}. Ignoring dirs: {ignore_dirs}, exts: {ignore_exts}, min_size: {min_file_size}")

    # --- Create and Start Background Process ---
    process = multiprocessing.Process(
        target=run_manual_scan_and_link, # Function to run in the new process
        # Pass the new ignore lists and min file size to the target function
        args=(scan_id, path1, dry_run, link_type, save_auto, progress_info, scan_results, ignore_dirs, ignore_exts, min_file_size),
        name=f"Scan-{scan_id[:6]}"
    )
    process.start() # Start the background process

    # Return the scan ID to the frontend so it can poll for progress
    return jsonify({"status": "scan process started", "scan_id": scan_id})

@app.route("/cancel_scan/<scan_id>", methods=["POST"])
def cancel_scan(scan_id):
    """
    API endpoint to request cancellation of a running scan.
    Sets a cancellation flag that the scan process checks periodically.
    """
    progress = progress_info.get(scan_id)
    if not progress:
        return jsonify({"error": "Scan ID not found"}), 404
    
    current_status = dict(progress).get("status", "unknown")
    
    # Only allow cancellation if scan is still running
    if current_status in ["done", "error", "cancelled"]:
        return jsonify({"error": f"Scan already {current_status}, cannot cancel"}), 400
    
    # Set cancellation flag
    logging.info(f"Cancellation requested for scan {scan_id}")
    progress_info[scan_id] = {**dict(progress), "cancel_requested": True}
    
    return jsonify({"status": "cancellation requested", "scan_id": scan_id})

@app.route("/pause_scan/<scan_id>", methods=["POST"])
def pause_scan(scan_id):
    progress = progress_info.get(scan_id)
    if not progress: return jsonify({"error": "Scan ID not found"}), 404
    progress_info[scan_id] = {**dict(progress), "paused": True}
    return jsonify({"status": "paused", "scan_id": scan_id})

@app.route("/resume_scan/<scan_id>", methods=["POST"])
def resume_scan(scan_id):
    progress = progress_info.get(scan_id)
    if not progress: return jsonify({"error": "Scan ID not found"}), 404
    progress_info[scan_id] = {**dict(progress), "paused": False}
    return jsonify({"status": "resumed", "scan_id": scan_id})

@app.route("/undo_link/<op_id>", methods=["POST"])
def undo_link(op_id):
    """
    Triggers an undo operation for a specific link job.
    """
    # Check if undo logic is available/file exists happens in worker, 
    # but we could quickly check existence here.
    # Launch background process
    p = multiprocessing.Process(
        target=undo_link_operation, 
        args=(op_id, link_progress),
        name=f"Undo-{op_id[:6]}"
    )
    p.start()
    return jsonify({"status": "undo_started", "op_id": op_id, "monitor_key": f"undo_{op_id}"})

@app.route("/get_progress/<scan_id>")
def get_progress(scan_id):
    """API endpoint for the frontend to poll for scan progress updates."""
    progress = progress_info.get(scan_id) # Retrieve progress data from shared dict
    if not progress:
        # Scan ID not found (might be invalid, old, or cleared)
        return jsonify({"error": "Scan ID not found", "status": "unknown"}), 404

    # Convert managed proxy to regular dict for modification/serialization
    progress_data = dict(progress)

    # Calculate percentage based on current state
    total = progress_data.get("total_items", 0)
    processed = progress_data.get("processed_items", 0)
    status = progress_data.get("status", "unknown")
    phase = progress_data.get("phase", "N/A")

    if status == "done" or status == "error":
        progress_data["percentage"] = 100 # Ensure 100% on final states
    elif status == "queued" or phase == "init":
        progress_data["percentage"] = 0 # Initial state is 0%
    elif total > 0:
        # Calculate percentage, ensuring processed doesn't exceed total
        processed = min(processed, total);
        progress_data["percentage"] = round((processed * 100) / total)
    else:
        # Avoid division by zero if total is 0 (e.g., during initialization)
        progress_data["percentage"] = 0

    return jsonify(progress_data) # Return current progress state

@app.route("/get_results/<scan_id>")
def get_results_route(scan_id):
    """
    API endpoint for the frontend to retrieve the final results of a completed scan.
    Only returns results if the scan status is 'done' or 'error'.
    Also indicates if results are available for download.
    """
    progress = progress_info.get(scan_id); # Check progress first
    result = scan_results.get(scan_id)   # Get results data

    if not progress:
        # Scan ID not found
        return jsonify({"error": "Scan ID not found", "status": "unknown"}), 404

    current_status = dict(progress).get("status", "unknown")

    # If scan is still running, return a pending status
    if current_status not in ["done", "error"]:
        return jsonify({"status": "pending", "message": "Scan is still in progress."}), 202 # Accepted, but not complete

    # If status is done/error, but results are somehow missing (shouldn't happen ideally)
    if result is None:
        logging.warning(f"Scan {scan_id} status '{current_status}' but result is None.");
        return jsonify({"error": "Internal error: Results missing.", "status": "error"}), 500 # Internal server error

    # Prepare results for frontend: convert proxies, remove raw data
    frontend_result = dict(result) # Convert main proxy
    # Determine if download should be offered (scan must be 'done' and have no errors)
    download_available = current_status == "done" and not frontend_result.get("error")
    frontend_result["download_json_available"] = download_available
    frontend_result["download_pdf_available"] = False # PDF download is removed

    # Clean up data before sending to frontend
    frontend_result.pop("raw_duplicates", None) # Don't send large raw list
    # Convert internal proxies to standard types for JSON serialization
    if isinstance(frontend_result.get("summary"), multiprocessing.managers.DictProxy):
        frontend_result["summary"] = dict(frontend_result["summary"])
    if isinstance(frontend_result.get("duplicates"), multiprocessing.managers.ListProxy):
        frontend_result["duplicates"] = list(frontend_result["duplicates"])

    return jsonify(frontend_result) # Return the processed results

@app.route("/download_results/<scan_id>/<file_format>")
def download_results(scan_id, file_format):
    """
    API endpoint to generate and stream scan results as a downloadable file (JSON only).
    """
    result_proxy = scan_results.get(scan_id)
    progress_proxy = progress_info.get(scan_id)

    # Validate scan ID and ensure results/progress exist
    if not result_proxy or not progress_proxy:
        return jsonify({"error": "Scan ID not found or results expired."}), 404
    result_data = dict(result_proxy)
    progress_data = dict(progress_proxy)

    # Only allow download if scan completed successfully
    if progress_data.get("status") != "done" or result_data.get("error"):
        return jsonify({"error": "Cannot download: Scan did not complete successfully."}), 400

    if file_format.lower() == 'json':
        # Prepare data for JSON export (similar to get_results)
        export_data = { "scan_id": scan_id, "summary": {}, "duplicates": [] }
        summary = result_data.get("summary", {})
        duplicates = result_data.get("duplicates", [])
        # Convert proxies
        export_data["summary"] = dict(summary) if isinstance(summary, multiprocessing.managers.DictProxy) else summary
        export_data["duplicates"] = list(duplicates) if isinstance(duplicates, multiprocessing.managers.ListProxy) else duplicates

        try:
            # Serialize data to JSON string
            json_output = json.dumps(export_data, indent=4)
            filename = f"scan_results_{scan_id}.json"
            # Return as a Flask Response with correct mimetype and headers for download
            return Response(
                json_output,
                mimetype="application/json",
                headers={"Content-Disposition": f"attachment;filename={filename}"}
            )
        except TypeError as e:
            # Handle potential errors during JSON serialization
            logging.error(f"Error serializing JSON for download (Scan {scan_id}): {e}")
            return jsonify({"error": "Internal server error: Could not create JSON file."}), 500

    else:
        # Invalid format requested
        return jsonify({"error": "Invalid file format requested (use 'json')."}), 400


@app.route("/perform_link/<scan_id>", methods=["POST"])
def perform_link_route(scan_id):
    """
    API endpoint triggered by the UI to start a linking operation based on a
    previous successful dry run scan.
    """
    link_type = request.form.get("link_type") # 'hard' or 'soft'
    
    # Parse optional selected indices (JSON list of integers)
    selected_indices_json = request.form.get("selected_indices")
    selected_indices = None
    if selected_indices_json:
        try:
            selected_indices = json.loads(selected_indices_json)
            if not isinstance(selected_indices, list):
                selected_indices = None
        except (ValueError, TypeError):
            # If parsing fails, default to linking all (None)
            selected_indices = None

    # Validate link type
    if not link_type or link_type not in ['hard', 'soft']:
        return jsonify({"error": "Invalid link type specified ('hard' or 'soft')."}), 400

    # Retrieve the original scan results
    original_scan_result_proxy = scan_results.get(scan_id)
    if not original_scan_result_proxy:
        # Original scan must exist
        return jsonify({"error": "Original scan ID not found or results expired."}), 404

    # Convert proxies to dicts
    original_scan_result = dict(original_scan_result_proxy)
    original_summary = dict(original_scan_result.get("summary", {}))

    # --- Sanity Checks ---
    # 1. Ensure the original scan was actually a dry run
    if not original_summary.get("is_dry_run", False):
        return jsonify({"error": "Linking is only possible based on a completed dry run scan."}), 400
    # 2. Ensure the raw duplicate data needed for linking exists
    if original_scan_result.get("raw_duplicates") is None:
        return jsonify({"error": "Cannot link: Original scan data is missing or linking already attempted for this scan."}), 400
    # 3. Ensure there were potential savings (i.e., linkable sets found)
    if original_summary.get("potential_savings", 0) <= 0:
        return jsonify({"error": "No linkable duplicate sets found in the original scan (all might be already linked)."}), 400

    # Generate a unique ID for this linking operation
    link_op_id = str(uuid.uuid4())
    # Initialize progress and result entries for the link operation
    link_progress[link_op_id] = {"status":"queued","phase":"queued","total_items":0,"processed_items":0,"percentage":0,"scan_id":scan_id} # Store original scan_id for reference
    link_results[link_op_id] = None

    logging.info(f"Starting background link operation {link_op_id} based on scan {scan_id} (type: {link_type})")

    # --- Create and Start Background Link/Verify Process ---
    process = multiprocessing.Process(
        target=link_process_worker, # Function to run
        args=(link_op_id, scan_id, link_type, link_progress, link_results, scan_results, selected_indices), # Arguments
        name=f"Link-{link_op_id[:6]}" # Process name
    )
    process.start()

    # Return the link operation ID to the frontend
    return jsonify({"status": "linking process started", "link_op_id": link_op_id})

@app.route("/get_link_progress/<link_op_id>")
def get_link_progress(link_op_id):
    """API endpoint for the frontend to poll for linking/verification progress."""
    progress = link_progress.get(link_op_id) # Get progress from shared dict
    if not progress:
        # Link operation ID not found
        return jsonify({"error": "Link operation ID not found", "status": "unknown"}), 404

    # Convert proxy and calculate percentage (similar to get_progress)
    progress_data = dict(progress)
    total = progress_data.get("total_items", 0)
    processed = progress_data.get("processed_items", 0)
    status = progress_data.get("status", "unknown")
    phase = progress_data.get("phase", "N/A")

    if status == "done" or status == "error": progress_data["percentage"] = 100
    elif status == "queued" or phase == "queued": progress_data["percentage"] = 0
    elif total > 0: processed = min(processed, total); progress_data["percentage"] = round((processed * 100) / total)
    else: progress_data["percentage"] = 0

    return jsonify(progress_data) # Return current progress

@app.route("/get_link_result/<link_op_id>")
def get_link_result(link_op_id):
    """
    API endpoint for the frontend to retrieve the final results of a completed
    linking/verification operation. Also checks if download for the *original*
    scan results is still available.
    """
    progress = link_progress.get(link_op_id); # Check progress first
    result = link_results.get(link_op_id)   # Get link operation result

    if not progress:
        # Link operation ID not found
        return jsonify({"error": "Link operation ID not found", "status": "unknown"}), 404

    current_status = dict(progress).get("status", "unknown")

    # If link op still running, return pending
    if current_status not in ["done", "error"]:
        return jsonify({"status": "pending", "message": "Linking operation still in progress."}), 202

    # Handle case where status is done/error but result is missing
    if result is None:
        logging.warning(f"LinkOp {link_op_id} status '{current_status}' but result is None.");
        return jsonify({"error": "Internal error: Link results missing.", "status": "error"}), 500

    # Prepare link results for frontend
    final_result = dict(result) # Convert proxy
    # Convert internal proxies if necessary (though summary is usually the only complex type here)
    if isinstance(final_result.get("summary"), multiprocessing.managers.DictProxy):
        final_result["summary"] = dict(final_result["summary"])

    # --- Check Download Availability for the *Original* Scan ---
    # Retrieve the original scan ID associated with this link operation
    scan_id = dict(progress).get("scan_id")
    original_scan_proxy = scan_results.get(scan_id) if scan_id else None
    original_scan_data = dict(original_scan_proxy) if original_scan_proxy else {}
    original_progress_proxy = progress_info.get(scan_id) if scan_id else None
    original_progress_data = dict(original_progress_proxy) if original_progress_proxy else {}

    # Determine if the *original* scan results can still be downloaded
    download_available = (scan_id and original_scan_proxy is not None and
                          original_progress_data.get("status") == "done" and
                          not original_scan_data.get("error"))

    # Add download availability flags to the *link result* response
    final_result["download_json_available"] = download_available
    final_result["download_pdf_available"] = False # PDF download is typically for scan results

    return jsonify(final_result)

@app.route("/download_pdf/<scan_id>")
def download_pdf_route(scan_id):
    """
    Generates and returns a PDF report for the specified scan.
    """
    result_proxy = scan_results.get(scan_id)
    if not result_proxy: return jsonify({"error": "Scan ID not found"}), 404

    try:
        # Convert proxy to dict
        result_data = dict(result_proxy)
        if isinstance(result_data.get("summary"), multiprocessing.managers.DictProxy):
            result_data["summary"] = dict(result_data["summary"])
        if isinstance(result_data.get("duplicates"), multiprocessing.managers.ListProxy):
            result_data["duplicates"] = list(result_data["duplicates"])

        filename = f"scan_report_{scan_id}.pdf"
        output_path = os.path.join(os.getcwd(), filename) # Save to CWD momentarily
        
        # Generate PDF
        success = generate_pdf_report(result_data, output_path)
        
        if success and os.path.exists(output_path):
            # Send file and then remove it? send_file handles open files, usually safest to keep or use tempfile.
            # Using send_from_directory is easier if path is known.
            return send_from_directory(os.getcwd(), filename, as_attachment=True)
        else:
            return jsonify({"error": "Failed to generate PDF."}), 500

    except Exception as e:
        logging.error(f"PDF Generation Error: {e}")
        return jsonify({"error": f"Internal error: {e}"}), 500


@app.route("/get_results/<scan_id>")
def get_results_route(scan_id):
    """
    API endpoint for the frontend to retrieve the final results of a completed scan.
    Only returns results if the scan status is 'done' or 'error'.
    """
    # Check if scan exists in the results dictionary
    result_proxy = scan_results.get(scan_id)
    if not result_proxy:
        # If not in results, check if it's still in progress or queued
        progress = progress_info.get(scan_id)
        if progress:
             # Scan exists but not finished
             return jsonify({"status": progress.get("status", "unknown")})
        return jsonify({"error": "Scan ID not found"}), 404
        
    # Convert proxy to regular dict
    final_result = dict(result_proxy)

    # Determine availability of downloadables
    download_available = False
    try:
        # Check if JSON file exists
        file_path = f"scan_results_{scan_id}.json"
        if os.path.exists(file_path): download_available = True
    except Exception: pass
    
    final_result["download_json_available"] = download_available
    final_result["download_pdf_available"] = True # PDF download is now available


@app.route("/clear_cache", methods=["POST"])
def clear_cache():
    """
    API endpoint to clear all stored scan and link results from the
    multiprocessing Manager dictionaries, freeing up memory.
    Does not affect currently running operations.
    """
    logging.info("Received request to clear cached results (multiprocessing).")
    # Get keys before clearing for logging purposes
    scan_ids = list(progress_info.keys())
    link_ids = list(link_progress.keys())

    # Clear the shared dictionaries
    progress_info.clear()
    scan_results.clear()
    link_progress.clear()
    link_results.clear()

    logging.info(f"Cleared {len(scan_ids)} scans and {len(link_ids)} link ops from managed memory.")
    return jsonify({"message": "In-memory results cleared."})

@app.route("/")
def index():
    """Serves the main HTML page (frontend UI)."""
    # Renders the index.html template located in the 'templates' folder
    return render_template("index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    """Serves static files (CSS, JavaScript, images) used by the frontend."""
    static_folder = os.path.join(app.root_path, 'static'); # Path to the 'static' folder
    if not os.path.isdir(static_folder):
        # Log error if static folder doesn't exist
        logging.error(f"Static folder not found: {static_folder}");
        return "Static folder not configured", 404
    # Use Flask's send_from_directory to safely serve files from the static folder
    return send_from_directory(static_folder, filename)


# --- Scheduler Setup ---
scheduler = BackgroundScheduler()
SCHEDULE_FILE = "schedules.json"

def trigger_scheduled_scan(task_id, path, options):
    """
    Wrapper to start a scan from the scheduler.
    """
    scan_id = str(uuid.uuid4())
    logging.info(f"Starting scheduled scan {scan_id} for {path} (Task {task_id})")
    
    # Initialize progress
    progress_info[scan_id] = {"status": "queued", "phase": "init", "total_items": 0, "processed_items": 0, "percentage": 0}
    scan_results[scan_id] = None
    
    # Extract options
    dry_run = options.get("dry_run", True)
    link_type = options.get("link_type", None) # Default None for scan only
    save_auto = options.get("save_auto", True)
    min_file_size = options.get("min_file_size", 0)
    
    # Start process
    p = multiprocessing.Process(
        target=run_manual_scan_and_link,
        args=(scan_id, path, dry_run, link_type, save_auto, progress_info, scan_results, None, None, min_file_size),
        name=f"SchedScan-{scan_id[:6]}"
    )
    p.start()

def load_schedules():
    if not os.path.exists(SCHEDULE_FILE): return
    try:
        with open(SCHEDULE_FILE, 'r') as f:
            jobs = json.load(f)
            for job in jobs:
                # Add check to prevent duplicate jobs on reload if dynamic
                if not scheduler.get_job(job['id']):
                    scheduler.add_job(
                        func=trigger_scheduled_scan,
                        trigger=CronTrigger.from_crontab(job['cron']),
                        id=job['id'],
                        name=job['name'],
                        args=[job['id'], job['path'], job['options']],
                        replace_existing=True
                    )
        logging.info(f"Loaded {len(jobs)} scheduled jobs.")
    except Exception as e:
        logging.error(f"Error loading schedules: {e}")

@app.route("/get_schedules")
def get_schedules():
    if not os.path.exists(SCHEDULE_FILE): return jsonify([])
    try:
        with open(SCHEDULE_FILE, 'r') as f:
            return jsonify(json.load(f))
    except: return jsonify([])

@app.route("/add_schedule", methods=["POST"])
def add_schedule():
    data = request.json
    job_id = str(uuid.uuid4())
    name = data.get("name", "Untitled Schedule")
    cron = data.get("cron") # "m h dom mon dow"
    path = data.get("path")
    options = data.get("options", {})
    
    if not cron or not path: return jsonify({"error": "Missing cron or path"}), 400
    
    new_job = {
        "id": job_id,
        "name": name,
        "cron": cron,
        "path": path,
        "options": options,
        "created_at": str(datetime.now())
    }
    
    # Load existing, append, save
    jobs = []
    if os.path.exists(SCHEDULE_FILE):
        try:
            with open(SCHEDULE_FILE, 'r') as f: jobs = json.load(f)
        except: pass
    
    jobs.append(new_job)
    with open(SCHEDULE_FILE, 'w') as f: json.dump(jobs, f, indent=4)
    
    # Add to runtime scheduler
    try:
        scheduler.add_job(
            func=trigger_scheduled_scan,
            trigger=CronTrigger.from_crontab(cron),
            id=job_id,
            name=name,
            args=[job_id, path, options]
        )
        return jsonify({"status": "created", "job": new_job})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/delete_schedule/<job_id>", methods=["DELETE"])
def delete_schedule(job_id):
    # Remove from file
    jobs = []
    if os.path.exists(SCHEDULE_FILE):
        try:
            with open(SCHEDULE_FILE, 'r') as f: jobs = json.load(f)
        except: pass
    
    jobs = [j for j in jobs if j['id'] != job_id]
    with open(SCHEDULE_FILE, 'w') as f: json.dump(jobs, f, indent=4)
    
    # Remove from runtime
    try:
        if scheduler.get_job(job_id): scheduler.remove_job(job_id)
        return jsonify({"status": "deleted"})
    except:
        return jsonify({"status": "deleted_file_only"}) # Job might not have been in runtime

# --- Main Execution ---
if __name__ == "__main__":
    # freeze_support() is necessary for multiprocessing on Windows when freezing the app (e.g., with PyInstaller)
    # freeze_support() is necessary for multiprocessing on Windows when freezing the app (e.g., with PyInstaller)
    multiprocessing.freeze_support()

    # --- Shared State Initialization ---
    # Performed here to prevent recursive initialization in child processes (spawn/forkserver)
    import sys
    try:
        if sys.platform != 'darwin':
            # Force 'fork' for Linux as per original requirement, but skip on macOS
            multiprocessing.set_start_method('fork')
    except RuntimeError:
        pass # Context already set
    
    manager = multiprocessing.Manager()
    progress_info = manager.dict()
    scan_results = manager.dict()
    link_progress = manager.dict()
    link_results = manager.dict()

    # --- Start Scheduler ---
    if not scheduler.running:
        scheduler.start()
    load_schedules()
    atexit.register(lambda: scheduler.shutdown())

    logging.info("Starting Flask app with multiprocessing background tasks for Web UI.")
    # Run the Flask development server
    # host="0.0.0.0" makes it accessible on the network
    # threaded=False is often recommended when using multiprocessing
    # debug=False should be used in production
    port = int(os.environ.get("PORT", 5001))
    app.run(debug=False, host="0.0.0.0", port=port, threaded=False)