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

# 把项目根目录加入模块搜索路径，这样 `import web.bridge` 能找到 web/bridge/__init__.py
_THIS_FILE = Path(__file__).resolve()
# web/ 在项目根目录下（同级别 src/），所以往上走 4 级到项目根：
# web.py → commands → cli → repo_claude → src → RepoClaude (root)
_PROJECT_ROOT = _THIS_FILE.parents[4]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


def cmd_web_start(port: int | None = None) -> None:
    """启动 Web Bridge。

    port 参数仅用于提示；实际端口由环境变量 REPO_BRIDGE_WEB_PORT 控制。
    """
    from web.bridge import WEB_PORT  # type: ignore[import-not-found]

    actual_port = port or WEB_PORT
    print(f"Web Bridge starting on ws://127.0.0.1:{actual_port}")
    print(f"Static files served at http://127.0.0.1:{actual_port}")
    print()
    print("Press Ctrl+C to stop.")
    print()

    from web.bridge import main  # type: ignore[import-not-found]
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nWeb Bridge stopped.")
