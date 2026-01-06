import os
import pytest
from core import format_bytes, calculate_hash, update_progress

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
    
    expected_hash = "a52b286a3e7f4d91" # Hash for "Hello World!"
    
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
    
    # Calculate expected hash for first 4096 bytes
    import xxhash
    expected_hash = xxhash.xxh64(content[:4096]).hexdigest()
    
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
    expected_hash = xxhash.xxh64(content).hexdigest()
    
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

    
    # Test overwriting update
    update_progress(mock_dict, key, {"status": "done"})
    assert mock_dict[key]["status"] == "done"
