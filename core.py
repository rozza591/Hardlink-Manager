import os
import time
import logging
import xxhash
import json
import multiprocessing
import stat
import psutil
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor

# --- Helper Functions ---

def format_bytes(bytes_val, decimals=2):
    """Converts a byte value into a human-readable string (KB, MB, GB, etc.)."""
    if not isinstance(bytes_val, (int, float)) or bytes_val < 0: return '0 Bytes'
    if bytes_val == 0: return '0 Bytes'
    
    k = 1024
    dm = decimals if decimals >= 0 else 0
    sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    
    import math
    i = int(math.floor(math.log(bytes_val, k))) if bytes_val > 0 else 0
    i = min(i, len(sizes) - 1)
    
    return f"{bytes_val / (k**i):.{dm}f} {sizes[i]}"

def calculate_hash(filepath, block_size=65536):
    """
    Calculates the xxHash (64-bit) hash of a file efficiently.
    Reads the file in chunks to avoid loading large files into memory.
    Returns a tuple: (filepath, hexdigest) or (filepath, None) on error.
    """
    hasher = xxhash.xxh64()
    try:
        with open(filepath, 'rb') as f:
            while True:
                data = f.read(block_size); # Read in chunks
                if not data: break; # End of file
                hasher.update(data)
        return filepath, hasher.hexdigest() # Return path and the calculated hash
    except (IOError, OSError) as e:
        # Log warning if a file cannot be hashed (e.g., permission denied)
        logging.warning(f"Could not hash file {filepath}: {e}");
        return filepath, None # Indicate hash failure

def calculate_hash_partial(filepath, block_size=4096):
    """
    Calculates the xxHash of the first `block_size` bytes of a file.
    Used for quick pre-filtering of potential duplicates.
    """
    hasher = xxhash.xxh64()
    try:
        with open(filepath, 'rb') as f:
            data = f.read(block_size)
            hasher.update(data)
        return filepath, hasher.hexdigest()
    except (IOError, OSError) as e:
        logging.warning(f"Could not partial hash file {filepath}: {e}")
        return filepath, None

def update_progress(progress_dict, key, updates):
    """
    Safely updates a shared multiprocessing Manager dictionary used for progress tracking.
    Handles potential exceptions during dictionary updates in a concurrent environment.
    """
    try:
        # Get the current progress data for the key, or an empty dict if it doesn't exist
        current_data = progress_dict.get(key, {})
        # Merge the new updates into the current data
        current_data.update(updates)
        # Store the updated data back into the managed dictionary
        progress_dict[key] = current_data
    except Exception as e:
        # Log errors if updating progress fails
        logging.error(f"Error updating progress for key {key}: {e}")

def get_memory_usage_percent():
    """Returns the current system memory usage percentage."""
    try:
        return psutil.virtual_memory().percent
    except:
        return 0

def check_memory_and_warn(scan_id, progress_dict=None):
    """Checks RAM usage and logs warnings if it exceeds 80%."""
    mem_percent = get_memory_usage_percent()
    if mem_percent > 80:
        msg = f"WARNING: High memory usage ({mem_percent}%). Efficiency may decrease."
        logging.warning(f"[Scan {scan_id}] {msg}")
        if progress_dict:
            update_progress(progress_dict, scan_id, {"status": f"Low Memory: {mem_percent}%"})
    return mem_percent

def is_ignored(filepath, ignore_dirs, ignore_exts):
    """
    Checks if a file should be ignored based on directory names or file extension.
    """
    # Check extension
    if any(filepath.lower().endswith(ext) for ext in ignore_exts):
        return True
        
    # Check if any part of the path matches an ignored directory
    parts = filepath.split(os.sep)
    if any(d in parts for d in ignore_dirs):
        return True
        
    return False

def save_results_to_file(scan_id, results_data, output_dir):
     """
     Saves the scan results (summary and duplicate list, excluding raw data)
     as a JSON file in the specified output directory.
     Returns True on success, False on failure.
     """
     # Validate output directory
     if not os.path.isdir(output_dir):
          logging.error(f"[Scan {scan_id}] Auto-save Error: Output directory '{output_dir}' does not exist or is not accessible.")
          return False

     filename = f"scan_results_{scan_id}.json"
     filepath = os.path.join(output_dir, filename)

     # Prepare data for JSON serialization:
     # Create a copy to avoid modifying the original managed dict directly.
     serializable_results = results_data.copy()
     # Remove potentially large raw duplicate data before saving.
     serializable_results.pop("raw_duplicates", None)
     # Convert managed dict/list proxies to standard dict/list if necessary.
     if isinstance(serializable_results.get("summary"), multiprocessing.managers.DictProxy):
         serializable_results["summary"] = dict(serializable_results["summary"])
     if isinstance(serializable_results.get("duplicates"), multiprocessing.managers.ListProxy):
         serializable_results["duplicates"] = list(serializable_results["duplicates"])

     try:
         # Write the prepared data to the JSON file.
         with open(filepath, 'w') as f:
             json.dump(serializable_results, f, indent=4) # Use indent for readability
         logging.info(f"[Scan {scan_id}] Auto-save: JSON results saved to {filepath}")
         return True
     except (IOError, TypeError) as e:
         # Log errors during file writing or JSON serialization.
         logging.error(f"[Scan {scan_id}] Auto-save Error: Failed to save JSON results to {filepath}: {e}")
         return False

