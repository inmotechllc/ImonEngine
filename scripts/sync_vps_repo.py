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
    parser.add_argument(
        "--upload-file",
        action="append",
        default=[],
        help="Upload a local file to the VPS after git sync in the form local_path::remote_path.",
    )
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
    sftp = None
    uploaded: list[dict[str, object]] = []
    try:
        client.connect(args.host, username=args.user, password=args.password, timeout=20)
        sftp = client.open_sftp()
        for spec in args.upload_file:
            if "::" not in spec:
                print(json.dumps({"status": "error", "reason": f"Invalid --upload-file value: {spec}"}, indent=2))
                return 1
            local_path, remote_path = spec.split("::", 1)
            local_path = local_path.strip()
            remote_path = remote_path.strip()
            if not os.path.exists(local_path):
                print(json.dumps({"status": "error", "reason": f"Local file not found: {local_path}"}, indent=2))
                return 1
            remote_dir = os.path.dirname(remote_path)
            if remote_dir:
                mkdir_command = (
                    f"python3 - <<'PY'\n"
                    f"from pathlib import Path\n"
                    f"Path({remote_dir!r}).mkdir(parents=True, exist_ok=True)\n"
                    f"PY"
                )
                stdin, stdout, stderr = client.exec_command(mkdir_command)
                exit_status = stdout.channel.recv_exit_status()
                if exit_status != 0:
                    print(
                        json.dumps(
                            {
                                "status": "error",
                                "reason": f"Could not create remote directory for {remote_path}",
                                "stderr": stderr.read().decode('utf-8', errors='replace').strip(),
                            },
                            indent=2,
                        )
                    )
                    return 1
            sftp.put(local_path, remote_path)
            uploaded.append({"localPath": local_path, "remotePath": remote_path})

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
                print(json.dumps({"status": "error", "uploaded": uploaded, "results": results}, indent=2))
                return 1
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        client.close()

    print(json.dumps({"status": "ok", "host": args.host, "uploaded": uploaded, "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
