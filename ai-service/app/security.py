import secrets

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings


async def require_service_key(
    x_service_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.service_key.get_secret_value()
    if not x_service_key or not secrets.compare_digest(x_service_key, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service credentials.")
