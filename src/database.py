import sqlite3
from typing import List, Dict, Any, Optional
from src.config import DB_PATH

def get_db_connection() -> sqlite3.Connection:
    """Establish a connection to the local SQLite database."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Create tables if they do not exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    # Create snippets table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        user_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Create tracked_directories table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tracked_directories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Create indexed_files table for single files and directory-scanned files
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS indexed_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER,
        source_type TEXT NOT NULL, -- 'upload' or 'folder'
        directory_id INTEGER,
        status TEXT NOT NULL, -- 'indexed', 'failed'
        error_message TEXT,
        last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (directory_id) REFERENCES tracked_directories(id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    conn.close()

# Snippets DAO
def create_snippet(snippet_type: str, title: str, content: str, user_note: Optional[str] = None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO snippets (type, title, content, user_note) VALUES (?, ?, ?, ?)",
        (snippet_type, title, content, user_note)
    )
    snippet_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return snippet_id

def get_all_snippets() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM snippets ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def delete_snippet(snippet_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
    conn.commit()
    conn.close()

# Tracked Directories DAO
def add_tracked_directory(path: str) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR IGNORE INTO tracked_directories (path, status) VALUES (?, 'Active')",
        (path,)
    )
    # If already exists, return the existing ID
    cursor.execute("SELECT id FROM tracked_directories WHERE path = ?", (path,))
    row = cursor.fetchone()
    dir_id = row['id'] if row else None
    conn.commit()
    conn.close()
    return dir_id

def get_tracked_directories() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tracked_directories ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def update_directory_status(dir_id: int, status: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE tracked_directories SET status = ? WHERE id = ?", (status, dir_id))
    conn.commit()
    conn.close()

def remove_tracked_directory(dir_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tracked_directories WHERE id = ?", (dir_id,))
    conn.commit()
    conn.close()

# Indexed Files DAO
def add_indexed_file(file_path: str, file_name: str, file_size: int, source_type: str, directory_id: Optional[int] = None, status: str = 'indexed', error_message: Optional[str] = None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO indexed_files (file_path, file_name, file_size, source_type, directory_id, status, error_message, last_indexed)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(file_path) DO UPDATE SET
            file_size = excluded.file_size,
            status = excluded.status,
            error_message = excluded.error_message,
            last_indexed = CURRENT_TIMESTAMP
        """,
        (file_path, file_name, file_size, source_type, directory_id, status, error_message)
    )
    cursor.execute("SELECT id FROM indexed_files WHERE file_path = ?", (file_path,))
    row = cursor.fetchone()
    file_id = row['id'] if row else None
    conn.commit()
    conn.close()
    return file_id

def get_indexed_files() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM indexed_files ORDER BY last_indexed DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def delete_indexed_file(file_path: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM indexed_files WHERE file_path = ?", (file_path,))
    conn.commit()
    conn.close()
