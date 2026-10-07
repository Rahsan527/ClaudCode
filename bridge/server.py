"""Entry point for Claude Code: `python bridge/server.py` (see .mcp.json)."""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from mt5_bridge.mcp_server import main  # noqa: E402

if __name__ == "__main__":
    main()
