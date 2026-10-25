"""真实迁移在临时数据库运行；验证旧用户默认值及原字段完整性。"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_existing_profile_survives_upgrade_and_repeated_upgrade(tmp_path):
    root = Path(__file__).resolve().parents[1]
    database = tmp_path / "migration.db"
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + str(database)}

    def upgrade(revision):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", str(root / "alembic.ini"), "upgrade", revision],
            env=env, cwd=root, capture_output=True, text=True, timeout=30,
        )
        assert result.returncode == 0, result.stderr

    upgrade("0022_ledger_statistics_mode")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO user_profiles (user_id,display_name,avatar_version,income_is_red,"
            "appearance_json,primary_currency,updated_at) VALUES (?,?,?,?,?,?,?)",
            ("synthetic-user", "旧用户", 0, 1, '{"compact_amount":true}', "JPY", "2026-01-01"),
        )
        before = connection.execute("SELECT * FROM user_profiles").fetchall()
        names = [row[1] for row in connection.execute("PRAGMA table_info(user_profiles)")]
    upgrade("head")
    upgrade("head")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT statistics_focus FROM user_profiles").fetchone()[0] == "balance"
        assert connection.execute(f"SELECT {','.join(names)} FROM user_profiles").fetchall() == before
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0023_profile_statistics_focus"
