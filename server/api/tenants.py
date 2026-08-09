"""
NeuralOps Multi-tenant support.

Adds API key authentication and tenant isolation so multiple teams
can use the same NeuralOps deployment with data separation.

Each tenant gets:
- A unique API key
- Isolated span data (row-level filtering by tenant_id)
- Separate cost tracking
- Independent drift detection baselines

Usage:
    # Register a tenant
    tenant = await TenantManager.create_tenant("team-alpha")
    print(tenant.api_key)  # neuralops-sk-xxxx

    # In SDK init:
    neuralops.init(
        endpoint="https://neuralops-api-cmgf.onrender.com",
        api_key="neuralops-sk-xxxx",
        service="my-agent",
    )

    # FastAPI middleware validates key and injects tenant_id
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any

import structlog
from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

log = structlog.get_logger(__name__)

API_KEY_HEADER = APIKeyHeader(name="X-NeuralOps-API-Key", auto_error=False)

# In production this would be in Postgres — for now use env-based config
# Format: NEURALOPS_TENANTS=team-alpha:key1,team-beta:key2
_TENANTS: dict[str, str] = {}  # api_key -> tenant_id


@dataclass
class Tenant:
    tenant_id: str
    api_key: str
    created_at: float
    plan: str = "free"


def _load_tenants_from_env() -> None:
    """Load tenant config from environment variable."""
    raw = os.environ.get("NEURALOPS_TENANTS", "")
    if not raw:
        return
    for pair in raw.split(","):
        if ":" in pair:
            tenant_id, api_key = pair.strip().split(":", 1)
            _TENANTS[api_key.strip()] = tenant_id.strip()
            log.info("tenant.loaded", tenant_id=tenant_id.strip())


def generate_api_key(tenant_id: str) -> str:
    """Generate a deterministic API key for a tenant."""
    secret = os.environ.get("NEURALOPS_SECRET", "default-secret-change-in-production")
    raw = f"{tenant_id}:{secret}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:32]
    return f"neuralops-sk-{digest}"


def register_tenant(tenant_id: str) -> Tenant:
    """Register a new tenant and return their API key."""
    api_key = generate_api_key(tenant_id)
    _TENANTS[api_key] = tenant_id
    tenant = Tenant(tenant_id=tenant_id, api_key=api_key, created_at=time.time())
    log.info("tenant.registered", tenant_id=tenant_id)
    return tenant


def get_tenant_id(api_key: str) -> str | None:
    """Look up tenant by API key. Returns None if not found."""
    if not _TENANTS:
        _load_tenants_from_env()
    return _TENANTS.get(api_key)


async def require_tenant(
    request: Request,
    api_key: str | None = Security(API_KEY_HEADER),
) -> str:
    """
    FastAPI dependency — validates API key and returns tenant_id.

    Usage:
        @app.post("/v1/ingest")
        async def ingest(tenant_id: str = Depends(require_tenant)):
            ...
    """
    # If no tenants configured, allow all (single-tenant mode)
    if not _TENANTS and not os.environ.get("NEURALOPS_TENANTS"):
        return "default"

    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing X-NeuralOps-API-Key header",
        )

    tenant_id = get_tenant_id(api_key)
    if not tenant_id:
        raise HTTPException(
            status_code=403,
            detail="Invalid API key",
        )

    return tenant_id


def optional_tenant(
    request: Request,
    api_key: str | None = Security(API_KEY_HEADER),
) -> str:
    """
    Like require_tenant but defaults to 'default' if no key provided.
    Use for backwards compatibility during rollout.
    """
    if not api_key:
        return "default"
    tenant_id = get_tenant_id(api_key)
    return tenant_id or "default"


# ── Admin routes (add to FastAPI app) ────────────────────────────────────

from fastapi import APIRouter

admin_router = APIRouter(prefix="/v1/admin", tags=["admin"])


@admin_router.post("/tenants")
async def create_tenant(body: dict[str, Any]) -> dict[str, str]:
    """
    Create a new tenant. Requires NEURALOPS_ADMIN_KEY header.
    
    POST /v1/admin/tenants
    Headers: X-Admin-Key: your-admin-key
    Body: {"tenant_id": "team-alpha"}
    """
    admin_key = body.get("admin_key", "")
    expected = os.environ.get("NEURALOPS_ADMIN_KEY", "")

    if expected and admin_key != expected:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    tenant_id = body.get("tenant_id", "").strip()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id required")

    tenant = register_tenant(tenant_id)
    return {
        "tenant_id": tenant.tenant_id,
        "api_key":   tenant.api_key,
        "message":   f"Add header X-NeuralOps-API-Key: {tenant.api_key} to all SDK calls",
    }


@admin_router.get("/tenants")
async def list_tenants(request: Request) -> dict[str, Any]:
    """List all registered tenants."""
    admin_key = request.headers.get("X-Admin-Key", "")
    expected = os.environ.get("NEURALOPS_ADMIN_KEY", "")
    if expected and admin_key != expected:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    return {
        "tenants": list(set(_TENANTS.values())),
        "total": len(set(_TENANTS.values())),
    }
