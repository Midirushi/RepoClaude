"""repo web 子命令：启动 Web Bridge（WebSocket ↔ daemon TCP 协议桥）。

设计原则：
- 仅作为入口，不嵌入任何额外业务逻辑
- 实际协议转译在 web/bridge/server.py 中
- 不修改主项目 core/ 任何文件
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# 把 web/bridge 加入模块搜索路径，避免在主项目 pyproject 中显式声明依赖
_THIS_FILE = Path(__file__).resolve()
_WEB_BRIDGE_DIR = _THIS_FILE.parents[3] / "web" / "bridge"
if str(_WEB_BRIDGE_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_WEB_BRIDGE_DIR.parent))


def cmd_web_start(port: int | None = None) -> None:
    """启动 Web Bridge。

    port 参数仅用于提示；实际端口由环境变量 REPO_BRIDGE_WEB_PORT 控制。
    """
    from web.bridge import WEB_PORT  # type: ignore[import-not-found]

    actual_port = port or WEB_PORT
    print(f"Web Bridge starting on ws://127.0.0.1:{actual_port}")
    print("Open one of the following in your browser:")
    print(f"  - run `python -m http.server 8438 --directory web/static` then open http://127.0.0.1:8438")
    print()
    print("Press Ctrl+C to stop.")
    print()

    from web.bridge import main  # type: ignore[import-not-found]
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nWeb Bridge stopped.")
