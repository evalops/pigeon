from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[1]
script = Path.home() / ".codex/skills/.system/plugin-creator/scripts/validate_plugin.py"
if not script.exists():
    raise SystemExit("Install the Codex plugin-creator skill to validate this plugin")
import subprocess
raise SystemExit(subprocess.call(["python3", str(script), str(root / "plugins/pigeon")]))
