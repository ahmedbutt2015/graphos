"""graphos_io — local-first observability and policy guards for LangGraph (Python).

```python
from graphos_io import (
    wrap, LoopGuard, BudgetGuard, MCPGuard, token_cost,
    create_websocket_transport, PolicyViolationError,
)

managed = wrap(
    my_compiled_graph,
    project_id="my-agent",
    policies=[
        LoopGuard(mode="node", max_repeats=10),
        BudgetGuard(usd_limit=2.0, cost=token_cost()),
    ],
    on_trace=create_websocket_transport(),
)

result = await managed.invoke({"messages": [...]})
```
"""

from __future__ import annotations

from .errors import PolicyViolationError
from .policies import (
    DEFAULT_PRICES,
    BudgetGuard,
    LoopGuard,
    LoopGuardMode,
    MCPGuard,
    PriceEntry,
    TokenUsage,
    extract_mcp_tool_calls,
    token_cost,
)
from .transport import create_websocket_transport
from .types import (
    MCPBlockedEvent,
    MCPCallEvent,
    MCPResultEvent,
    MCPToolCall,
    MCPToolResult,
    NodeExecution,
    NodeId,
    Policy,
    PolicyContext,
    PolicyDecision,
    PolicyHaltEvent,
    SessionEndEvent,
    SessionId,
    SessionOutcome,
    SessionStartEvent,
    StepEvent,
    TraceEvent,
    TraceListener,
    cont,
    halt,
)
from .wrap import CompiledGraph, WrappedGraph, wrap

__version__ = "1.0.0"

__all__ = [
    "DEFAULT_PRICES",
    "BudgetGuard",
    "CompiledGraph",
    "LoopGuard",
    "LoopGuardMode",
    "MCPBlockedEvent",
    "MCPCallEvent",
    "MCPGuard",
    "MCPResultEvent",
    "MCPToolCall",
    "MCPToolResult",
    "NodeExecution",
    "NodeId",
    "Policy",
    "PolicyContext",
    "PolicyDecision",
    "PolicyHaltEvent",
    "PolicyViolationError",
    "PriceEntry",
    "SessionEndEvent",
    "SessionId",
    "SessionOutcome",
    "SessionStartEvent",
    "StepEvent",
    "TokenUsage",
    "TraceEvent",
    "TraceListener",
    "WrappedGraph",
    "__version__",
    "cont",
    "create_websocket_transport",
    "extract_mcp_tool_calls",
    "halt",
    "token_cost",
    "wrap",
]
