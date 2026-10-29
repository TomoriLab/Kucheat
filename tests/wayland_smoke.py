#!/usr/bin/env python3
"""Exercise the native WebKitGTK GUI on Wayland through the W3C WebDriver protocol.

Run inside dbus-run-session with tauri-driver and WebKitWebDriver installed.
The test uses isolated XDG directories. CHZZK access requires --profile-channel-id.
"""

import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import tomllib
import urllib.error
import urllib.request


def available_port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", type=Path)
    parser.add_argument("--driver", default=shutil.which("tauri-driver"))
    parser.add_argument("--native-driver", default=shutil.which("WebKitWebDriver"))
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--profile-channel-id", help="Optionally verify a real streamer's profile image through CHZZK and its CDN")
    arguments = parser.parse_args()
    if not os.environ.get("WAYLAND_DISPLAY"):
        parser.error("A running Wayland session is required")
    if not arguments.driver or not arguments.native_driver:
        parser.error("Both tauri-driver and WebKitWebDriver are required")
    root = arguments.artifacts or Path(tempfile.mkdtemp(prefix="kucheat-wayland-", dir=os.environ.get("PI_SCRATCH_DIR")))
    root.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.pop("DISPLAY", None)
    environment.update({
        "HOME": str(root / "home"),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_STATE_HOME": str(root / "state"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "GDK_BACKEND": "wayland",
        "WAYLAND_DEBUG": "1",
        "LC_ALL": "ko_KR.UTF-8",
        "LANGUAGE": "ko",
        "RUST_LOG": "kucheat=debug",
    })
    (root / "home").mkdir(exist_ok=True)
    registration = subprocess.run([
        "make", "--no-print-directory", "install-desktop",
        f"INSTALL_BIN={arguments.application.resolve()}",
    ], cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True, text=True, timeout=30)
    assert registration.returncode == 0, registration.stderr
    port, native_port = available_port(), available_port()
    base_url = f"http://127.0.0.1:{port}"
    session = None
    daemon = None
    log = (root / "native.log").open("w")
    driver = subprocess.Popen([
        arguments.driver, "--port", str(port), "--native-port", str(native_port),
        "--native-driver", arguments.native_driver,
    ], env=environment, stdout=log, stderr=log, start_new_session=True)

    def request(method, path, payload=None, timeout=45):
        data = None if payload is None else json.dumps(payload).encode()
        message = urllib.request.Request(base_url + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(message, timeout=timeout) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            raise AssertionError(error.read().decode()) from error
        value = result.get("value")
        if isinstance(value, dict) and "error" in value:
            raise AssertionError(value)
        return value

    def execute(script, *values):
        return request("POST", f"/session/{session}/execute/sync", {"script": script, "args": list(values)})

    def invoke(command, values=None, success=True):
        result = request("POST", f"/session/{session}/execute/async", {
            "script": "const done = arguments[arguments.length - 1]; window.__TAURI__.core.invoke(arguments[0], arguments[1]).then(value => done({ok: true, value}), error => done({ok: false, message: String(error)}));",
            "args": [command, values or {}],
        })
        assert result["ok"] == success, (command, result)
        return result.get("value") if success else result["message"]

    def wait_for(script, *values):
        for _ in range(100):
            if execute(script, *values):
                return
            time.sleep(0.1)
        raise AssertionError(f"UI condition did not become true: {script}")

    def click(selector):
        element = request("POST", f"/session/{session}/element", {"using": "css selector", "value": selector})
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        try:
            request("POST", f"/session/{session}/element/{identifier}/click", {})
        except AssertionError as error:
            details = execute("const element = document.querySelector(arguments[0]); const rectangle = element.getBoundingClientRect(); const x = (Math.max(0, rectangle.left) + Math.min(innerWidth, rectangle.right)) / 2; const y = (Math.max(0, rectangle.top) + Math.min(innerHeight, rectangle.bottom)) / 2; const top = document.elementFromPoint(x, y); return { target: arguments[0], coveringTag: top?.tagName, coveringId: top?.id, coveringClass: String(top?.className), x, y };", selector)
            image = request("GET", f"/session/{session}/screenshot")
            (root / "failure.png").write_bytes(base64.b64decode(image))
            raise AssertionError(f"{error}; hit test: {details}") from error

    try:
        for _ in range(100):
            if driver.poll() is not None:
                raise AssertionError("The WebDriver exited; inspect native.log")
            try:
                request("GET", "/status", timeout=1)
                break
            except (OSError, AssertionError):
                time.sleep(0.1)
        result = request("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": str(arguments.application.resolve())}}}}, timeout=90)
        session = result["sessionId"]
        request("POST", f"/session/{session}/timeouts", {"script": 20000})
        for _ in range(100):
            if execute("return Boolean(window.__TAURI__ && document.querySelector('main'))"):
                break
            time.sleep(0.1)
        else:
            raise AssertionError("The native WebView did not load the frontend")
        wait_for("""
            const logo = document.querySelector('.brand-mark');
            return logo?.localName === 'img' && logo.complete
                && logo.naturalWidth === 512 && logo.naturalHeight === 512;
        """)
        assert execute("""
            const logo = document.querySelector('.brand-mark');
            return logo.getAttribute('src') === './assets/icons/kucheat.png'
                && logo.alt === 'Kucheat' && getComputedStyle(logo).objectFit === 'contain'
                && document.querySelector('link[rel="icon"]').href === logo.src;
        """)
        print("PASS: Bundled Kucheat logo and favicon")
        dashboard = invoke("get_dashboard")
        assert dashboard["channels"] == []
        assert dashboard["session_type"] == "wayland"
        for _ in range(30):
            dashboard = invoke("get_dashboard")
            if dashboard["monitor"]["running"]:
                break
            time.sleep(0.1)
        assert dashboard["monitor"]["host"] == "gui"
        print("PASS: Native Wayland WebView and dashboard IPC")

        settings = {"check_interval_secs": 120, "notify_offline": True, "client_id": "test-client", "client_secret": "test-secret", "clear_client_secret": False}
        saved = invoke("save_settings", {"settings": settings})
        assert saved["settings"]["check_interval_secs"] == 120
        assert saved["api"] == {"client_id": "test-client", "has_client_secret": True}
        assert "test-secret" not in json.dumps(saved)
        settings["client_secret"] = None
        invoke("save_settings", {"settings": settings})
        config_path = root / "config/kucheat/config.toml"
        assert tomllib.loads(config_path.read_text())["api"]["client_secret"] == "test-secret"
        settings["check_interval_secs"] = 0
        assert "interval" in invoke("save_settings", {"settings": settings}, success=False).lower()
        settings.update({"check_interval_secs": 60, "client_id": "", "clear_client_secret": True})
        invoke("save_settings", {"settings": settings})
        assert tomllib.loads(config_path.read_text())["api"]["client_secret"] == ""
        assert config_path.stat().st_mode & 0o777 == 0o600
        print("PASS: Settings persistence, private permissions, write-only credentials, and validation")

        assert "32" in invoke("add_channel", {"channelId": "invalid", "name": None}, success=False)
        invoke("open_channel", {"channelId": "invalid", "live": True}, success=False)
        assert invoke("set_auto_launch", {"enabled": True})["auto_launch"]
        assert not invoke("set_auto_launch", {"enabled": False})["auto_launch"]
        invoke("refresh_channels")
        print("PASS: Channel validation, safe URL opening, login autostart, and refresh IPC")

        wait_for("return !document.querySelector('#add-channel').disabled")
        click('[data-page="settings"]')
        wait_for("return !document.querySelector('#check-interval').disabled && !document.querySelector('#settings-page').hidden")
        execute("const input = document.querySelector('#check-interval'); input.value = '120'; input.dispatchEvent(new Event('input', { bubbles: true }));")
        time.sleep(3.3)
        assert execute("return document.querySelector('#check-interval').value") == "120"
        click("#save-settings")
        wait_for("return document.querySelector('#save-settings').disabled")
        assert invoke("get_dashboard")["settings"]["check_interval_secs"] == 120
        execute("const input = document.querySelector('#check-interval'); input.value = '60'; input.dispatchEvent(new Event('input', { bubbles: true }));")
        click("#save-settings")
        wait_for("return document.querySelector('#save-settings').disabled")
        assert invoke("get_dashboard")["settings"]["check_interval_secs"] == 60
        click('label.theme-option:has(input[value="dark"])')
        assert execute("return document.documentElement.dataset.theme") == "dark"
        click('label.theme-option:has(input[value="light"])')
        click('[data-page="channels"]')
        click("#add-channel")
        wait_for("return document.querySelector('#add-dialog').open")
        execute("document.querySelector('#new-channel-id').value = 'invalid';")
        click("#confirm-add")
        wait_for("return !document.querySelector('#add-error').hidden")
        assert invoke("get_dashboard")["channels"] == []
        click('[data-close-dialog="add-dialog"]')
        print("PASS: Native UI settings, unsaved edits, themes, and channel dialog validation")

        click('[data-page="settings"]')
        for language, settings_heading, channels_heading, validation, empty_cli in [
            ("en", "Settings", "Channels", "32-character channel ID", "No channels registered."),
            ("ja", "設定", "チャンネル", "32桁のチャンネルID", "登録されているチャンネルはありません。"),
            ("zh-TW", "設定", "頻道", "32 碼的頻道 ID", "尚未新增任何頻道。"),
            ("ko", "설정", "채널", "32자리 채널 ID", "등록된 채널이 없습니다."),
        ]:
            wait_for("return !document.querySelector('#language').disabled")
            if language == "en":
                execute("const input = document.querySelector('#check-interval'); input.value = '180'; input.dispatchEvent(new Event('input', { bubbles: true }));")
            execute("const select = document.querySelector('#language'); select.value = arguments[0]; select.dispatchEvent(new Event('change', { bubbles: true }));", language)
            if language == "en":
                time.sleep(3.3)
                assert execute("return document.querySelector('#check-interval').value") == "180"
                assert execute("return document.querySelector('#language').value") == language
            click("#save-settings")
            wait_for("return document.documentElement.lang === arguments[0] && document.querySelector('#save-settings').disabled", language)
            assert execute("return document.querySelector('#settings-heading').textContent") == settings_heading
            assert execute("return document.title") == f"{settings_heading} · Kucheat"
            assert invoke("get_dashboard")["settings"]["language"] == language
            persisted = tomllib.loads(config_path.read_text())
            assert persisted["settings"]["language"] == language
            assert persisted["settings"]["check_interval_secs"] == 180
            listed = subprocess.run([str(arguments.application.resolve()), "list"], env=environment, capture_output=True, text=True, timeout=10)
            assert listed.returncode == 0, listed.stderr
            assert empty_cli in listed.stdout
            assert execute("return document.documentElement.scrollWidth <= innerWidth")
            execute("window.scrollTo(0, 0);")
            image = request("GET", f"/session/{session}/screenshot")
            (root / f"language-{language}.png").write_bytes(base64.b64decode(image))
            click('[data-page="channels"]')
            assert execute("return document.querySelector('#channels-heading').textContent") == channels_heading
            click("#add-channel")
            execute("document.querySelector('#new-channel-id').value = 'invalid';")
            click("#confirm-add")
            wait_for("return !document.querySelector('#add-error').hidden")
            assert validation in execute("return document.querySelector('#add-error').textContent")
            click('[data-close-dialog="add-dialog"]')
            click('[data-page="settings"]')
        execute("const select = document.querySelector('#language'); select.value = 'ja'; select.dispatchEvent(new Event('change', { bubbles: true }));")
        click("#reset-settings")
        assert execute("return document.querySelector('#language').value") == "ko"
        assert execute("return document.documentElement.lang") == "ko"
        invalid_language = {**settings, "language": "zh-CN"}
        previous_config = config_path.read_bytes()
        invoke("save_settings", {"settings": invalid_language}, success=False)
        assert config_path.read_bytes() == previous_config
        execute("const select = document.querySelector('#language'); select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })); const input = document.querySelector('#check-interval'); input.value = '60'; input.dispatchEvent(new Event('input', { bubbles: true }));")
        click("#save-settings")
        wait_for("return document.querySelector('#save-settings').disabled && document.documentElement.lang === 'ko'")
        assert invoke("get_dashboard")["settings"]["language"] == "system"
        click('[data-page="channels"]')
        print("PASS: Four GUI languages, localized validation, draft/reset preservation, and shared CLI preference")

        if arguments.profile_channel_id:
            identifier = arguments.profile_channel_id
            invoke("add_channel", {"channelId": identifier, "name": None})
            wait_for("""
                const row = Array.from(document.querySelectorAll('.channel-card'))
                    .find(element => element.dataset.channelId === arguments[0]);
                const image = row?.querySelector('.channel-avatar img');
                return Boolean(image?.complete && image.naturalWidth > 0
                    && image.classList.contains('is-loaded')
                    && getComputedStyle(image).opacity === '1'
                    && row.querySelector('.channel-avatar-fallback').hidden);
            """, identifier)
            profile = next(channel for channel in invoke("get_dashboard")["channels"] if channel["id"] == identifier)
            assert profile["channel_image_url"].startswith("https://")
            execute("window.profileTestImage = document.querySelector('.channel-avatar img');")
            time.sleep(3.3)
            assert execute("return window.profileTestImage === document.querySelector('.channel-avatar img') && window.profileTestImage.classList.contains('is-loaded');")
            image = request("GET", f"/session/{session}/screenshot")
            (root / "profile.png").write_bytes(base64.b64decode(image))
            execute("delete window.profileTestImage;")
            invoke("remove_channel", {"channelId": identifier})
            print("PASS: Real streamer profile image decoding, native CSP, and stable polling")

        duplicate = subprocess.run([str(arguments.application.resolve()), "gui"], env=environment, capture_output=True, timeout=10)
        assert duplicate.returncode == 0, duplicate.stderr.decode()
        print("PASS: D-Bus single-instance activation")
        image = request("GET", f"/session/{session}/screenshot")
        (root / "wayland.png").write_bytes(base64.b64decode(image))
        assert execute("return document.documentElement.scrollWidth <= window.innerWidth")
        assert "데스크톱 앱에서" not in execute("return document.body.innerText")
        print("PASS: Native screenshot capture and layout bounds")
        launcher = root / "data/applications/kucheat.desktop"
        assert launcher.is_file()
        assert f'set_app_id("{launcher.stem}")' in (root / "native.log").read_text()
        entry = launcher.read_text().splitlines()
        assert f'Exec="{arguments.application.resolve()}"' in entry
        assert "StartupWMClass=kucheat" in entry
        assert "Icon=kucheat" in entry
        icon = root / "data/icons/hicolor/512x512/apps/kucheat.png"
        source_icon = Path(__file__).resolve().parents[1] / "assets/icons/kucheat.png"
        assert icon.read_bytes() == source_icon.read_bytes()
        print("PASS: Wayland application ID resolves to an installed launcher and Kucheat icon")

        daemon = subprocess.Popen([str(arguments.application.resolve()), "daemon"], env=environment, stdout=log, stderr=log)
        time.sleep(0.5)
        assert daemon.poll() is None
        assert invoke("get_dashboard")["monitor"]["host"] == "gui"
        request("DELETE", f"/session/{session}")
        session = None
        for _ in range(50):
            status = subprocess.run([
                "gdbus", "call", "--session", "--dest", "io.github.tomorilab.Kucheat.Monitor",
                "--object-path", "/io/github/tomorilab/Kucheat/Monitor", "--method", "io.github.tomorilab.Kucheat.Monitor.Status",
            ], env=environment, capture_output=True, text=True)
            if status.returncode == 0 and '\\"host\\":\\"daemon\\"' in status.stdout.replace('"', '\\"'):
                break
            time.sleep(0.1)
        else:
            raise AssertionError("The waiting daemon did not take over monitoring")
        print("PASS: GUI and daemon coexistence and monitoring handoff")
        print(f"Artifacts: {root}")
    finally:
        if session:
            try:
                request("DELETE", f"/session/{session}", timeout=5)
            except (OSError, AssertionError):
                pass
        if daemon:
            daemon.terminate()
            daemon.wait(timeout=10)
        if driver.poll() is None:
            os.killpg(driver.pid, signal.SIGTERM)
        driver.wait(timeout=10)
        log.close()


if __name__ == "__main__":
    main()
