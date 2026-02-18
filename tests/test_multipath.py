import os
import shutil
import tempfile
import uuid
import multiprocessing
import pytest
from core import run_manual_scan_and_link
from pathlib import Path

@pytest.fixture
def test_dirs():
    temp_dir = tempfile.mkdtemp()
    base = Path(temp_dir)
    dir1 = base / "dir1"
    dir2 = base / "dir2"
    dir1.mkdir()
    dir2.mkdir()
    
    yield dir1, dir2
    shutil.rmtree(temp_dir)

def test_multipath_scan(test_dirs):
    """
    Test scanning two separate directories simultaneously provided as a list.
    """
    dir1, dir2 = test_dirs
    
    # Create duplicate files in separate directories
    content = b"multipath_test_content" * 100
    
    file1 = dir1 / "file1.txt"
    file2 = dir2 / "file2.txt"
    
    file1.write_bytes(content)
    file2.write_bytes(content)
    
    scan_id = str(uuid.uuid4())
    
    with multiprocessing.Manager() as manager:
        progress_info = manager.dict()
        scan_results = manager.dict()
        active_tasks = manager.dict()
        
        # Pass LIST of paths
        scan_paths = [str(dir1), str(dir2)]
        
        run_manual_scan_and_link(
            scan_id=scan_id,
            scan_paths=scan_paths, # New list argument
            dry_run=True,
            link_type=None,
            save_automatically=False,
            progress_info_managed=progress_info,
            scan_results_managed=scan_results,
            active_tasks_managed=active_tasks,
            ignore_dirs=[],
            ignore_exts=[],
            min_file_size=0
        )
        
        result = scan_results.get(scan_id)
        assert result is not None
        assert not result.get("error")
        
        # Verify duplicates found
        duplicates = result["duplicates"]
        assert len(duplicates) == 1
        
        # Verify both files are in the duplicate set
        dupe_set = duplicates[0]
        # Skip size string at index 0
        paths = [f["path"] for f in dupe_set[1:]]
        
        assert str(file1) in paths
        assert str(file2) in paths
        
        # Verify total files found count in summary
        assert result["summary"]["total_files"] == 2
