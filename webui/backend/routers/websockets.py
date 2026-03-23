"""
Router: websockets — virsh console and SSH proxy over WebSocket.
"""

import asyncio
import fcntl
import os
import pty
import struct
import subprocess
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import shared

router = APIRouter(tags=["websockets"])

# Environment for interactive PTY sessions — needs UTF-8 so multi-byte
# characters (box-drawing, etc.) pass through as raw bytes instead of
# being converted to octal escapes by the C locale.
_TERM_ENV: dict[str, str] = {
    **os.environ,
    "LANG": "en_US.UTF-8",
    "LC_ALL": "en_US.UTF-8",
    "TERM": "xterm-256color",
}


@router.websocket("/ws/console/{vm_name}")
async def ws_console(websocket: WebSocket, vm_name: str):
    await websocket.accept()
    loop = asyncio.get_event_loop()

    master_fd, slave_fd = pty.openpty()
    COLS, ROWS = 220, 50
    winsize = struct.pack("HHHH", ROWS, COLS, 0, 0)
    fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

    # Detect whether the target is a docker/podman container
    _is_docker = False
    try:
        r = subprocess.run(
            ["docker", "inspect", "--type=container", vm_name],
            capture_output=True,
            timeout=3,
        )
        if r.returncode == 0:
            _is_docker = True
    except Exception:
        _is_docker = False

    if _is_docker:
        _has_bash = (
            subprocess.run(
                ["docker", "exec", vm_name, "which", "bash"],
                capture_output=True,
                timeout=2,
            ).returncode
            == 0
        )
        _shell = "bash" if _has_bash else "sh"
        _cmd = ["docker", "exec", "-it", vm_name, _shell]
    else:
        _cmd = ["virsh", "-c", shared.LIBVIRT_URI, "console", vm_name, "--force"]

    proc = subprocess.Popen(
        _cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        env=_TERM_ENV,
    )
    os.close(slave_fd)

    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    closed = False

    def _on_master_readable():
        nonlocal closed
        if closed:
            return
        try:
            data = os.read(master_fd, 4096)
            if not data:
                raise OSError("EOF")
            asyncio.ensure_future(websocket.send_bytes(data))
        except OSError:
            closed = True
            loop.remove_reader(master_fd)
            try:
                asyncio.ensure_future(websocket.close())
            except Exception:
                pass

    loop.add_reader(master_fd, _on_master_readable)

    try:
        while True:
            data = await websocket.receive_bytes()
            if closed:
                break
            os.write(master_fd, data)
    except WebSocketDisconnect:
        pass
    finally:
        closed = True
        loop.remove_reader(master_fd)
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


@router.websocket("/ws/ssh/{host}")
async def ws_ssh(
    websocket: WebSocket, host: str, user: str = "root", port: int = 22, password: str = ""
):
    await websocket.accept()
    try:
        import paramiko
    except ImportError:
        await websocket.send_text("Error: paramiko not installed.\n")
        await websocket.close()
        return

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            host, port=port, username=user, password=password or None, timeout=10, banner_timeout=10
        )
    except Exception as e:
        await websocket.send_text(f"SSH connect error: {e}\n")
        await websocket.close()
        return

    chan = client.invoke_shell(term="xterm-256color", width=220, height=50)
    chan.setblocking(False)

    async def read_ssh():
        try:
            while True:
                await asyncio.sleep(0.02)
                if chan.recv_ready():
                    data = chan.recv(4096)
                    await websocket.send_bytes(data)
                if chan.closed:
                    break
        except Exception:
            pass

    asyncio.create_task(read_ssh())

    try:
        while True:
            data = await websocket.receive_bytes()
            chan.sendall(data)
    except WebSocketDisconnect:
        pass
    finally:
        chan.close()
        client.close()
