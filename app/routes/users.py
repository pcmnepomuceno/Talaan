

from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserRead

"""User-related API routes."""

router = APIRouter(tags=["users"])


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
	"""Return the currently authenticated user's profile."""
	return current_user

