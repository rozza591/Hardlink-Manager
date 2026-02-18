import os
import pytest
import tempfile
import shutil
from core import run_manual_scan_and_link
from multiprocessing import Manager

@pytest.fixture
def temp_dir_with_dupes():
    temp_dir = tempfile.mkdtemp()
    
    # Create subdirs
    dir1 = os.path.join(temp_dir, "dir1")
    dir2 = os.path.join(temp_dir, "dir2")
    os.makedirs(dir1)
    os.makedirs(dir2)
    
    # Create duplicates
    file1 = os.path.join(dir1, "file1.txt")
    file2 = os.path.join(dir2, "file2.txt")
    content = "This is a duplicate file content."
    
    with open(file1, "w") as f:
        f.write(content)
    with open(file2, "w") as f:
        f.write(content)
        
    # Create a unique file
    file3 = os.path.join(dir1, "unique.txt")
    with open(file3, "w") as f:
        f.write("Unique content")
        
    yield temp_dir
    
    shutil.rmtree(temp_dir)

def test_scan_finds_duplicates(temp_dir_with_dupes):
    manager = Manager()
    progress_info = manager.dict()
    scan_results = manager.dict()
    active_tasks = manager.dict()
    
    scan_id = "test-scan-id"
    path = temp_dir_with_dupes
    
    # Run scan (dry run)
    run_manual_scan_and_link(
        scan_id, 
        path, 
        dry_run=True, 
        link_type=None, 
        save_automatically=False, 
        progress_info_managed=progress_info, 
        scan_results_managed=scan_results, 
        active_tasks_managed=active_tasks
    )
    
    # Verify results
    result = scan_results.get(scan_id)
    assert result is not None
    assert result["error"] is None
    
    summary = result["summary"]
    assert summary["total_sets_found"] == 1
    assert summary["potential_savings"] > 0
    
    duplicates = result["duplicates"]
    assert len(duplicates) == 1
    # Check that both files are in the set
    file_paths = [f["path"] for f in duplicates[0][1:]]
    assert any("file1.txt" in p for p in file_paths)
    assert any("file2.txt" in p for p in file_paths)