def perform_linking_logic(op_id, link_type, duplicate_sets_with_info, is_verification_step=True, link_progress_managed=None):
    """
    Core logic to replace duplicate files with hard or soft links.
    (No changes needed here as it primarily works with paths)

    Args:
        op_id (str): Identifier for the operation (can be scan_id or link_op_id).
        link_type (str): 'hard' or 'soft'.
        duplicate_sets_with_info (list): List of duplicate sets, where each set is a
                                         list of file info dicts [{'path':..., 'inode':..., 'hash':...}, ...],
                                         sorted with the intended original first.
        is_verification_step (bool): If True, indicates this is called from the separate link/verify process
                                     triggered by the UI, used for specific progress updates.
        link_progress_managed (multiprocessing.Manager.dict | None): Shared dict for progress updates.

    Returns:
        dict: Summary of the linking operation {'action_taken', 'files_linked', 'files_failed', 'op_name'}.
    """
    files_linked = 0; files_failed = 0
    link_op_name = "Hardlinking" if link_type == 'hard' else "Softlinking"
    # Choose the correct linking function based on type
    link_function = os.link if link_type == 'hard' else os.symlink
    # Calculate total number of links to create (one less than files per set)
    total_links_to_attempt = sum(len(s)-1 for s in duplicate_sets_with_info if len(s)>1)
    links_attempted = 0

    progress_key = op_id # Use the operation ID as the key for progress updates
    progress_dict = link_progress_managed # The dictionary to update

    # Initial progress update specifically for the linking phase (if called from verify step)
    if progress_dict and is_verification_step:
        update_progress(progress_dict, progress_key, {"phase": "Linking Files", "status": f"Starting {link_op_name.lower()}...", "total_items": total_links_to_attempt, "processed_items": 0})

    logging.info(f"[{op_id}] Performing {link_type} linking for {len(duplicate_sets_with_info)} sets ({total_links_to_attempt} links).")

    # Iterate through each set of duplicates
    for dupe_set_info in duplicate_sets_with_info:
        if len(dupe_set_info) < 2: continue # Skip sets with less than 2 files
        # Assume the first file in the sorted list is the original to keep
        original_path = dupe_set_info[0]['path']

        # Iterate through the rest of the files in the set (the duplicates to replace)
        for duplicate_item in dupe_set_info[1:]:
            duplicate_path = duplicate_item['path']
            links_attempted += 1
            try:
                 # --- Link Creation Steps ---
                 # 1. Check if original file still exists (important!)
                 if not os.path.exists(original_path):
                      raise FileNotFoundError(f"Original file missing: {original_path}")
                 # 2. Remove the duplicate file (use lexists to handle potential broken links)
                 if os.path.lexists(duplicate_path):
                      os.remove(duplicate_path)
                 else:
                      # Log if the duplicate was already gone (might happen in rare cases)
                      logging.warning(f"[{op_id}] Duplicate path did not exist before linking: {duplicate_path}")
                 # 3. Create the hard or soft link
                 link_function(original_path, duplicate_path)
                 files_linked += 1 # Increment success counter
            except OSError as link_err:
                 # Catch OS-level errors during remove/link (permissions, etc.)
                 files_failed += 1; logging.error(f"[{op_id}] Failed {link_op_name.lower()} '{duplicate_path}'->'{original_path}': {link_err}")
            except Exception as e:
                 # Catch any other unexpected errors during the process
                 files_failed += 1; logging.error(f"[{op_id}] Unexpected error linking '{duplicate_path}'->'{original_path}': {e}")

            # Update progress if a managed dictionary was provided
            if progress_dict:
                # Update periodically or on the last item
                if links_attempted % 10 == 0 or links_attempted == total_links_to_attempt:
                     percentage = round((links_attempted * 100) / total_links_to_attempt) if total_links_to_attempt else 100
                     update_progress(progress_dict, progress_key, {
                         "status": f"{link_op_name} {links_attempted}/{total_links_to_attempt}",
                         "processed_items": links_attempted,
                         "percentage": percentage
                     })

    # Final summary message
    action_taken = f"{link_op_name} complete. Linked: {files_linked}, Failed: {files_failed}."
    logging.info(f"[{op_id}] {action_taken}")
    # Return summary dictionary
    summary = { "action_taken": action_taken, "files_linked": files_linked, "files_failed": files_failed, "op_name": link_op_name }
    return summary

