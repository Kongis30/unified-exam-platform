#!/usr/bin/env python3
"""将已导入的 SHSAT 错题复习 attempt 对齐源系统冻结的题目集合。"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor


def load_attempts(connection) -> list[dict]:
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT a.id AS assignment_id, a.practice_attempt_id, a.question_numbers_json,
                   t.exam_id, e.paper_id, d.runtime_state_json
            FROM shsat_wrong_answer_assignments a
            JOIN shsat_import_id_map imported
              ON imported.source_system = 'SHSAT_V2'
             AND imported.entity_type = 'wrong_assignment'
             AND imported.target_id = a.id
            JOIN shsat_wrong_answer_tasks t ON t.id = a.task_id
            JOIN exams e ON e.id = t.exam_id
            LEFT JOIN shsat_attempt_record_details d ON d.attempt_id = a.practice_attempt_id
            WHERE a.practice_attempt_id IS NOT NULL
            ORDER BY a.id
        """)
        return list(cursor.fetchall())


def question_numbers(row: dict) -> list[int] | None:
    details = row["runtime_state_json"]
    if isinstance(details, (bytes, bytearray)):
        details = details.decode("utf-8")
    if isinstance(details, str):
        details = json.loads(details)
    values = (details or {}).get("practiceQuestionNumbers")
    if values is None:
        return None
    if not isinstance(values, list):
        raise ValueError(f"Attempt {row['practice_attempt_id']} has invalid practice question metadata")
    result = [int(value) for value in values]
    if len(result) != len(set(result)):
        raise ValueError(f"Attempt {row['practice_attempt_id']} repeats a question number")
    return result


def target_paper_items(connection, paper_id: int) -> dict[int, int]:
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT pi.display_number, pi.id
            FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = %s
        """, (paper_id,))
        return {int(row["display_number"]): int(row["id"]) for row in cursor.fetchall()}


def existing_item_ids(connection, attempt_id: int) -> list[int]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT paper_item_id FROM attempt_items WHERE attempt_id=%s ORDER BY served_order", (attempt_id,))
        return [int(row["paper_item_id"]) for row in cursor.fetchall()]


def assert_no_answers_outside_set(connection, attempt_id: int, expected_ids: list[int]) -> None:
    if not expected_ids:
        raise ValueError(f"Attempt {attempt_id} has an empty source question set")
    placeholders = ",".join(["%s"] * len(expected_ids))
    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT COUNT(*) AS answer_count FROM attempt_answers
            WHERE attempt_id=%s AND paper_item_id NOT IN ({placeholders})
        """, (attempt_id, *expected_ids))
        if cursor.fetchone()["answer_count"]:
            raise ValueError(f"Attempt {attempt_id} has answers outside its source question set; nothing was changed")


def reconcile(connection, assignments: list[dict], execute: bool) -> list[dict]:
    changes = []
    for row in assignments:
        numbers = question_numbers(row)
        if numbers is None:
            continue
        items = target_paper_items(connection, int(row["paper_id"]))
        missing = [number for number in numbers if number not in items]
        if missing:
            raise ValueError(f"Attempt {row['practice_attempt_id']} references missing target questions: {missing}")
        expected = [items[number] for number in numbers]
        attempt_id = int(row["practice_attempt_id"])
        assert_no_answers_outside_set(connection, attempt_id, expected)
        current = existing_item_ids(connection, attempt_id)
        linked = row["assignment_id"]
        change = {"assignment_id": int(linked), "attempt_id": attempt_id,
                  "current_question_count": len(current), "source_question_count": len(expected),
                  "already_reconciled": current == expected}
        changes.append(change)
        if not execute or (current == expected and current):
            continue
        frozen_json = json.dumps(numbers, separators=(",", ":"))
        with connection.cursor() as cursor:
            cursor.execute("""
                UPDATE attempts
                SET shsat_wrong_answer_assignment_id=%s, shsat_wrong_answer_questions_json=%s
                WHERE id=%s
            """, (linked, frozen_json, attempt_id))
            cursor.execute("UPDATE attempt_items SET served_order=served_order+10000 WHERE attempt_id=%s", (attempt_id,))
            cursor.execute(f"""
                DELETE FROM attempt_items
                WHERE attempt_id=%s AND paper_item_id NOT IN ({','.join(['%s'] * len(expected))})
            """, (attempt_id, *expected))
            cursor.executemany("""
                INSERT INTO attempt_items (attempt_id,paper_item_id,served_order) VALUES (%s,%s,%s)
                ON DUPLICATE KEY UPDATE served_order=VALUES(served_order)
            """, [(attempt_id, item_id, index) for index, item_id in enumerate(expected, 1)])
    return changes


def backup_target(args: argparse.Namespace) -> Path:
    destination = Path(args.backup_file).expanduser().resolve()
    if destination.exists():
        raise ValueError(f"Backup already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = ["mysqldump", "--single-transaction", "--routines", "--triggers",
               "--host", args.host, "--port", str(args.port), "--user", args.user, args.database]
    environment = os.environ.copy()
    if args.password:
        environment["MYSQL_PWD"] = args.password
    with destination.open("wb") as output:
        subprocess.run(command, stdout=output, stderr=subprocess.PIPE, check=True, env=environment)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Write changes; default runs a dry check.")
    parser.add_argument("--backup-file", help="Required with --execute; backup path must not already exist.")
    parser.add_argument("--host", default=os.getenv("TARGET_DB_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("TARGET_DB_PORT", "3306")))
    parser.add_argument("--user", default=os.getenv("TARGET_DB_USER", "root"))
    parser.add_argument("--password", default=os.getenv("TARGET_DB_PASSWORD", ""))
    parser.add_argument("--database", default=os.getenv("TARGET_DB_NAME", "unified_exam_platform"))
    args = parser.parse_args()
    if args.execute and not args.backup_file:
        parser.error("--execute requires --backup-file")

    connection = pymysql.connect(host=args.host, port=args.port, user=args.user, password=args.password,
                                 database=args.database, charset="utf8mb4", autocommit=False,
                                 cursorclass=DictCursor)
    try:
        assignments = load_attempts(connection)
        changes = reconcile(connection, assignments, False)
        if args.execute:
            backup_path = backup_target(args)
            try:
                changes = reconcile(connection, assignments, True)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            print(json.dumps({"mode": "executed", "backup": str(backup_path), "practiceAttempts": changes}, indent=2))
        else:
            connection.rollback()
            print(json.dumps({"mode": "dry-run", "practiceAttempts": changes}, indent=2))
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
