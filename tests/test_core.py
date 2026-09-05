import os
import pytest
import xxhash
from core import format_bytes, calculate_hash, update_progress, perform_linking_logic, link_process_worker, undo_link_operation

# --- Tests for Helper Functions ---

def test_format_bytes():
    assert format_bytes(0) == "0 Bytes"
    assert format_bytes(100) == "100.00 Bytes"
    assert format_bytes(1024) == "1.00 KB"
    assert format_bytes(1024 * 1024) == "1.00 MB"
    assert format_bytes(123456789) == "117.74 MB"
    assert format_bytes(None) == "0 Bytes"
    assert format_bytes(-1) == "0 Bytes"

def test_calculate_hash(tmp_path):
    # Create a dummy file
    d = tmp_path / "test_data"
    d.mkdir()
    p = d / "hello.txt"
    p.write_text("Hello World!")
    
    # xxHash3 hash for "Hello World!"
    expected_hash = xxhash.xxh3_64(b"Hello World!").hexdigest()
    
    filepath, hash_val = calculate_hash(str(p))
    assert filepath == str(p)
    assert hash_val == expected_hash

def test_calculate_hash_missing_file():
    filepath, hash_val = calculate_hash("/non/existent/file.txt")
    assert filepath == "/non/existent/file.txt"
    assert hash_val is None

def test_calculate_hash_partial_returns_partial_hash(tmp_path):
    # Create a test file with known content > 4KB
    p = tmp_path / "testfile.txt"
    content = b"a" * 5000
    p.write_bytes(content)
    
    # Calculate expected hash for first 4096 bytes using xxHash3
    import xxhash
    expected_hash = xxhash.xxh3_64(content[:4096]).hexdigest()
    
    # Run function
    from core import calculate_hash_partial
    path, result_hash = calculate_hash_partial(str(p))
    
    assert path == str(p)
    assert result_hash == expected_hash

def test_calculate_hash_partial_small_file(tmp_path):
    # File smaller than 4KB
    p = tmp_path / "small.txt"
    content = b"small content"
    p.write_bytes(content)
    
    import xxhash
    expected_hash = xxhash.xxh3_64(content).hexdigest()
    
    from core import calculate_hash_partial
    path, result_hash = calculate_hash_partial(str(p))
    
    assert result_hash == expected_hash

def test_update_progress():
    mock_dict = {}
    key = "scan-123"
    updates = {"status": "scanning", "percent": 10}
    
    # We need to simulate the Manager dict somewhat or just pass a real dict (since logic handles it)
    # The function expects 'progress_dict' to be dict-like.
    from core import update_progress
    update_progress(mock_dict, key, updates)
    assert mock_dict[key] == updates
    
    # Test merge
    updates2 = {"percent": 50}
    update_progress(mock_dict, key, updates2)
    assert mock_dict[key]["status"] == "scanning"
    assert mock_dict[key]["percent"] == 50

    
    # Test overwrite
    update_progress(mock_dict, key, {"status": "done"})
    assert mock_dict[key]["status"] == "done"

def test_ignore_logic(tmp_path):
    # Setup:
    # root/
    #   include.txt
    #   ignore.log (bad ext)
    #   ignore_dir/ (bad dir)
    #     nested.txt
    
    root = tmp_path / "scan_root"
    root.mkdir()
    (root / "include.txt").write_text("content")
    (root / "ignore.log").write_text("content")
    
    ign_dir = root / "ignore_dir"
    ign_dir.mkdir()
    (ign_dir / "nested.txt").write_text("content")
    
    # We will mock the scan function logic roughly here or just test the helper if we extract it.
    # Since filter logic is embedded in run_manual_scan_and_link, let's integration test it 
    # OR extract filter logic to a helper. 
    # For now, let's assume we extract `is_ignored(path, ignore_dirs, ignore_exts)` helper in core.
    
    from core import is_ignored
    
    # Test Extension
    assert is_ignored("path/to/ignore.log", [], [".log"]) == True
    assert is_ignored("path/to/include.txt", [], [".log"]) == False
    
    # Test Directory (simple)
    # Note: is_ignored usually checks full path against dir list? 
    # Or strict dir name matching? Plan said "Directory name in ignore_dirs"
    assert is_ignored("/path/to/ignore_dir/file.txt", ["ignore_dir"], []) == True
    assert is_ignored("/path/to/clean/file.txt", ["ignore_dir"], []) == False


def _file_info(path):
    stat_info = path.stat()
    return {
        "path": str(path),
        "inode": stat_info.st_ino,
        "device": stat_info.st_dev,
        "size": stat_info.st_size,
        "mtime": stat_info.st_mtime,
        "hash": xxhash.xxh3_64(path.read_bytes()).hexdigest(),
    }


def test_link_failure_preserves_duplicate(tmp_path, monkeypatch):
    import core
    original = tmp_path / "original.txt"
    duplicate = tmp_path / "duplicate.txt"
    original.write_text("same")
    duplicate.write_text("same")
    monkeypatch.setattr(core, "UNDO_DIR", tmp_path / "undo")
    monkeypatch.setattr(core.os, "link", lambda *args: (_ for _ in ()).throw(OSError("failed")))

    result = perform_linking_logic("failure", "hard", [[_file_info(original), _file_info(duplicate)]])

    assert result["files_failed"] == 1
    assert duplicate.read_text() == "same"


def test_link_rejects_file_changed_since_scan(tmp_path, monkeypatch):
    import core
    original = tmp_path / "original.txt"
    duplicate = tmp_path / "duplicate.txt"
    original.write_text("same")
    duplicate.write_text("same")
    duplicate_info = _file_info(duplicate)
    duplicate.write_text("changed")
    monkeypatch.setattr(core, "UNDO_DIR", tmp_path / "undo")

    result = perform_linking_logic("stale", "hard", [[_file_info(original), duplicate_info]])

    assert result["files_failed"] == 1
    assert duplicate.read_text() == "changed"


def test_delete_verification_and_selected_savings(tmp_path, monkeypatch):
    import core
    original = tmp_path / "original.txt"
    duplicate = tmp_path / "duplicate.txt"
    original.write_text("same")
    duplicate.write_text("same")
    duplicate_set = [_file_info(original), _file_info(duplicate)]
    scan_results = {
        "scan": {
            "raw_duplicates": [duplicate_set],
            "summary": {"potential_savings": 999, "is_dry_run": True},
        }
    }
    progress = {}
    results = {}
    monkeypatch.setattr(core, "UNDO_DIR", tmp_path / "undo")

    link_process_worker("delete", "scan", "delete", progress, results, scan_results, [0])

    assert results["delete"]["verification_failed"] == 0
    assert results["delete"]["space_saved"] == len("same")
    assert not duplicate.exists()


def test_undo_uses_backup_and_replaces_atomically(tmp_path, monkeypatch):
    import core
    original = tmp_path / "original.txt"
    duplicate = tmp_path / "duplicate.txt"
    original.write_text("before")
    duplicate.write_text("before")
    monkeypatch.setattr(core, "UNDO_DIR", tmp_path / "undo")
    perform_linking_logic("undo", "hard", [[_file_info(original), _file_info(duplicate)]])
    original.write_text("after")

    result = undo_link_operation("undo")

    assert result["errors"] == 0
    assert duplicate.read_text() == "before"
