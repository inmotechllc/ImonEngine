from __future__ import annotations

import argparse
import json
import os
import select
import socket
import sys
import threading


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("IMON_ENGINE_VPS_HOST") or os.getenv("IMON_ENGINE_HOST_IP"))
    parser.add_argument("--user", default=os.getenv("IMON_ENGINE_VPS_USER", "root"))
    parser.add_argument("--password", default=os.getenv("IMON_ENGINE_VPS_PASSWORD") or os.getenv("IMON_ENGINE_HOST_PASSWORD"))
    parser.add_argument("--local-host", default="127.0.0.1")
    parser.add_argument("--local-port", type=int, default=int(os.getenv("CONTROL_ROOM_TUNNEL_PORT", "4311")))
    parser.add_argument("--remote-host", default="127.0.0.1")
    parser.add_argument("--remote-port", type=int, default=int(os.getenv("CONTROL_ROOM_PORT", "4177")))
    return parser.parse_args()


def pipe_channel(client_sock: socket.socket, channel) -> None:
    try:
        while True:
            readers, _, _ = select.select([client_sock, channel], [], [], 1.0)
            if client_sock in readers:
                data = client_sock.recv(65536)
                if not data:
                    break
                channel.sendall(data)
            if channel in readers:
                data = channel.recv(65536)
                if not data:
                    break
                client_sock.sendall(data)
    finally:
        try:
            channel.close()
        except Exception:
            pass
        try:
            client_sock.close()
        except Exception:
            pass


def main() -> int:
    args = parse_args()
    if not args.host or not args.password:
      print(json.dumps({"status": "error", "reason": "Missing VPS host or password."}, indent=2))
      return 1

    try:
        import paramiko
    except ImportError:
        print(json.dumps({"status": "error", "reason": "paramiko is not installed."}, indent=2))
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(args.host, username=args.user, password=args.password, timeout=20)
    transport = client.get_transport()
    if transport is None:
        print(json.dumps({"status": "error", "reason": "SSH transport was not available."}, indent=2))
        return 1

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.local_host, args.local_port))
    server.listen(40)

    print(
        json.dumps(
            {
                "status": "ready",
                "local": f"{args.local_host}:{args.local_port}",
                "remote": f"{args.remote_host}:{args.remote_port}",
                "host": args.host,
            },
            indent=2,
        ),
        flush=True,
    )

    try:
        while True:
            client_sock, origin = server.accept()
            channel = transport.open_channel(
                "direct-tcpip",
                (args.remote_host, args.remote_port),
                origin,
            )
            thread = threading.Thread(
                target=pipe_channel,
                args=(client_sock, channel),
                daemon=True,
            )
            thread.start()
    except KeyboardInterrupt:
        return 0
    finally:
        try:
            server.close()
        except Exception:
            pass
        client.close()


if __name__ == "__main__":
    sys.exit(main())
