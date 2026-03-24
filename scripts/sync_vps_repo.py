from __future__ import annotations

import argparse
import json
import os
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("IMON_ENGINE_VPS_HOST") or os.getenv("IMON_ENGINE_HOST_IP"))
    parser.add_argument("--user", default=os.getenv("IMON_ENGINE_VPS_USER", "root"))
    parser.add_argument("--password", default=os.getenv("IMON_ENGINE_VPS_PASSWORD"))
    parser.add_argument("--repo-path", default=os.getenv("IMON_ENGINE_VPS_REPO_PATH", "/opt/imon-engine"))
    parser.add_argument("--branch", default=os.getenv("IMON_ENGINE_VPS_BRANCH", "main"))
    parser.add_argument("--post-command", action="append", default=[])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.host or not args.password:
        print(
            json.dumps(
                {
                    "status": "skipped",
                    "reason": "Missing VPS host or password.",
                },
                indent=2,
            )
        )
        return 0

    try:
        import paramiko
    except ImportError:
        print(json.dumps({"status": "error", "reason": "paramiko is not installed."}, indent=2))
        return 1

    commands = [
        f"cd {args.repo_path} && git fetch origin && git checkout {args.branch} && git pull --ff-only origin {args.branch}"
    ]
    commands.extend(args.post_command)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(args.host, username=args.user, password=args.password, timeout=20)
        results: list[dict[str, object]] = []
        for command in commands:
            stdin, stdout, stderr = client.exec_command(command)
            exit_status = stdout.channel.recv_exit_status()
            results.append(
                {
                    "command": command,
                    "exitStatus": exit_status,
                    "stdout": stdout.read().decode("utf-8", errors="replace").strip(),
                    "stderr": stderr.read().decode("utf-8", errors="replace").strip(),
                }
            )
            if exit_status != 0:
                print(json.dumps({"status": "error", "results": results}, indent=2))
                return 1
    finally:
        client.close()

    print(json.dumps({"status": "ok", "host": args.host, "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