def run_manual_scan_and_link(scan_id, path1, dry_run, link_type, save_automatically, progress_info_managed, scan_results_managed, ignore_dirs=None, ignore_exts=None):
    """
    The main function executed in a separate process to perform the scan and optional linking.
    """
    result_data = {} # Initialize dictionary to store results
    try:
        start_time = time.time()
        # Initial progress update
        update_progress(progress_info_managed, scan_id, {"status":"Initializing...","phase":"init","total_items":0,"processed_items":0})
        logging.info(f"[Scan {scan_id}] Starting scan: path={path1}, dry_run={dry_run}, link_type={link_type}, save_auto={save_automatically}")

        # --- Phase 1: File Discovery and Size Grouping ---
        files_by_size = defaultdict(list) # {filesize: [{'path': ..., 'inode': ...}, ...]}
        total_files_found = 0; total_bytes_scanned = 0
        update_progress(progress_info_managed, scan_id, {"phase": "Finding Files", "status": "Walking directory..."})

        if ignore_dirs is None: ignore_dirs = []
        if ignore_exts is None: ignore_exts = []
        
        # Clean extensions (ensure they start with dot and are lowercase)
        clean_ignore_exts = [e.lower() if e.startswith('.') else f'.{e.lower()}' for e in ignore_exts]
        
        # Iterate through the top-level entries in the target directory
        for entry in os.scandir(path1):
            if entry.name in ignore_dirs: continue # Skip top-level ignored dirs
            if entry.is_dir(follow_symlinks=False):
                 # Recursively walk through subdirectories
                 for dirpath, dirs, filenames in os.walk(entry.path):
                     # Modify dirs in-place to skip ignored directories during walk
                     dirs[:] = [d for d in dirs if d not in ignore_dirs]
                     
                     # Update progress periodically for large directories
                     relative_dir = os.path.relpath(dirpath, path1)
                     status_update = f"Found {total_files_found} files. Scanning: .{os.sep}{relative_dir}"
                     if total_files_found % 100 == 0: update_progress(progress_info_managed, scan_id, {"status": status_update, "processed_items": total_files_found})
                     for filename in filenames:
                           filepath = os.path.join(dirpath, filename)
                           if is_ignored(filepath, [], clean_ignore_exts): continue # Check ext (dirs handled above)
                           try:
                               # Use lstat to get info without following symlinks
                               stat_info = os.lstat(filepath)
                               # Skip symbolic links during initial scan
                               if stat.S_ISLNK(stat_info.st_mode): continue
                               filesize = stat_info.st_size; fileinode = stat_info.st_ino
                               total_bytes_scanned += filesize
                               # Group files by size; only non-empty files are candidates for duplicates
                               if filesize > 0: files_by_size[filesize].append({'path': filepath, 'inode': fileinode}) # Store path and inode initially
                               total_files_found += 1
                               
                               # Memory check every 1000 files
                               if total_files_found % 1000 == 0:
                                   if check_memory_and_warn(scan_id, progress_info_managed) > 95:
                                       raise MemoryError("Memory usage exceeded 95%. Aborting scan to prevent system crash.")
                                       
                           except OSError as e: logging.warning(f"[Scan {scan_id}] Cannot access {filepath}: {e}")
            elif entry.is_file(follow_symlinks=False):
                 # Handle files directly in the root scanning directory
                 filepath = entry.path
                 if is_ignored(filepath, [], clean_ignore_exts): continue
                 try:
                     stat_info = entry.stat(follow_symlinks=False)
                     if stat.S_ISLNK(stat_info.st_mode): continue # Skip symlinks
                     filesize = stat_info.st_size; fileinode = stat_info.st_ino
                     total_bytes_scanned += filesize
                     if filesize > 0: files_by_size[filesize].append({'path': filepath, 'inode': fileinode}) # Store path and inode initially
                     total_files_found += 1
                 except OSError as e: logging.warning(f"[Scan {scan_id}] Cannot access {filepath}: {e}")

        # Update progress after directory walk
        update_progress(progress_info_managed, scan_id, {"total_items": total_files_found, "processed_items": total_files_found, "status": "Directory scan complete"})
        logging.info(f"[Scan {scan_id}] Phase 1: Found {total_files_found} files. Size: {format_bytes(total_bytes_scanned)}.")

        # --- Phase 1.5: Pre-hashing (Partial Hashing) ---
        # Filter groups: only sizes with more than one file are potential duplicates
        potential_duplicate_sizes = {s: f for s, f in files_by_size.items() if len(f) > 1}
        # Create a flat list of file info dictionaries for files that need hashing
        files_to_hash_info = [file_info for size, file_infos in potential_duplicate_sizes.items() for file_info in file_infos]
        potential_dupe_file_count = len(files_to_hash_info)
        
        # New structure for partial hashes: {(size, partial_hash): [file_info, ...]}
        files_by_partial_hash = defaultdict(list)
        
        if potential_dupe_file_count > 0:
            update_progress(progress_info_managed, scan_id, {"phase": "Pre-Hashing", "status": f"Quick checking {potential_dupe_file_count} files...", "total_items": potential_dupe_file_count, "processed_items": 0})
            filepaths_to_hash = [info['path'] for info in files_to_hash_info]
            info_map = {info['path']: info for info in files_to_hash_info}
            
            num_workers = max(1, os.cpu_count() // 2 if os.cpu_count() else 1)
            logging.info(f"[Scan {scan_id}] Starting parallel partial hash with {num_workers} workers.")
            
            partial_hashed_count = 0
            with ProcessPoolExecutor(max_workers=num_workers) as executor:
                hash_results = executor.map(calculate_hash_partial, filepaths_to_hash)
                for filepath, partial_hash in hash_results:
                    partial_hashed_count += 1
                    if partial_hash and filepath in info_map:
                         file_info = info_map[filepath]
                         try:
                             size = os.path.getsize(filepath)
                             files_by_partial_hash[(size, partial_hash)].append(file_info)
                         except OSError: pass
                    
                    if partial_hashed_count % 100 == 0:
                         percentage = round((partial_hashed_count * 100) / potential_dupe_file_count)
                         update_progress(progress_info_managed, scan_id, {"status": f"Quick Check {partial_hashed_count}/{potential_dupe_file_count}", "processed_items": partial_hashed_count, "percentage": percentage})

            logging.info(f"[Scan {scan_id}] Phase 1.5: Partial hashing complete.")

        # --- Phase 2: Full Hashing (Only for Partial Matches) ---
        files_by_hash = defaultdict(list) # {(size, hash): [file_info, ...]}
        
        # Filter: Only groups where partial hash matches (count > 1) need full hashing
        potential_full_hash_groups = {k: v for k, v in files_by_partial_hash.items() if len(v) > 1}
        files_to_full_hash_info = [f for group in potential_full_hash_groups.values() for f in group]
        full_hash_count_target = len(files_to_full_hash_info)
        
        hashed_file_count = 0
        update_progress(progress_info_managed, scan_id, {"phase": "Full Hashing", "status": f"Deep checking {full_hash_count_target} candidates...", "total_items": full_hash_count_target, "processed_items": 0})

        if full_hash_count_target > 0:
            filepaths_to_full_hash = [info['path'] for info in files_to_full_hash_info]
            info_map = {info['path']: info for info in files_to_full_hash_info}
            
            logging.info(f"[Scan {scan_id}] Starting full hash for {full_hash_count_target} files.")
            
            with ProcessPoolExecutor(max_workers=num_workers) as executor:
                # Map the calculate_hash function over the list of filepaths
                hash_results = executor.map(calculate_hash, filepaths_to_full_hash)
                # Process results as they complete
                for filepath, filehash in hash_results:
                    hashed_file_count += 1
                    if filehash and filepath in info_map:
                         # Get the original file info (path, inode)
                         file_info = info_map[filepath]
                         try:
                             # Double-check size
                             size = os.path.getsize(filepath)
                             # --- MODIFICATION START ---
                             # Add the hash to the file_info dictionary
                             file_info['hash'] = filehash
                             # --- MODIFICATION END ---
                             # Group files by (size, hash), storing the enriched file_info
                             files_by_hash[(size, filehash)].append(file_info)
                         except OSError as e:
                             logging.warning(f"[Scan {scan_id}] Could not get size for {filepath} after hashing: {e}")
                    # Update progress periodically or on completion
                    if hashed_file_count % 10 == 0 or hashed_file_count == full_hash_count_target:
                         percentage = round((hashed_file_count * 100) / full_hash_count_target) if full_hash_count_target else 100
                         update_progress(progress_info_managed, scan_id, {"status": f"Deep Check {hashed_file_count}/{full_hash_count_target}", "processed_items": hashed_file_count, "percentage": percentage})
        logging.info(f"[Scan {scan_id}] Phase 2: Hashing complete. Processed {hashed_file_count} files.")

        # --- Phase 3: Analyzing Hashes and Identifying Duplicate Sets ---
        update_progress(progress_info_managed, scan_id, {"phase": "Analyzing Hashes", "status": "Identifying sets..."})
        # Filter hash groups: only those with more than one file are actual duplicate sets
        # Note: duplicate_sets_raw now contains lists of dicts like {'path':.., 'inode':.., 'hash':..}
        duplicate_sets_raw = [files for files in files_by_hash.values() if len(files) > 1];
        total_duplicate_sets = len(duplicate_sets_raw)
        logging.info(f"[Scan {scan_id}] Phase 3: Found {total_duplicate_sets} duplicate sets.")

        # --- Calculate Savings and Format Results ---
        potential_savings = 0
        formatted_duplicates = [] # List to store sets formatted for UI display
        sets_already_linked_count = 0 # Count sets where all files already share the same inode

        for dupe_set_raw in duplicate_sets_raw:
            if len(dupe_set_raw) < 2: continue # Should not happen based on filter, but safety check
            inodes = set()
            valid_files_in_set = [] # Files confirmed to exist and not be symlinks
            filesize = 0
            try:
                # Check each file in the potential set again
                for file_info in dupe_set_raw:
                     stat_info = os.lstat(file_info['path'])
                     # Ensure it's a regular file (not a symlink or dir changed during scan)
                     if not stat.S_ISLNK(stat_info.st_mode) and os.path.isfile(file_info['path']):
                          inodes.add(stat_info.st_ino) # Collect inodes
                          # Store the whole file_info dict (including hash)
                          valid_files_in_set.append(file_info)
                          if filesize == 0: filesize = stat_info.st_size # Get size from first valid file
                     else:
                          # Log if an item in a hash-matched set is no longer a valid file
                          logging.warning(f"[Scan {scan_id}] Skipping non-file/link '{file_info['path']}' during analysis.")
            except OSError as e:
                 # Handle error if stating fails during this final check
                 logging.warning(f"[Scan {scan_id}] Error stating file during analysis '{dupe_set_raw[0]['path']}': {e}")
                 continue # Skip this set if error occurs

            # Need at least two valid files to form a duplicate set
            if len(valid_files_in_set) < 2: continue

            # Check if all valid files in the set share the same inode (already hardlinked)
            is_already_linked = len(inodes) == 1
            if is_already_linked:
                sets_already_linked_count += 1
            else:
                # Calculate potential savings: (number of duplicates) * filesize
                potential_savings += filesize * (len(valid_files_in_set) - 1)

            # Prepare the set for display in the UI
            size_info = f"Size: {format_bytes(filesize)}"
            formatted_set_display = []
            for file_info in valid_files_in_set:
                 # --- MODIFICATION START ---
                 # file_info already contains path, inode, and hash
                 file_info_copy = file_info.copy() # Create a copy
                 file_info_copy['already_linked'] = is_already_linked # Add flag for UI
                 # We don't need to explicitly add the hash here, it's already in file_info
                 # --- MODIFICATION END ---
                 formatted_set_display.append(file_info_copy)
            # Sort files within the set by path for consistent display
            sorted_formatted_set = sorted(formatted_set_display, key=lambda x: x['path'])
            # Add size info and the sorted list of file info dicts to the final list
            formatted_duplicates.append([size_info] + sorted_formatted_set)

        # Calculate theoretical size after linking
        after_size_theoretical = total_bytes_scanned - potential_savings
        # Sort the entire list of duplicate sets by the path of the first file in each set
        formatted_duplicates.sort(key=lambda set_data: set_data[1]['path'] if len(set_data) > 1 and isinstance(set_data[1], dict) else "")

        # --- Prepare Final Result Data ---
        # The 'duplicates' list now contains file dictionaries that include the 'hash' key
        result_data = {
            "summary": {
                "scan_path": path1,
                "no_duplicates": total_duplicate_sets == 0, # Flag if no duplicates found at all
                "potential_savings": potential_savings,     # Bytes saved if linking occurs
                "before_size": total_bytes_scanned,         # Total size of all scanned files
                "after_size": after_size_theoretical,      # Theoretical size after potential linking
                "action_taken": "Scan initializing.",       # Placeholder, updated later
                "files_linked": 0, "files_failed": 0,       # Updated if linking happens
                "is_dry_run": dry_run,                      # Was this a dry run?
                "duration": 0,                              # Scan duration, calculated at the end
                "sets_already_linked": sets_already_linked_count, # Count of sets found already hardlinked
                "total_sets_found": total_duplicate_sets      # Total sets with matching size/hash
            },
            "duplicates": formatted_duplicates, # Formatted list for UI (includes hash)
            "error": None,                      # Stores any error message
            # Store raw duplicate data ONLY if it's a dry run AND there are linkable sets,
            # needed for the "Perform Link" action later. Clear otherwise to save memory.
            # Raw data also includes the hash now.
            "raw_duplicates": [list(s) for s in duplicate_sets_raw] if dry_run and (total_duplicate_sets > sets_already_linked_count) else None
        }
        logging.info(f"[Scan {scan_id}] Analysis complete. Potential savings: {format_bytes(potential_savings)}. Sets already linked: {sets_already_linked_count}")

        # --- Phase 4: Perform Linking (if not dry_run) ---
        link_summary = {} # Stores results from the linking function
        sets_to_link_count = total_duplicate_sets - sets_already_linked_count
        if not dry_run and link_type and sets_to_link_count > 0:
            logging.info(f"[Scan {scan_id}] Starting {link_type} linking for {sets_to_link_count} sets.")
            update_progress(progress_info_managed, scan_id, {"phase": f"{link_type.capitalize()} Linking", "status": "Preparing to link..."})
            # Filter the raw sets to only include those not already linked
            # Note: inode check is still the definitive way to know if linking is needed
            sets_to_link_raw = [s for s in duplicate_sets_raw if len(s) > 1 and len(set(fi['inode'] for fi in s)) > 1]
            if sets_to_link_raw:
                # Sort sets and files within sets by path before linking for consistency
                sorted_sets_to_link = [sorted(s, key=lambda x: x['path']) for s in sets_to_link_raw]
                # Call the linking logic function
                # Pass `progress_info_managed` to update scan progress during linking phase
                link_summary = perform_linking_logic(scan_id, link_type, sorted_sets_to_link, is_verification_step=False, link_progress_managed=progress_info_managed)
                # Update the main result summary with linking stats (files_linked, files_failed, action_taken)
                result_data["summary"].update(link_summary)
                # Set error flag in main results if linking had failures
                if link_summary.get("files_failed", 0) > 0:
                    result_data["error"] = f"{link_summary.get('op_name','Linking')} completed with {link_summary['files_failed']} errors."
            else:
                # This case should be rare if sets_to_link_count > 0, but handles it
                logging.info(f"[Scan {scan_id}] No sets required linking despite initial count.")
                result_data["summary"]["action_taken"] = f"Scan complete. All {total_duplicate_sets} duplicate sets already appear linked."

        # --- Finalize Summary Action Message ---
        # Set a more descriptive action message if it wasn't set during linking.
        if result_data["summary"]["action_taken"] == "Scan initializing.":
            if dry_run:
                ready_text = f" {sets_to_link_count} sets ready to link." if sets_to_link_count > 0 else " All sets appear linked."
                already_linked_text = f" ({sets_already_linked_count} sets already linked)." if sets_already_linked_count > 0 else ""
                result_data["summary"]["action_taken"] = f"Dry run complete. Found {total_duplicate_sets} sets{already_linked_text}. Potential savings: {format_bytes(potential_savings)}.{ready_text}"
            elif total_duplicate_sets == 0:
                result_data["summary"]["action_taken"] = "Scan complete. No duplicates found."
            elif sets_to_link_count == 0 : # Non-dry run, but all sets were already linked
                 result_data["summary"]["action_taken"] = f"Scan complete. Found {total_duplicate_sets} duplicate sets, all already appear linked. No action taken."

        # --- Record Duration and Store Results ---
        end_time = time.time(); duration = end_time - start_time; result_data["summary"]["duration"] = duration
        # Store the final results in the managed dictionary
        scan_results_managed[scan_id] = result_data
        # Set final progress status
        final_status = "done" if not result_data.get("error") else "error"
        update_progress(progress_info_managed, scan_id, {"status": final_status, "percentage": 100, "phase": "Complete" if final_status == "done" else "Error"})
        logging.info(f"[Scan {scan_id}] Scan finished {duration:.2f}s. Final Status: {final_status}. Action: {result_data['summary']['action_taken']}")

        # --- Auto-save Results (if requested and successful) ---
        if save_automatically and final_status == "done":
            logging.info(f"[Scan {scan_id}] Auto-save requested. Attempting to save results to input directory: {path1}")
            # Attempt to save JSON
            json_saved = save_results_to_file(scan_id, result_data, path1)

            if not json_saved: # Check only JSON save status
                 logging.warning(f"[Scan {scan_id}] Auto-save failed for JSON file type.")

    # --- Error Handling for the entire scan process ---
    except FileNotFoundError: error_message = f"Path not found: {path1}"; logging.error(f"[Scan {scan_id}] {error_message}"); update_progress(progress_info_managed, scan_id, {"status": "error", "phase": "error"}); result_data={"error": error_message, "summary": {}, "duplicates": []}; scan_results_managed[scan_id] = result_data
    except PermissionError: error_message = f"Permission denied accessing path or subdirectories: {path1}"; logging.error(f"[Scan {scan_id}] {error_message}"); update_progress(progress_info_managed, scan_id, {"status": "error", "phase": "error"}); result_data={"error": error_message, "summary": {}, "duplicates": []}; scan_results_managed[scan_id] = result_data
    except Exception as e: error_message = f"Unexpected scan error: {e}"; logging.exception(f"[Scan {scan_id}] Error: "); update_progress(progress_info_managed, scan_id, {"status": "error", "phase": "error"}); result_data={"error": error_message, "summary": {}, "duplicates": []}; scan_results_managed[scan_id] = result_data


def link_process_worker(link_op_id, scan_id, link_type, link_progress_managed, link_results_managed, scan_results_managed):
    """
    Worker function run in a background process when linking is triggered from the UI
    after a dry run. It performs linking and then verifies the results.
    """
    files_verified = 0; verification_failed = 0; final_error = None; link_summary = {}; potential_savings = 0
    try:
         logging.info(f"[LinkOp {link_op_id}] Worker process started for scan {scan_id}, type {link_type}.")

         # --- Retrieve Original Scan Data ---
         original_scan_result_proxy = scan_results_managed.get(scan_id)
         if not original_scan_result_proxy: raise ValueError(f"Original scan result not found for ID {scan_id}")
         # Convert proxy to regular dict for easier access
         original_scan_result = dict(original_scan_result_proxy)
         # Get the raw duplicate data stored during the dry run (includes hash now, but not needed for linking)
         duplicate_sets_to_link = original_scan_result.get("raw_duplicates")
         if duplicate_sets_to_link is None:
             # This check prevents accidental re-linking or linking without valid dry run data
             raise ValueError("Original scan raw_duplicates missing for linking. Maybe linking already attempted?")
         # Get summary info (like potential savings) from the original scan
         original_summary = dict(original_scan_result.get("summary", {}))
         potential_savings = original_summary.get("potential_savings", 0)
         # Ensure sets are sorted for consistent linking (original first)
         sorted_sets_to_link = [sorted(s, key=lambda x: x['path']) for s in duplicate_sets_to_link if isinstance(s, list) and len(s) > 1]

         # --- Step 1: Perform Linking ---
         # Call the core linking logic, providing the link progress dict for updates
         link_summary = perform_linking_logic(link_op_id, link_type, sorted_sets_to_link, is_verification_step=True, link_progress_managed=link_progress_managed)
         # Store potential error message from linking phase
         if link_summary.get("files_failed", 0) > 0:
             final_error = f"{link_summary.get('op_name','Linking')} had {link_summary['files_failed']} errors."

         # --- Step 2: Verification (Still uses inodes/targets) ---
         total_items_to_verify = sum(len(s)-1 for s in sorted_sets_to_link) # Number of links created
         update_progress(link_progress_managed, link_op_id, {"phase": "Verifying Links", "status": "Checking results...", "processed_items": 0, "total_items": total_items_to_verify })
         logging.info(f"[LinkOp {link_op_id}] Starting verification step for {total_items_to_verify} items.");
         verification_items_processed = 0

         # Iterate through the sets again to check the links
         for dupe_set_info in sorted_sets_to_link:
              if len(dupe_set_info) < 2: continue
              original_info = dupe_set_info[0]; original_path = original_info['path']; original_inode = None
              try:
                  # Check if original still exists and get its inode
                  if not os.path.exists(original_path):
                      logging.warning(f"[LinkOp {link_op_id}] Verify: Original missing '{original_path}', cannot verify links in this set.");
                      # Mark all expected links in this set as failed verification
                      failed_count = len(dupe_set_info) - 1
                      verification_failed += failed_count
                      verification_items_processed += failed_count
                      update_progress(link_progress_managed, link_op_id, {"processed_items": verification_items_processed})
                      continue # Skip to the next set
                  original_inode = os.stat(original_path).st_ino
              except OSError as e:
                  logging.warning(f"[LinkOp {link_op_id}] Verify: Cannot stat original '{original_path}': {e}");
                  # Mark all expected links in this set as failed verification
                  failed_count = len(dupe_set_info) - 1; verification_failed += failed_count; verification_items_processed += failed_count; update_progress(link_progress_managed, link_op_id, {"processed_items": verification_items_processed}); continue # Skip set

              # Check each file that should have been linked
              for linked_info in dupe_set_info[1:]:
                   linked_path = linked_info['path']; verification_items_processed += 1; verified = False
                   try:
                        if link_type == 'hard':
                             # Verify Hard Link: Check path exists, is a file, and shares inode with original
                             if os.path.lexists(linked_path): # Use lexists to check link itself
                                 linked_inode = os.lstat(linked_path).st_ino
                                 # Use isfile to ensure it's not e.g. a broken link pointing to a dir
                                 if linked_inode == original_inode and os.path.isfile(linked_path):
                                      files_verified += 1; verified = True
                                 else:
                                     logging.warning(f"[LinkOp {link_op_id}] Verify FAIL (inode/type mismatch): '{linked_path}' (Inode: {linked_inode if 'linked_inode' in locals() else 'N/A'}) != Orig Inode: ({original_inode}) or not a file.")
                             else:
                                 # Link path doesn't even exist
                                 logging.warning(f"[LinkOp {link_op_id}] Verify FAIL (missing): '{linked_path}' was not found.")
                        elif link_type == 'soft':
                             # Verify Soft Link: Check path exists, is a link, and points to the original's real path
                             if os.path.islink(linked_path):
                                 target = os.readlink(linked_path)
                                 # Resolve both target and original to absolute paths for reliable comparison
                                 abs_target = os.path.realpath(os.path.join(os.path.dirname(linked_path), target))
                                 abs_original = os.path.realpath(original_path)
                                 if abs_target == abs_original:
                                     files_verified += 1; verified = True
                                 else:
                                     logging.warning(f"[LinkOp {link_op_id}] Verify FAIL (target mismatch): Link '{linked_path}' points to '{target}' (resolves to '{abs_target}') but original resolves to '{abs_original}'.")
                             else:
                                 # Path exists but is not a symbolic link
                                 logging.warning(f"[LinkOp {link_op_id}] Verify FAIL (not a link): '{linked_path}' exists but is not a symbolic link.")
                   except OSError as verify_err:
                        # Handle errors during verification checks (e.g., permissions)
                        logging.error(f"[LinkOp {link_op_id}] Verify ERROR checking link status for '{linked_path}': {verify_err}")
                   except Exception as general_err:
                        # Catch unexpected errors during verification
                        logging.error(f"[LinkOp {link_op_id}] Unexpected error during verification of '{linked_path}': {general_err}")

                   # If verification failed for any reason for this link
                   if not verified: verification_failed += 1

                   # Update verification progress periodically
                   if verification_items_processed % 10 == 0 or verification_items_processed == total_items_to_verify:
                        percentage = round((verification_items_processed * 100) / total_items_to_verify) if total_items_to_verify else 100
                        update_progress(link_progress_managed, link_op_id, {"status": f"Verifying {verification_items_processed}/{total_items_to_verify}", "processed_items": verification_items_processed, "percentage": percentage})

         logging.info(f"[LinkOp {link_op_id}] Verification complete. Verified OK: {files_verified}, Failed/Missing: {verification_failed}")

         # --- Prepare Final Link Operation Result ---
         final_result = {
             # Combine action messages from linking and verification
             "summary": link_summary.get("action_taken", "Linking finished.") + f" Verification: {files_verified} OK, {verification_failed} Failed/Missing.",
             "files_linked": link_summary.get("files_linked", 0),
             "files_failed": link_summary.get("files_failed", 0),
             "files_verified": files_verified,
             "verification_failed": verification_failed,
             # Report actual space saved only if verification passed completely
             "space_saved": potential_savings if verification_failed == 0 else "Verification failed, savings uncertain",
             # Combine any linking error with potential verification failure message
             "error": final_error or (f"Verification failed for {verification_failed} items." if verification_failed > 0 else None)
         }
         # Store the final result for this link operation
         link_results_managed[link_op_id] = final_result
         # Update progress to done
         update_progress(link_progress_managed, link_op_id, {"status": "done", "percentage": 100})
         logging.info(f"[LinkOp {link_op_id}] Worker process finished.")

         # --- Update Original Scan Result ---
         # Modify the original scan result to reflect that linking was performed and clear raw data.
         current_scan_result_proxy = scan_results_managed.get(scan_id)
         if current_scan_result_proxy:
             current_scan_result = dict(current_scan_result_proxy) # Convert proxy
             current_scan_summary = dict(current_scan_result.get("summary", {})) # Convert inner proxy
             # Append note about linking being triggered
             current_scan_summary["action_taken"] = current_scan_summary.get("action_taken", "Dry run.") + " (Linking performed via UI)"
             # Store updated summary back
             current_scan_result["summary"] = current_scan_summary
             # Remove the raw duplicate data as it's no longer needed for linking
             current_scan_result["raw_duplicates"] = None
             # Save the modified scan result back to the managed dictionary
             scan_results_managed[scan_id] = current_scan_result

    except Exception as e:
         # Catch any broad exception during the link worker process
         error_message = f"Background link process error: {e}"; logging.exception(f"[LinkOp {link_op_id}] Error:")
         # Update progress to error status
         update_progress(link_progress_managed, link_op_id, {"status": "error", "percentage": 100})
         # Store an error result for the link operation
         link_results_managed[link_op_id] = {"error": error_message, "summary": "Linking failed.", "files_linked": 0, "files_failed": 0, "files_verified": files_verified, "verification_failed": verification_failed}
